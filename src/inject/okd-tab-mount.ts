import {
  WIRE_NS,
  type LogLine,
  type OkdVariant,
  type PageWire,
  type PanelSocketStatus,
  type SocketState,
} from '../shared/types.js';
import {
  decodeBase64Chunk,
  flushTail,
  makeDecoderState,
  type DecoderState,
} from '../shared/parser.js';
import { detectFromUrl, detectFromWsUrl, extractPodKey } from '../shared/okd-detect.js';
import { findLogsTab, findSiblingTab, findTabList } from '../shared/okd-tabs.js';
import {
  buildPrettyToggle,
  findLogToolbar,
  PRETTY_TOGGLE_ATTR,
  setNativeControlsHidden,
  type ToggleHandle,
} from '../shared/okd-log-toolbar.js';
import { mount as mountPanel, type PanelHandle, type PanelListener } from '../panel/panel-view.js';

const TOGGLE_LABEL = 'Pretty';

// Guard against double injection. MV3 content scripts can run twice if the
// user reloads the extension while a page is open; without this guard the
// history patch is re-applied and the document observer is duplicated.
const ALREADY_INSTALLED = '__okdTabMountInstalled';
type GlobalFlag = { [ALREADY_INSTALLED]?: boolean };
if ((window as unknown as GlobalFlag)[ALREADY_INSTALLED]) {
  throw new Error('okd-tab-mount already installed in this page');
}
(window as unknown as GlobalFlag)[ALREADY_INSTALLED] = true;

// Teardown registry — every global listener / observer / patch registers a
// disposer so we can fully unwind on `pagehide` (or when the extension is
// disabled while the page is live).
const disposers: Array<() => void> = [];
function addDisposer(fn: () => void) {
  disposers.push(fn);
}
function runDisposers() {
  while (disposers.length > 0) {
    const fn = disposers.pop()!;
    try {
      fn();
    } catch {
      /* ignore teardown errors */
    }
  }
}
window.addEventListener('pagehide', runDisposers, { once: true });

// ---- Decoded-lines state -----------------------------------------------

interface SocketInfo {
  id: number;
  url: string;
  state: SocketState;
  openedAt: number;
}

const decoders = new Map<number, DecoderState>();
const textDecoder = new TextDecoder('utf-8', { fatal: false });

let ringBuffer: LogLine[] = [];
const discoveredFields = new Set<string>();
const sockets = new Map<number, SocketInfo>();
let currentSocketId: number | null = null;
let linesTotal = 0;
let lastLineAt: number | null = null;
let variant: OkdVariant | null = null;

const RING_LIMIT_DEFAULT = 5000;
const FIELDS_FROM_RECENT = 500;

// Subscribers are the mounted panel (at most one at a time).
const listeners = new Set<PanelListener>();

function notifyLinesAppended(lines: LogLine[]) {
  for (const l of listeners) l.onLinesAppended?.(lines);
}
function notifyFieldsChanged() {
  const arr = [...discoveredFields];
  for (const l of listeners) l.onFieldsChanged?.(arr);
}
function notifyStatusChanged() {
  const s = computeSocketStatus();
  for (const l of listeners) l.onStatusChanged?.(s);
}
function notifyVariant() {
  for (const l of listeners) l.onVariantChanged?.(variant);
}
function notifyReset() {
  for (const l of listeners) l.onReset?.();
}

function computeSocketStatus(): PanelSocketStatus {
  const id = currentSocketId;
  const s = id !== null ? (sockets.get(id) ?? null) : null;
  return {
    state: s?.state ?? 'idle',
    url: s?.url ?? null,
    since: s?.openedAt ?? null,
    lastLineAt,
    linesTotal,
  };
}

function resetStreamState() {
  ringBuffer = [];
  discoveredFields.clear();
  sockets.clear();
  decoders.clear();
  currentSocketId = null;
  linesTotal = 0;
  lastLineAt = null;
  notifyReset();
  notifyFieldsChanged();
  notifyStatusChanged();
}

