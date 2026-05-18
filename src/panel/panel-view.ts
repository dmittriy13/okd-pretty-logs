import shadowCss from './shadow.css';
import type {
  Config,
  FieldConfig,
  LogLine,
  OkdVariant,
  PanelSocketStatus,
  SocketState,
} from '../shared/types.js';
import { DEFAULT_CONFIG } from '../shared/types.js';
import { getConfig, onConfigChange, setConfig } from '../shared/storage.js';
import { formatTimestamp, isTimestampKey, shortenValue } from '../shared/formatters.js';
import { initSettings } from './settings-view.js';
import {
  ACTIVITY_DECAY_MS,
  COL_HORIZONTAL_PADDING_PX,
  FLASH_COPIED_MS,
  MIN_WIDTH_CH,
  OVERSCAN_PX,
  RATE_WINDOW_MS,
  RECONNECT_BTN_RESET_MS,
  ROW_DETAIL_HEADER_ESTIMATE,
  ROW_DETAIL_PREVIEW_ESTIMATE,
  ROW_INLINE_ESTIMATE,
  ROW_RAW_LINE_ESTIMATE,
  SCROLL_AT_BOTTOM_TOLERANCE_PX,
  SEARCH_DEBOUNCE_MS,
  STATS_INTERVAL_MS,
  WRAP_CAP_CH,
} from './internal/constants.js';
import { cssEscapeKey, formatShortUrl, isNowrapField } from './internal/helpers.js';
import { buildSettingsDrawer, buildFooter } from './internal/dom-builders.js';
import { buildDetailContent, createDetailsRow } from './internal/details-row.js';
import { findRowAtY, rebuildPrefixSum, rowTop, totalHeight } from './internal/virtualization.js';

export interface PanelListener {
  onLinesAppended?(lines: LogLine[]): void;
  onFieldsChanged?(fields: string[]): void;
  onStatusChanged?(status: PanelSocketStatus): void;
  onVariantChanged?(variant: OkdVariant | null): void;
  onReset?(): void;
}

export interface PanelContext {
  getInitialLines(): LogLine[];
  getInitialFields(): string[];
  getInitialStatus(): PanelSocketStatus;
  getVariant(): OkdVariant | null;
  subscribe(listener: PanelListener): () => void;
  reconnect(): void;
}

export interface PanelHandle {
  dispose(): void;
}

const LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];