function extractFields(line: LogLine) {
  if (!line.parsed) return;
  let added = false;
  for (const k of Object.keys(line.parsed)) {
    if (!discoveredFields.has(k)) {
      discoveredFields.add(k);
      added = true;
    }
  }
  if (added) notifyFieldsChanged();
}

function pushLines(lines: LogLine[]) {
  if (lines.length === 0) return;
  for (const line of lines) {
    ringBuffer.push(line);
    if (linesTotal < FIELDS_FROM_RECENT) extractFields(line);
    linesTotal++;
    lastLineAt = line.t;
  }
  if (ringBuffer.length > RING_LIMIT_DEFAULT) {
    ringBuffer.splice(0, ringBuffer.length - RING_LIMIT_DEFAULT);
  }
  notifyLinesAppended(lines);
  notifyStatusChanged();
}

// ---- WebSocket message pipeline ---------------------------------------

const onWireMessage = (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const data = ev.data as PageWire | undefined;
  if (!data || data.ns !== WIRE_NS) return;

  if (data.type === 'ws-open') {
    decoders.set(data.socketId, makeDecoderState());
    sockets.set(data.socketId, {
      id: data.socketId,
      url: data.url,
      state: 'connecting',
      openedAt: data.t,
    });
    currentSocketId = data.socketId;
    const v = detectFromWsUrl(data.url);
    if (v && v !== variant) {
      variant = v;
      notifyVariant();
    }
    notifyStatusChanged();
    return;
  }

  if (data.type === 'ws-ready') {
    const s = sockets.get(data.socketId);
    if (s) s.state = 'open';
    notifyStatusChanged();
    return;
  }

  if (data.type === 'ws-close') {
    // Server-side closes (k8s apiserver `limitBytes`, reverse-proxy idle timeout,
    // watch read-timeout) often cut the stream mid-line. The remaining buffer
    // is then a truncated JSON fragment with no closing brace. Drop both the
    // raw tail and any in-flight multi-line JSON merge unless the tail looks
    // like a complete entry on its own.
    const state = decoders.get(data.socketId);
    if (state) {
      const raw = state.tail.length > 0 ? textDecoder.decode(state.tail) : '';
      const trimmed = raw.trim();
      const tailLooksComplete =
        trimmed.length > 0 &&
        (!trimmed.startsWith('{') || (trimmed.startsWith('{') && trimmed.endsWith('}')));
      if (tailLooksComplete && !state.pending) {
        const tail = flushTail(state, data.socketId, data.t);
        if (tail.length > 0) pushLines(tail);
      } else {
        state.tail = new Uint8Array(0);
        state.pending = null;
      }
    }
    decoders.delete(data.socketId);
    const s = sockets.get(data.socketId);
    if (s) s.state = 'closed';
    notifyStatusChanged();
    return;
  }

  if (data.type === 'ws-msg') {
    let state = decoders.get(data.socketId);
    if (!state) {
      state = makeDecoderState();
      decoders.set(data.socketId, state);
    }
    const lines = decodeBase64Chunk(state, data.data, data.socketId, data.t, textDecoder);
    if (lines.length === 0) return;
    pushLines(lines);
  }
};
window.addEventListener('message', onWireMessage);
addDisposer(() => window.removeEventListener('message', onWireMessage));

// ---- Pod-page route detection -----------------------------------------

interface PodRoute {
  isPod: boolean;
  isLogs: boolean;
}

// Match the pod-detail page on either OKD variant. Both consoles share the
// same horizontal-nav DOM on every workload page (Deployments, Services,
// etc.), so we can't rely on the DOM to decide where the toggle belongs —
// gate strictly on the URL pattern.
function detectPodRoute(href: string): PodRoute {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { isPod: false, isLogs: false };
  }
  const m4 = url.pathname.match(
    /^\/k8s\/(?:ns|cluster|all-namespaces)\/[^/]+\/pods\/[^/]+(?:\/([^/?#]+))?\/?$/,
  );
  if (m4) return { isPod: true, isLogs: m4[1] === 'logs' };
  const m3 = url.pathname.match(/^\/console\/project\/[^/]+\/browse\/pods\/[^/?#]+\/?$/);
  if (m3) {
    const tab = url.searchParams.get('tab') ?? 'details';
    return { isPod: true, isLogs: tab === 'logs' };
  }
  return { isPod: false, isLogs: false };
}

// ---- Toggle injection + panel mount -----------------------------------

let toggleHandle: ToggleHandle | null = null;
let currentToolbar: HTMLElement | null = null;
let toolbarObserver: MutationObserver | null = null;
let prettyActive = false;
let hostEl: HTMLDivElement | null = null;
let panelHandle: PanelHandle | null = null;
let savedToolbarRef: HTMLElement | null = null;
let savedContentRef: HTMLElement | null = null;
let savedBodyOverflow = '';
let savedHtmlOverflow = '';
let resizeObserver: ResizeObserver | null = null;
let geometryRaf: number | null = null;
const geometryUpdate = () => {
  if (geometryRaf !== null) return;
  geometryRaf = requestAnimationFrame(() => {
    geometryRaf = null;
    updateHostGeometry();
  });
};

function removeToggle() {
  if (toggleHandle && toggleHandle.el.parentElement) {
    toggleHandle.el.parentElement.removeChild(toggleHandle.el);
  }
  toggleHandle = null;
  if (toolbarObserver) {
    toolbarObserver.disconnect();
    toolbarObserver = null;
  }
  currentToolbar = null;
}

// Tear down everything bound to the /logs DOM. Preserves `prettyActive` so
// the overlay auto-resumes if the user navigates back to /logs.
function teardownLogsBindings() {
  unmountOverlay();
  removeToggle();
}

// (Re-)inject the Pretty toggle into the native log-viewer toolbar. Idempotent
// — when the host re-renders the toolbar, the MutationObserver fires this
// helper to put the toggle back in place.
function ensureToggleInjected() {
  const route = detectPodRoute(location.href);
  if (!route.isPod || !route.isLogs) {
    teardownLogsBindings();
    return;
  }
  const v = detectFromUrl(location.href);
  if (v && v !== variant) {
    variant = v;
    notifyVariant();
  }
  const refs = findLogToolbar();
  if (!refs) return;
  if (v !== refs.variant) {
    variant = refs.variant;
    notifyVariant();
  }

  // If our toggle is already in this exact toolbar, just refresh visual state.
  const existing = refs.mountPoint.querySelector<HTMLElement>(`[${PRETTY_TOGGLE_ATTR}]`);
  if (existing && toggleHandle && existing === toggleHandle.el) {
    toggleHandle.setActive(prettyActive);
    if (currentToolbar !== refs.toolbar) attachToolbarObserver(refs.toolbar);
    if (prettyActive && (!hostEl || !hostEl.isConnected)) {
      mountOverlay(refs.toolbar, refs.contentArea);
    }
    return;
  }

  // Otherwise build a fresh handle and (re)mount it.
  if (toggleHandle && toggleHandle.el.parentElement) {
    toggleHandle.el.parentElement.removeChild(toggleHandle.el);
  }
  toggleHandle = buildPrettyToggle(refs, TOGGLE_LABEL, prettyActive, (next) => {
    if (next) activatePretty();
    else deactivatePretty();
  });
  refs.mountPoint.appendChild(toggleHandle.el);
  attachToolbarObserver(refs.toolbar);

  // Auto-restore overlay on re-entry to /logs while toggle remained on.
  if (prettyActive && (!hostEl || !hostEl.isConnected)) {
    mountOverlay(refs.toolbar, refs.contentArea);
  }
}

function attachToolbarObserver(toolbar: HTMLElement) {
  if (currentToolbar === toolbar && toolbarObserver) return;
  if (toolbarObserver) toolbarObserver.disconnect();
  currentToolbar = toolbar;
  toolbarObserver = new MutationObserver(() => {
    if (!toggleHandle) return;
    if (!toggleHandle.el.isConnected) {
      // Framework re-rendered the toolbar — re-find and re-inject.
      ensureToggleInjected();
    }
  });
  toolbarObserver.observe(toolbar, { childList: true, subtree: true });
}

function activatePretty() {
  prettyActive = true;
  toggleHandle?.setActive(true);
  const refs = findLogToolbar();
  if (!refs) return;
  mountOverlay(refs.toolbar, refs.contentArea);
}

function deactivatePretty() {
  prettyActive = false;
  toggleHandle?.setActive(false);
  unmountOverlay();
}

// Reopen the OKD log WebSocket by wiggling the route: click a sibling native
// tab, then click Logs. Both routers (React Router on OKD 4, Angular
// $location on OKD 3) unmount the old view and mount fresh on a real route
// change, so the log component re-initialises and opens a new WS.
//
// The overlay is preserved across this round-trip because `prettyActive` stays
// true; ensureToggleInjected re-mounts when the new toolbar appears.
let reconnecting = false;
function reconnectStream() {
  if (reconnecting) return;
  const tabList = findTabList();
  if (!tabList) return;
  const logsTab = findLogsTab(tabList);
  if (!logsTab) return;
  const sibling = findSiblingTab(tabList, logsTab);
  if (!sibling) return;

  reconnecting = true;
  resetStreamState();
  unmountOverlay();

  try {
    sibling.click();
  } catch {
    /* ignore */
  }
  self.setTimeout(() => {
    try {
      logsTab.click();
    } catch {
      /* ignore */
    }
    // ensureToggleInjected (driven by the document mutation observer) will
    // re-attach the toggle and re-mount the overlay because prettyActive is
    // still true.
    self.setTimeout(() => {
      reconnecting = false;
    }, 400);
  }, 300);
}

function updateHostGeometry() {
  if (!hostEl) return;
  const toolbar = savedToolbarRef;
  const content = savedContentRef;
  if (!toolbar || !content) return;
  const tbRect = toolbar.getBoundingClientRect();
  const cRect = content.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  // Anchor the overlay's top to the toolbar's bottom so the native toolbar
  // (and our toggle inside it) stays visible above the panel. Clamp >= 0
  // because OKD 3 isn't sticky — the toolbar can scroll above the viewport.
  const top = Math.max(0, tbRect.bottom);
  const left = Math.max(0, cRect.left);
  const width = Math.max(0, Math.min(cRect.width, vw - left));
  hostEl.style.top = `${top}px`;
  hostEl.style.left = `${left}px`;
  hostEl.style.width = `${width}px`;
  hostEl.style.height = `${Math.max(0, vh - top)}px`;
}

// The console's Expand button puts `.co-resource-log` into browser fullscreen,
// where only that element's subtree is rendered — the overlay has to live
// inside it to stay visible, and go back to <body> on exit.
function overlayParent(): HTMLElement {
  const fs = document.fullscreenElement;
  if (fs instanceof HTMLElement && savedContentRef && fs.contains(savedContentRef)) return fs;
  return document.body;
}

const onFullscreenChange = () => {
  if (!hostEl) return;
  const parent = overlayParent();
  if (hostEl.parentElement === parent) return;
  try {
    // moveBefore (Chrome 133+) keeps the panel's scroll position and focus;
    // older Chrome throws here and falls back to a plain re-append.
    parent.moveBefore(hostEl, null);
  } catch {
    parent.appendChild(hostEl);
  }
  geometryUpdate();
};

function mountOverlay(toolbar: HTMLElement, content: HTMLElement) {
  if (hostEl && hostEl.isConnected) return;

  // Lock page scroll so the body doesn't grow behind our fixed overlay
  // (especially on OKD 3 where the document itself scrolls log content).
  savedToolbarRef = toolbar;
  savedContentRef = content;
  savedBodyOverflow = document.body.style.overflow;
  savedHtmlOverflow = document.documentElement.style.overflow;
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';

  const host = document.createElement('div');
  host.className = 'okd-log-ext-host';
  // z-index sits above arbitrary in-content overlays but stays below the
  // host console's nav flyouts/popovers (Bootstrap modals start at 1050,
  // PatternFly popovers ~2000) so hovering OKD's left nav still surfaces
  // submenus on top of the panel.
  host.style.cssText =
    'position:fixed;z-index:100;visibility:visible;pointer-events:auto;contain:layout paint;';
  overlayParent().appendChild(host);
  hostEl = host;
  setNativeControlsHidden(true);
  updateHostGeometry();

  const shadow = host.attachShadow({ mode: 'open' });
  panelHandle = mountPanel(shadow, {
    getInitialLines: () => ringBuffer.slice(),
    getInitialFields: () => [...discoveredFields],
    getInitialStatus: () => computeSocketStatus(),
    getVariant: () => variant,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reconnect: reconnectStream,
  });

  window.addEventListener('resize', geometryUpdate);
  window.addEventListener('scroll', geometryUpdate, { passive: true, capture: true });
  document.addEventListener('fullscreenchange', onFullscreenChange);
  resizeObserver = new ResizeObserver(geometryUpdate);
  resizeObserver.observe(toolbar);
  resizeObserver.observe(content);
  resizeObserver.observe(document.documentElement);
}

function unmountOverlay() {
  window.removeEventListener('resize', geometryUpdate);
  window.removeEventListener('scroll', geometryUpdate, { capture: true });
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (geometryRaf !== null) {
    cancelAnimationFrame(geometryRaf);
    geometryRaf = null;
  }
  if (panelHandle) {
    panelHandle.dispose();
    panelHandle = null;
  }
  if (hostEl) {
    hostEl.remove();
    hostEl = null;
  }
  setNativeControlsHidden(false);
  document.body.style.overflow = savedBodyOverflow;
  document.documentElement.style.overflow = savedHtmlOverflow;
  savedToolbarRef = null;
  savedContentRef = null;
}

// ---- SPA route observation --------------------------------------------

let lastPodKey = extractPodKey(location.pathname);

function patchHistory() {
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    const r = origPush.apply(this, args);
    window.dispatchEvent(new Event('okd-log-ext:routechange'));
    return r;
  };
  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    const r = origReplace.apply(this, args);
    window.dispatchEvent(new Event('okd-log-ext:routechange'));
    return r;
  };
  const onPopState = () => window.dispatchEvent(new Event('okd-log-ext:routechange'));
  window.addEventListener('popstate', onPopState);
  addDisposer(() => {
    history.pushState = origPush;
    history.replaceState = origReplace;
    window.removeEventListener('popstate', onPopState);
  });
}

function onRouteChange() {
  const newPod = extractPodKey(location.pathname);
  if (newPod !== lastPodKey) {
    // Different pod (or off pod entirely) — stream and toggle intent reset.
    lastPodKey = newPod;
    resetStreamState();
    prettyActive = false;
    teardownLogsBindings();
  } else {
    const route = detectPodRoute(location.href);
    if (!route.isLogs) teardownLogsBindings();
  }
  scheduleEnsure();
}

let ensureRafId: number | null = null;
function scheduleEnsure() {
  if (ensureRafId !== null) return;
  ensureRafId = requestAnimationFrame(() => {
    ensureRafId = null;
    ensureToggleInjected();
  });
}

// Global document observer that catches any DOM churn as a trigger to
// re-verify the Pretty toggle is still injected. Work inside
// ensureToggleInjected() is cheap when nothing changed (early-exit if the
// toggle is already present), so the rAF throttle keeps us at one check per
// frame.
const documentObserver = new MutationObserver(scheduleEnsure);
documentObserver.observe(document.documentElement, { childList: true, subtree: true });
addDisposer(() => documentObserver.disconnect());

patchHistory();
window.addEventListener('okd-log-ext:routechange', onRouteChange);
addDisposer(() => window.removeEventListener('okd-log-ext:routechange', onRouteChange));

// Initial mount attempt at document_start (tab list may not exist yet;
// the MutationObserver picks it up as soon as OKD renders it).
scheduleEnsure();