export function mount(root: ShadowRoot, ctx: PanelContext): PanelHandle {
  const style = document.createElement('style');
  style.textContent = shadowCss;
  root.appendChild(style);

  const rootEl = document.createElement('div');
  rootEl.className = 'root';

  const toolbar = document.createElement('header');
  toolbar.className = 'toolbar';
  const variantBadge = document.createElement('span');
  variantBadge.className = 'badge badge-neutral';
  variantBadge.textContent = '…';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Search';
  searchInput.autocomplete = 'off';
  // Wrap the input so a thin progress bar can sit absolutely along its
  // bottom edge during the debounce window without affecting layout.
  const searchWrap = document.createElement('div');
  searchWrap.className = 'search-wrap';
  searchWrap.appendChild(searchInput);
  const searchProgress = document.createElement('div');
  searchProgress.className = 'search-progress';
  searchWrap.appendChild(searchProgress);
  const levelToggles = document.createElement('div');
  levelToggles.className = 'level-toggles';
  const wrapBtn = document.createElement('button');
  wrapBtn.title =
    'Wrap lines: when on, each entry stays on a single line and the log scrolls horizontally; when off, long lines wrap.';
  wrapBtn.textContent = 'Wrap';
  const pauseBtn = document.createElement('button');
  pauseBtn.title = 'Pause / resume auto-scroll';
  pauseBtn.textContent = '⏸';
  const settingsBtn = document.createElement('button');
  settingsBtn.title = 'Settings';
  settingsBtn.textContent = '⚙';
  toolbar.append(variantBadge, searchWrap, levelToggles, wrapBtn, pauseBtn, settingsBtn);

  const logList = document.createElement('main');
  logList.className = 'log-list';
  logList.setAttribute('role', 'log');
  logList.setAttribute('aria-live', 'polite');
  // CSS Grid layout: each visible field becomes one column. Compact columns
  // (ts/level/traceid) take their max-content width; the last column uses
  // minmax(0, 1fr) so it absorbs the surplus AND can wrap below intrinsic
  // min-content (`min-width: 0`). This is the layout primitive that makes
  // wrap mode actually work — `<table>` with `table-layout:auto` ignores
  // width:100% when content doesn't fit.
  const logBody = document.createElement('div');
  logBody.className = 'log-grid';
  logList.appendChild(logBody);

  const emptyState = document.createElement('div');
  emptyState.className = 'empty-state';
  emptyState.hidden = true;
  const emptyHeadline = document.createElement('div');
  emptyHeadline.className = 'headline';
  emptyHeadline.textContent = 'No log stream yet';
  const emptyHint = document.createElement('div');
  emptyHint.className = 'hint';
  emptyHint.textContent =
    'Open the native Logs tab once to start the OKD log stream, then come back — Pretty will render every line as it arrives.';
  emptyState.append(emptyHeadline, emptyHint);

  const drawer = document.createElement('aside');
  drawer.className = 'settings-drawer';
  drawer.hidden = true;
  const drawerParts = buildSettingsDrawer(drawer);
  const closeSettingsBtn = drawerParts.closeBtn;
  const fieldsList = drawerParts.fieldsList;
  const levelColorsList = drawerParts.levelColorsList;
  const ringInput = drawerParts.ringInput;
  const tsPatternInput = drawerParts.tsPatternInput;
  const resetSettingsBtn = drawerParts.resetBtn;

  const footer = document.createElement('footer');
  footer.className = 'footer';
  const footerParts = buildFooter(footer);
  const connDot = footerParts.connDot;
  const connState = footerParts.connState;
  const connUrl = footerParts.connUrl;
  const reconnectBtn = footerParts.reconnectBtn;
  const rateStat = footerParts.rateStat;
  const counts = footerParts.counts;
  const activity = footerParts.activity;

  reconnectBtn.addEventListener('click', () => {
    reconnectBtn.disabled = true;
    reconnectBtn.textContent = '…';
    ctx.reconnect();
    self.setTimeout(() => {
      reconnectBtn.disabled = false;
      reconnectBtn.textContent = '↻ reconnect';
    }, RECONNECT_BTN_RESET_MS);
  });

  rootEl.append(toolbar, logList, emptyState, drawer, footer);
  root.appendChild(rootEl);

  let config: Config = { ...DEFAULT_CONFIG };
  let allLines: LogLine[] = ctx.getInitialLines().slice();
  let discoveredFields: string[] = ctx.getInitialFields().slice();
  // stickyBottom replaces a discrete "auto-scroll" flag: it's a derived
  // state — true iff the viewport is at the bottom — and its only effect is
  // that ingest pulls the scroll back to the new bottom. Pause toggles it
  // explicitly; user scrolling away/back updates it via the scroll handler.
  let stickyBottom = true;
  let visibleCount = 0;
  let rafScheduled = false;
  let socketStatus: PanelSocketStatus = ctx.getInitialStatus();
  let currentVariant: OkdVariant | null = ctx.getVariant();
  let activityTimer: number | null = null;
  const rateWindow: Array<{ t: number; n: number }> = [];
  let disposed = false;

  const settings = initSettings({
    drawer,
    fieldsList,
    levelColorsList,
    ringInput,
    tsPatternInput,
    closeBtn: closeSettingsBtn,
    resetBtn: resetSettingsBtn,
    getConfig: () => config,
    saveConfig: (c) => {
      config = c;
      setConfig(c).catch(() => {});
      applyLevelColors();
      // shortPattern, timestampPattern, and field visibility all affect
      // rendered cell content lengths — recompute pins before re-applying
      // the grid template so columns reflect the new shape.
      recomputeColumnWidths();
      applyGridTemplate();
      invalidateAllHeights();
    },
  });

  // CSS variables in shadow.css use abbreviated keys that don't match
  // toLowerCase().slice(0,3) — e.g. WARN → `--wrn` (not `--war`),
  // DEBUG → `--dbg` (not `--deb`), TRACE → `--trc` (not `--tra`).
  // Only ERROR and INFO matched by accident, so the picker had no effect
  // on those three levels. Use an explicit map.
  const LEVEL_CSS_VAR: Record<string, string> = {
    ERROR: '--err',
    WARN: '--wrn',
    INFO: '--inf',
    DEBUG: '--dbg',
    TRACE: '--trc',
  };
  function applyLevelColors() {
    for (const [lv, color] of Object.entries(config.levelColors)) {
      const key = LEVEL_CSS_VAR[lv];
      if (key) rootEl.style.setProperty(key, color);
    }
  }

  function renderLevelToggleButtons() {
    levelToggles.textContent = '';
    for (const lv of LEVELS) {
      const b = document.createElement('button');
      b.dataset['level'] = lv;
      b.textContent = lv.slice(0, 3);
      b.title = lv;
      const off = config.filters.levels.length > 0 && !config.filters.levels.includes(lv);
      if (off) b.classList.add('off');
      b.addEventListener('click', () => {
        const set = new Set(config.filters.levels);
        if (set.size === 0) {
          for (const l of LEVELS) if (l !== lv) set.add(l);
        } else if (set.has(lv)) {
          set.delete(lv);
        } else {
          set.add(lv);
        }
        if (set.size === LEVELS.length) set.clear();
        config = { ...config, filters: { ...config.filters, levels: [...set] } };
        setConfig(config).catch(() => {});
        renderLevelToggleButtons();
        rebuildFilter();
      });
      levelToggles.appendChild(b);
    }
  }

  // Pre-lowered query is set whenever filter rebuilds — avoids per-row
  // `search.toLowerCase()` calls inside the matcher.
  let activeSearchLower = '';
  function matchesFilter(line: LogLine): boolean {
    const { levels } = config.filters;
    if (levels.length > 0) {
      if (!line.level || !levels.includes(line.level)) return false;
    }
    if (activeSearchLower) {
      if (!rawLowerOf(line).includes(activeSearchLower)) return false;
    }
    return true;
  }

  function refreshActiveSearch() {
    activeSearchLower = config.filters.search.toLowerCase();
  }

  function applySearchText(value: string) {
    searchInput.value = value;
    config = { ...config, filters: { ...config.filters, search: value } };
    refreshActiveSearch();
    rebuildFilter();
  }

  function flashCopied(el: HTMLElement) {
    el.classList.add('flash-copied');
    self.setTimeout(() => el.classList.remove('flash-copied'), FLASH_COPIED_MS);
  }

  function createCell(f: FieldConfig, v: unknown): HTMLDivElement {
    const cell = document.createElement('div');
    cell.className = `col col-key-${cssEscapeKey(f.key)}`;
    if (isTimestampKey(f.key)) cell.classList.add('ts');
    if (f.key === 'level') cell.classList.add('level');
    if (f.key === 'logger_name') cell.classList.add('logger');
    if (f.key === 'thread_name') cell.classList.add('thread');
    if (f.key === 'traceId' || f.key === 'trace_id') cell.classList.add('traceid');
    if (f.key === 'message') cell.classList.add('message');

    const empty = v === undefined || v === null;
    if (empty) {
      cell.classList.add('empty');
      return cell;
    }

    // Complex values render as a compact placeholder ("{4 keys}", "[3 items]")
    // and createRow wires the cell click to expand/collapse its details row.
    // copy/search settings don't apply — the full structure is only useful
    // pretty-printed and that's offered through the expansion block.
    // Complex values fall through to the standard inline rendering
    // (JSON.stringify produces a single-line raw string). The "detail"
    // checkbox in settings is what opts a field into the expandable sub-row
    // treatment — without it, users see the raw value in the column as for
    // any other scalar.
    const raw = typeof v === 'string' ? v : JSON.stringify(v);
    let display = raw;
    if (isTimestampKey(f.key) && typeof v === 'string') {
      display = formatTimestamp(v, config.timestampPattern);
    }
    const shortened = shortenValue(display, f.shortPattern);
    const wasTransformed = shortened !== raw;
    display = shortened;
    cell.textContent = display;
    if (wasTransformed) cell.title = raw;

    const hasCopy = f.copyOnClick === true;
    const hasSearch = f.searchOnClick === true;
    if (hasCopy || hasSearch) {
      cell.classList.add('clickable');
      if (hasSearch && hasCopy)
        cell.title = `${cell.title || raw}\nclick: search · shift+click: copy`;
      else if (hasSearch) cell.title = cell.title || `click to filter by this value`;
      else cell.title = cell.title || `click to copy`;
      cell.addEventListener('click', (ev) => {
        const shift = ev.shiftKey;
        if (hasSearch && !(shift && hasCopy)) {
          applySearchText(raw);
        } else if (hasCopy) {
          navigator.clipboard.writeText(raw).catch(() => {});
          flashCopied(cell);
        }
      });
    }
    return cell;
  }

  interface RowNodes {
    line: LogLine;
    main: HTMLDivElement;
    // Sub-rows below `main` for stack traces and for any field whose value
    // is a non-empty object/array. Mounted/unmounted together with `main`.
    extras: HTMLDivElement[];
  }

  // === Virtualization ====================================================
  //
  // `allLines` is the source ring buffer. `filteredIndices` is the projection
  // through the active filter — entries are indices into `allLines`, in
  // ascending order. `rowHeights` parallels `filteredIndices` and stores the
  // measured (or estimated) pixel height of each filtered row.
  //
  // At any moment only a small window of rows around the viewport is in the
  // DOM (`mountedRows`). Top/bottom spacers compensate for the missing rows
  // above and below the window so the scroll height matches the full content.
  //
  // Reconcile is the one entry point that brings DOM in sync with the
  // current scroll position + filter. Filter rebuilds, ingestion, scroll,
  // resize, and ResizeObserver height updates all funnel through it.
  const filteredIndices: number[] = [];
  const rowHeights: number[] = [];
  const prefixSums: number[] = [];

  interface MountedRow {
    filteredIdx: number;
    nodes: RowNodes;
  }
  const mountedRows = new Map<number, MountedRow>();

  // Spacers live as direct children of logBody alongside mounted rows. Their
  // heights are kept equal to the total height of un-mounted rows above and
  // below the window respectively, so the scrollbar reflects the entire
  // filtered content as if all rows were rendered.
  const topSpacer = document.createElement('div');
  topSpacer.className = 'log-spacer';
  topSpacer.style.gridColumn = '1 / -1';
  const bottomSpacer = document.createElement('div');
  bottomSpacer.className = 'log-spacer';
  bottomSpacer.style.gridColumn = '1 / -1';
  logBody.appendChild(topSpacer);
  logBody.appendChild(bottomSpacer);

  // Map observed elements back to their filtered index so ResizeObserver
  // callbacks can find which row's height changed.
  const elementToFilteredIdx = new Map<Element, number>();
  // Lowercased raw text cache — avoids two `.toLowerCase()` allocations per
  // row per filter pass when a search query is active.
  const rawLowerCache = new WeakMap<LogLine, string>();
  function rawLowerOf(line: LogLine): string {
    let l = rawLowerCache.get(line);
    if (l === undefined) {
      l = line.raw.toLowerCase();
      rawLowerCache.set(line, l);
    }
    return l;
  }

  // === Column-width pinning =============================================
  //
  // With grid `max-content` tracks, column widths are computed over rows
  // currently in the DOM. Virtualization changes that set as the user
  // scrolls, so columns shimmy whenever an outlier (e.g. ERROR vs INFO,
  // or a long logger name) enters/leaves the window.
  //
  // Pinning fixes the shimmy: walk every filtered row once and remember
  // the longest rendered display per field. The grid template then uses
  // those widths in `ch` units, which is independent of which rows are
  // visible. Pins are agnostic to field semantics — works for any JSON
  // shape; nothing about ts/level/traceId is hard-coded.
  //
  // Pins never shrink between filter rebuilds — that prevents jitter
  // when the line that contributed the max gets trimmed from the ring
  // buffer. A new ingest can grow a pin if it brings longer content.
  // Wrap mode caps every pin at WRAP_CAP_CH so a single rogue value
  // can't push the stretcher column (`message` / 1fr) toward zero —
  // the offending cell instead wraps within its track. No-wrap mode
  // sets no cap; the user explicitly opted into horizontal scroll.
  let columnWidths = new Map<string, number>();

  function renderCellDisplay(v: unknown, f: FieldConfig): string {
    let raw: string;
    if (isTimestampKey(f.key) && typeof v === 'string') {
      raw = formatTimestamp(v, config.timestampPattern);
    } else {
      raw = typeof v === 'string' ? v : JSON.stringify(v);
    }
    return shortenValue(raw, f.shortPattern);
  }

  function recomputeColumnWidths(): void {
    const widths = new Map<string, number>();
    const fields = inlineFields();
    for (const f of fields) widths.set(f.key, MIN_WIDTH_CH);
    for (const fIdx of filteredIndices) {
      const line = allLines[fIdx];
      if (!line?.parsed) continue;
      for (const f of fields) {
        const v = line.parsed[f.key];
        if (v === undefined || v === null) continue;
        const len = renderCellDisplay(v, f).length;
        if (len > (widths.get(f.key) ?? 0)) widths.set(f.key, len);
      }
    }
    columnWidths = widths;
  }

  function growColumnWidthsForLine(line: LogLine, fields: FieldConfig[]): boolean {
    if (!line.parsed) return false;
    let grew = false;
    for (const f of fields) {
      const v = line.parsed[f.key];
      if (v === undefined || v === null) continue;
      const len = renderCellDisplay(v, f).length;
      const cur = columnWidths.get(f.key) ?? MIN_WIDTH_CH;
      if (len > cur) {
        columnWidths.set(f.key, len);
        grew = true;
      }
    }
    return grew;
  }

  function estimateHeightFor(line: LogLine): number {
    if (!line.parsed) {
      const newlines = (line.raw.match(/\n/g) ?? []).length;
      return ROW_INLINE_ESTIMATE + newlines * ROW_RAW_LINE_ESTIMATE;
    }
    let h = ROW_INLINE_ESTIMATE;
    for (const f of config.fields) {
      if (!f.visible || f.showAsDetail !== true) continue;
      const v = line.parsed[f.key];
      if (v === undefined || v === null) continue;
      h += f.detailPreview === true ? ROW_DETAIL_PREVIEW_ESTIMATE : ROW_DETAIL_HEADER_ESTIMATE;
    }
    return h;
  }

  function unmountRow(idx: number, m: MountedRow) {
    unobserveRowElements(m.nodes);
    m.nodes.main.remove();
    for (const x of m.nodes.extras) x.remove();
    mountedRows.delete(idx);
  }

  function unmountAll() {
    for (const [idx, m] of [...mountedRows]) unmountRow(idx, m);
    mountedRows.clear();
  }

  // ResizeObserver target choice: a `display: contents` row has no box, so
  // we observe its first cell instead — all cells in one grid row share the
  // row track height, so any cell's height equals the row height. Raw rows
  // are real `display: block` boxes so we observe them directly. Each detail
  // sub-row is its own box.
  function resizeTargetOf(nodes: RowNodes): Element {
    if (nodes.main.classList.contains('raw')) return nodes.main;
    return (nodes.main.firstElementChild as Element | null) ?? nodes.main;
  }

  function observeRowElements(idx: number, nodes: RowNodes) {
    const target = resizeTargetOf(nodes);
    elementToFilteredIdx.set(target, idx);
    rowObserver.observe(target);
    for (const x of nodes.extras) {
      elementToFilteredIdx.set(x, idx);
      rowObserver.observe(x);
    }
  }

  function unobserveRowElements(nodes: RowNodes) {
    const target = resizeTargetOf(nodes);
    elementToFilteredIdx.delete(target);
    rowObserver.unobserve(target);
    for (const x of nodes.extras) {
      elementToFilteredIdx.delete(x);
      rowObserver.unobserve(x);
    }
  }

  function computeMountedHeight(idx: number): number {
    const m = mountedRows.get(idx);
    if (!m) return rowHeights[idx] ?? ROW_INLINE_ESTIMATE;
    let h: number;
    if (m.nodes.main.classList.contains('raw')) {
      h = m.nodes.main.getBoundingClientRect().height;
    } else {
      const first = m.nodes.main.firstElementChild as HTMLElement | null;
      h = first ? first.getBoundingClientRect().height : 0;
    }
    for (const x of m.nodes.extras) h += x.getBoundingClientRect().height;
    return h;
  }

  const rowObserver = new ResizeObserver((entries) => {
    let dirty = false;
    const seen = new Set<number>();
    for (const e of entries) {
      const idx = elementToFilteredIdx.get(e.target);
      if (idx === undefined || seen.has(idx)) continue;
      seen.add(idx);
      const newH = computeMountedHeight(idx);
      if (Math.abs((rowHeights[idx] ?? 0) - newH) > 0.5) {
        rowHeights[idx] = newH;
        dirty = true;
      }
    }
    if (dirty) requestReconcile();
  });

  let reconcileScheduled = false;
  function requestReconcile() {
    if (reconcileScheduled) return;
    reconcileScheduled = true;
    requestAnimationFrame(() => {
      reconcileScheduled = false;
      reconcileWindow();
    });
  }

  function reconcileWindow() {
    rebuildPrefixSum(rowHeights, prefixSums);
    const total = filteredIndices.length;
    if (total === 0) {
      unmountAll();
      topSpacer.style.height = '0px';
      bottomSpacer.style.height = '0px';
      visibleCount = 0;
      updateStatsText();
      updateEmptyState();
      return;
    }

    const viewportH = logList.clientHeight;
    // Pick the window from a virtual scrollTop. When sticky-bottom is on,
    // we synthesise the bottom-aligned position from `totalHeight()` (which
    // is current) instead of `logList.scrollTop` (which lags by one frame
    // after spacer/height changes). This way new rows mount at the right
    // place on the very first reconcile pass.
    const virtualScrollTop = stickyBottom
      ? Math.max(0, totalHeight(prefixSums) - viewportH)
      : logList.scrollTop;
    const targetTop = Math.max(0, virtualScrollTop - OVERSCAN_PX);
    const targetBottom = virtualScrollTop + viewportH + OVERSCAN_PX;

    const startIdx = findRowAtY(prefixSums, targetTop);
    let endIdx = findRowAtY(prefixSums, targetBottom);
    if (endIdx >= total) endIdx = total - 1;

    // Drop rows outside the window.
    for (const [idx, m] of [...mountedRows]) {
      if (idx < startIdx || idx > endIdx) unmountRow(idx, m);
    }
    // Mount any missing rows in the window.
    for (let i = startIdx; i <= endIdx; i++) {
      if (mountedRows.has(i)) continue;
      const lineIdx = filteredIndices[i]!;
      const line = allLines[lineIdx]!;
      const nodes = createRow(line);
      nodes.main.dataset['fidx'] = String(i);
      mountedRows.set(i, { filteredIdx: i, nodes });
      observeRowElements(i, nodes);
    }
    // Insert mounted rows into the DOM in ascending order between the spacers.
    // Walking ascending and `before(bottomSpacer)`-ing each one yields:
    //   [topSpacer, smallest, ..., largest, bottomSpacer]
    // Already-correctly-positioned rows are no-ops; new rows land in place.
    const sortedKeys = [...mountedRows.keys()].sort((a, b) => a - b);
    for (const idx of sortedKeys) {
      const m = mountedRows.get(idx)!;
      bottomSpacer.before(m.nodes.main);
      for (const x of m.nodes.extras) bottomSpacer.before(x);
    }

    // Spacer heights: top = total height of un-mounted rows above the window,
    // bottom = total height of un-mounted rows below.
    const topPx = rowTop(prefixSums, startIdx);
    const bottomPx = totalHeight(prefixSums) - (prefixSums[endIdx] ?? 0);
    topSpacer.style.height = `${topPx}px`;
    bottomSpacer.style.height = `${Math.max(0, bottomPx)}px`;

    // Sync the real scrollTop after spacers update — scrollHeight now
    // reflects totalHeight, so we can pin the viewport to the actual bottom.
    if (stickyBottom) {
      const target = Math.max(0, logList.scrollHeight - viewportH);
      if (Math.abs(logList.scrollTop - target) > 1) {
        logList.scrollTop = target;
      }
    }

    visibleCount = total;
    updateStatsText();
    updateEmptyState();
  }

  function rebuildFilter() {
    filteredIndices.length = 0;
    rowHeights.length = 0;
    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i]!;
      if (matchesFilter(line)) {
        filteredIndices.push(i);
        rowHeights.push(estimateHeightFor(line));
      }
    }
    // Pins are derived from the filtered set, not the visible window — so
    // they must be refreshed every time the filtered set changes.
    recomputeColumnWidths();
    applyGridTemplate();
    unmountAll();
    // reconcileWindow handles stickyBottom snapping centrally.
    reconcileWindow();
  }

  // Heights depend on wrap mode and grid template — when either changes,
  // existing measurements are stale. Reset to estimates and let the next
  // reconcile + ResizeObserver pass converge to real heights.
  function invalidateAllHeights() {
    for (let i = 0; i < filteredIndices.length; i++) {
      const lineIdx = filteredIndices[i]!;
      const line = allLines[lineIdx];
      rowHeights[i] = line ? estimateHeightFor(line) : ROW_INLINE_ESTIMATE;
    }
    unmountAll();
    reconcileWindow();
  }

  // Inline cells = visible fields where `showAsDetail` is false. Detail
  // fields render as sub-rows that span the full grid via `grid-column: 1/-1`
  // so they don't influence the column tracks here.
  function inlineFields(): FieldConfig[] {
    return config.fields.filter((f) => f.visible && f.showAsDetail !== true);
  }

  // Build grid tracks from the visible inline fields using pinned widths
  // (see columnWidths block above for rationale). Each non-stretcher track
  // is `${pin}ch` so it stays constant as the user scrolls — no more
  // shimmy when an outlier value rolls into the visible window.
  //
  // Wrap mode: one wrappable field (preferring `message`, falling back to
  //   the last wrappable in field order) becomes the stretcher and takes
  //   `minmax(0, 1fr)` to absorb leftover width. All other tracks get
  //   `${min(pin, WRAP_CAP_CH)}ch` so a single rogue long value can't push
  //   the stretcher to zero — the cell wraps within its capped track.
  // No-wrap mode: no stretcher, every track gets `${pin}ch` (uncapped).
  //   The container's `overflow-x: auto` provides horizontal scroll.
  function applyGridTemplate() {
    const fields = inlineFields();
    if (fields.length === 0) {
      logBody.style.gridTemplateColumns = 'minmax(0, 1fr)';
      return;
    }
    const wrappable = fields.filter((f) => !isNowrapField(f.key));
    let stretcherKey: string | null = null;
    if (config.wrapLines && wrappable.length > 0) {
      const msg = wrappable.find((f) => f.key === 'message');
      stretcherKey = (msg ?? wrappable[wrappable.length - 1]!).key;
    }
    const cap = config.wrapLines ? WRAP_CAP_CH : Number.POSITIVE_INFINITY;
    const tracks = fields.map((f) => {
      if (f.key === stretcherKey) return 'minmax(0, 1fr)';
      const pin = columnWidths.get(f.key) ?? MIN_WIDTH_CH;
      const w = Math.max(MIN_WIDTH_CH, Math.min(pin, cap));
      return `calc(${w}ch + ${COL_HORIZONTAL_PADDING_PX}px)`;
    });
    logBody.style.gridTemplateColumns = tracks.join(' ');
  }

  function createRow(line: LogLine): RowNodes {
    const main = document.createElement('div');
    main.className = 'log-row';
    if (line.level) main.classList.add(`lvl-${line.level}`);
    const fields = config.fields.filter((f) => f.visible);

    if (!line.parsed) {
      main.classList.add('raw');
      main.textContent = line.raw;
      return { line, main, extras: [] };
    }

    const parsed = line.parsed;
    const extras: HTMLDivElement[] = [];
    const inline = fields.filter((f) => f.showAsDetail !== true);
    let lastInlineCell: HTMLDivElement | null = null;

    // Walk every visible field in user-configured order so sub-rows below
    // the main row appear in that same order too. Detail mode is now driven
    // exclusively by the per-field `showAsDetail` flag — values, regardless
    // of being object/array, render inline unless the user opted in.
    for (const f of fields) {
      const v = parsed[f.key];

      if (f.showAsDetail === true) {
        const built = buildDetailContent(f, v);
        if (built) {
          const details = createDetailsRow(
            f.key,
            built.content,
            built.kind,
            f.detailPreview === true,
          );
          if (line.level) details.row.classList.add(`lvl-${line.level}`);
          extras.push(details.row);
        }
        continue;
      }

      const cell = createCell(f, v);
      main.appendChild(cell);
      lastInlineCell = cell;
    }

    if (lastInlineCell) lastInlineCell.classList.add('fill');
    // Match grid columns to whatever the current set of inline fields is.
    if (inline.length === 0 && extras.length > 0) {
      // No inline cells at all — make the main row span the full grid so
      // sub-rows below render correctly.
      main.classList.add('hidden-main');
    }
    return { line, main, extras };
  }

  function ingestBatch(lines: LogLine[]) {
    if (lines.length === 0) return;
    const beforeAllLen = allLines.length;
    for (const line of lines) allLines.push(line);
    // Trim oldest entries from the ring buffer.
    let trimmed = 0;
    if (allLines.length > config.ringBuffer) {
      trimmed = allLines.length - config.ringBuffer;
      allLines.splice(0, trimmed);
    }
    if (trimmed > 0) {
      // Drop filtered rows that pointed at trimmed-out lines.
      let drop = 0;
      while (drop < filteredIndices.length && filteredIndices[drop]! < trimmed) drop++;
      if (drop > 0) {
        for (const [idx, m] of [...mountedRows]) {
          if (idx < drop) unmountRow(idx, m);
        }
        filteredIndices.splice(0, drop);
        rowHeights.splice(0, drop);
        // Rekey the surviving mounted rows: the filteredIdx of every row
        // shifts down by `drop`. The map keys are integers, so we rebuild it.
        const remapped = new Map<number, MountedRow>();
        for (const [idx, m] of mountedRows) {
          const next = idx - drop;
          m.filteredIdx = next;
          m.nodes.main.dataset['fidx'] = String(next);
          remapped.set(next, m);
        }
        mountedRows.clear();
        for (const [k, v] of remapped) mountedRows.set(k, v);
        for (const [el, idx] of elementToFilteredIdx) {
          elementToFilteredIdx.set(el, idx - drop);
        }
      }
      // The remaining filteredIndices values point into the OLD allLines
      // positions; shift them to the new positions.
      for (let i = 0; i < filteredIndices.length; i++) {
        filteredIndices[i] = filteredIndices[i]! - trimmed;
      }
    }
    // Append new lines that pass the active filter, and grow column pins
    // monotonically — pins never shrink mid-flight, only on the next full
    // rebuildFilter, which keeps the layout stable while logs stream in.
    const newStart = Math.max(0, beforeAllLen - trimmed);
    const inlines = inlineFields();
    let widthsGrew = false;
    for (let i = newStart; i < allLines.length; i++) {
      const line = allLines[i]!;
      if (matchesFilter(line)) {
        filteredIndices.push(i);
        rowHeights.push(estimateHeightFor(line));
        if (growColumnWidthsForLine(line, inlines)) widthsGrew = true;
      }
    }
    if (widthsGrew) applyGridTemplate();
    recordRate(lines.length);
    kickActivity();
    scheduleFlush();
  }

  function scheduleFlush() {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      reconcileWindow();
    });
  }

  function kickActivity() {
    activity.classList.add('live');
    if (activityTimer !== null) clearTimeout(activityTimer);
    activityTimer = self.setTimeout(() => {
      activity.classList.remove('live');
      activityTimer = null;
    }, ACTIVITY_DECAY_MS);
  }

  function recordRate(n: number) {
    const now = performance.now();
    rateWindow.push({ t: now, n });
    const cutoff = now - RATE_WINDOW_MS;
    while (rateWindow.length > 0 && rateWindow[0]!.t < cutoff) rateWindow.shift();
  }

  function currentRate(): number {
    const now = performance.now();
    const cutoff = now - RATE_WINDOW_MS;
    let total = 0;
    let minT = now;
    for (const e of rateWindow) {
      if (e.t < cutoff) continue;
      total += e.n;
      if (e.t < minT) minT = e.t;
    }
    const span = Math.max(0.5, (now - minT) / 1000);
    if (total === 0) return 0;
    return total / span;
  }

  function updateStatsText() {
    counts.textContent = `${allLines.length} / ${visibleCount}`;
    const r = currentRate();
    rateStat.textContent = r >= 10 ? `${Math.round(r)} l/s` : `${r.toFixed(1)} l/s`;
  }

  function applySocketStatus(s: PanelSocketStatus) {
    socketStatus = s;
    const st: SocketState = s.state;
    connDot.className = `conn-dot conn-${st}`;
    connState.textContent = st === 'idle' ? 'waiting' : st;
    connUrl.textContent = formatShortUrl(s.url);
    connUrl.title = s.url ?? '';
    reconnectBtn.hidden = st !== 'closed';
    updateStatsText();
    updateEmptyState();
  }

  function updateEmptyState() {
    const empty = allLines.length === 0;
    emptyState.hidden = !empty;
    logList.hidden = empty;
  }

  function setVariantBadge(v: OkdVariant | null) {
    currentVariant = v;
    variantBadge.className =
      'badge ' + (v === 'okd3' ? 'badge-okd3' : v === 'okd4' ? 'badge-okd4' : 'badge-neutral');
    variantBadge.textContent = v === 'okd3' ? 'OKD 3' : v === 'okd4' ? 'OKD 4' : 'OKD?';
  }

  // Debounced search: even with virtualization, every keystroke rebuilds the
  // filter, which walks all of allLines. The 200ms debounce coalesces fast
  // typing into a single rebuild. The progress bar tells the user their
  // keystroke registered.
  let searchTimer: number | null = null;
  searchInput.addEventListener('input', () => {
    searchProgress.classList.add('active');
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = self.setTimeout(() => {
      searchTimer = null;
      config = { ...config, filters: { ...config.filters, search: searchInput.value } };
      refreshActiveSearch();
      searchProgress.classList.remove('active');
      rebuildFilter();
    }, SEARCH_DEBOUNCE_MS);
  });

  function applyWrapClass() {
    // `.nowrap` enforces white-space: nowrap on cells; class is on iff wrap is OFF.
    rootEl.classList.toggle('nowrap', config.wrapLines !== true);
    wrapBtn.classList.toggle('active', config.wrapLines === true);
    applyGridTemplate();
    // Going from nowrap (with horizontal scroll) back to wrap leaves the
    // container scrolled to whatever offset the user reached. The horizontal
    // overflow vanishes but the scrollLeft sticks, so the visible viewport
    // stays shifted right with no scrollbar to bring it back. Reset it.
    if (config.wrapLines) logList.scrollLeft = 0;
    // Wrap toggling changes every row's height. Reset estimates and let the
    // next mount + ResizeObserver pass converge on the real values.
    invalidateAllHeights();
  }

  wrapBtn.addEventListener('click', () => {
    config = { ...config, wrapLines: !config.wrapLines };
    applyWrapClass();
    setConfig(config).catch(() => {});
  });

  pauseBtn.addEventListener('click', () => {
    stickyBottom = !stickyBottom;
    pauseBtn.textContent = stickyBottom ? '⏸' : '▶';
    pauseBtn.classList.toggle('active', !stickyBottom);
    // reconcile owns the actual scroll snap when sticky.
    if (stickyBottom) requestReconcile();
  });

  settingsBtn.addEventListener('click', () => {
    if (drawer.hidden) settings.open();
    else settings.close();
  });

  logList.addEventListener('scroll', () => {
    // Distance from the bottom that still counts as "at the bottom" — generous
    // to absorb sub-pixel rounding and the few-px gap left by some browsers
    // when a programmatic scrollTop assignment lands.
    const atBottom =
      logList.scrollHeight - logList.clientHeight - logList.scrollTop <
      SCROLL_AT_BOTTOM_TOLERANCE_PX;
    if (atBottom !== stickyBottom) {
      stickyBottom = atBottom;
      pauseBtn.textContent = stickyBottom ? '⏸' : '▶';
      pauseBtn.classList.toggle('active', !stickyBottom);
    }
    requestReconcile();
  });

  const viewportObserver = new ResizeObserver(() => requestReconcile());
  viewportObserver.observe(logList);

  const statsTimer = self.setInterval(updateStatsText, STATS_INTERVAL_MS);

  const unsubscribe = ctx.subscribe({
    onLinesAppended(lines) {
      ingestBatch(lines);
    },
    onFieldsChanged(fields) {
      discoveredFields = fields;
      settings.setDiscoveredFields(discoveredFields);
    },
    onStatusChanged(status) {
      applySocketStatus(status);
    },
    onVariantChanged(v) {
      setVariantBadge(v);
    },
    onReset() {
      allLines = [];
      rateWindow.length = 0;
      activity.classList.remove('live');
      if (activityTimer !== null) {
        clearTimeout(activityTimer);
        activityTimer = null;
      }
      stickyBottom = true;
      rebuildFilter();
      setVariantBadge(ctx.getVariant());
    },
  });

  const unsubscribeConfig = onConfigChange((c) => {
    if (disposed) return;
    // Preserve the live search value: it's session-only and storage always
    // serialises it as ''. Using the incoming '' would wipe what the user
    // just typed whenever any other config field changes.
    const liveSearch = config.filters.search;
    config = { ...c, filters: { ...c.filters, search: liveSearch } };
    refreshActiveSearch();
    applyLevelColors();
    applyWrapClass();
    renderLevelToggleButtons();
    settings.refresh(config);
    rebuildFilter();
  });

  (async () => {
    try {
      config = await getConfig();
    } catch {
      /* keep defaults */
    }
    if (disposed) return;
    refreshActiveSearch();
    applyLevelColors();
    applyWrapClass();
    renderLevelToggleButtons();
    searchInput.value = config.filters.search;
    settings.setDiscoveredFields(discoveredFields);
    setVariantBadge(currentVariant);
    applySocketStatus(socketStatus);
    rebuildFilter();
  })();

  return {
    dispose() {
      disposed = true;
      unsubscribe();
      unsubscribeConfig();
      clearInterval(statsTimer);
      if (activityTimer !== null) {
        clearTimeout(activityTimer);
        activityTimer = null;
      }
      if (searchTimer !== null) {
        clearTimeout(searchTimer);
        searchTimer = null;
      }
      rowObserver.disconnect();
      viewportObserver.disconnect();
    },
  };
}
