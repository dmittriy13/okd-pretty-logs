import type { OkdVariant } from './types.js';

// PatternFly class prefix used by the OKD 4 console build.
export type PfPrefix = 'pf-v5' | 'pf-v6';

export interface LogToolbarRefs {
  variant: OkdVariant;
  // PatternFly prefix for the toggle's classes; null on OKD 3.
  pf: PfPrefix | null;
  // Toolbar element where we observe for re-renders.
  toolbar: HTMLElement;
  // Insertion point for our toggle (next to the native view options).
  mountPoint: HTMLElement;
  // Log content area below the toolbar — used to size the overlay.
  contentArea: HTMLElement;
}

// Locate the native log-viewer toolbar on either console.
//
// OKD 4 (PatternFly 6): <div class="pf-v6-c-log-viewer__header"><div class="pf-v6-c-toolbar">…
// Wrap lines / Raw moved into an "Options" menu at the end of the left
// (`.pf-m-align-start`) group — our toggle goes right after it.
//
// OKD 4 (PatternFly 5): <div class="pf-v5-c-log-viewer__header"><div class="co-toolbar">…
// The right group hosts checkbox-style toggles (Wrap lines, Raw) inside a
// `.pf-v5-l-flex` flex container — the natural spot for our toggle.
//
// OKD 3 (Bootstrap/Angular): <log-viewer><div class="log-header">
//   <div class="log-status">…</div><div class="log-actions">Save | Expand</div>
// Bootstrap inline-checkbox fits cleanly next to Save/Expand.
export function findLogToolbar(): LogToolbarRefs | null {
  const pf6 = document.querySelector<HTMLElement>('.pf-v6-c-log-viewer__header .pf-v6-c-toolbar');
  if (pf6) {
    const group = pf6.querySelector<HTMLElement>('.pf-v6-c-toolbar__group.pf-m-align-start');
    const content = document.querySelector<HTMLElement>('.pf-v6-c-log-viewer__main');
    if (group && content) {
      return {
        variant: 'okd4',
        pf: 'pf-v6',
        toolbar: pf6,
        mountPoint: group,
        contentArea: content,
      };
    }
  }
  const pf = document.querySelector<HTMLElement>('.pf-v5-c-log-viewer__header .co-toolbar');
  if (pf) {
    const flex = pf.querySelector<HTMLElement>('.co-toolbar__group--right .pf-v5-l-flex');
    const content = document.querySelector<HTMLElement>('.pf-v5-c-log-viewer__main');
    if (flex && content) {
      return { variant: 'okd4', pf: 'pf-v5', toolbar: pf, mountPoint: flex, contentArea: content };
    }
  }
  const lh = document.querySelector<HTMLElement>('log-viewer .log-header, .log-header');
  if (lh) {
    let actions = lh.querySelector<HTMLElement>('.log-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'log-actions';
      lh.appendChild(actions);
    }
    const lvParent = lh.parentElement;
    const content = (lvParent?.querySelector<HTMLElement>('.log-view') ??
      lh.nextElementSibling) as HTMLElement | null;
    if (content) {
      return { variant: 'okd3', pf: null, toolbar: lh, mountPoint: actions, contentArea: content };
    }
  }
  return null;
}

export interface ToggleHandle {
  // Outer element to insert into the toolbar.
  el: HTMLElement;
  // Reflect external state (e.g. on re-injection after a re-render).
  setActive(active: boolean): void;
}

export const PRETTY_TOGGLE_ATTR = 'data-pretty-toggle';

const NATIVE_HIDDEN_ATTR = 'data-okd-pretty-active';
const NATIVE_HIDE_STYLE_ID = 'okd-pretty-native-hide';

// While the overlay is up, the console's own log controls (pause, container
// select, Options, search, log type) only drive the native viewer hidden
// beneath it. Allow-list rather than per-control selectors (aria-labels are
// localised): only our toggle and the trailing icon actions (raw, download,
// expand) stay visible. PatternFly 6 only — older toolbars are left untouched.
const NATIVE_HIDE_CSS = `
html[${NATIVE_HIDDEN_ATTR}] .pf-v6-c-log-viewer__header .pf-v6-c-toolbar__group.pf-m-align-start > :not([${PRETTY_TOGGLE_ATTR}]),
html[${NATIVE_HIDDEN_ATTR}] .pf-v6-c-log-viewer__header .pf-v6-c-toolbar__group.pf-m-align-end > :not(.pf-m-action-group-plain) {
  display: none !important;
}`;

// Driven by a flag on <html> instead of per-element styles so the rules
// survive React re-rendering the toolbar.
export function setNativeControlsHidden(hidden: boolean): void {
  if (hidden && !document.getElementById(NATIVE_HIDE_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = NATIVE_HIDE_STYLE_ID;
    style.textContent = NATIVE_HIDE_CSS;
    (document.head ?? document.documentElement).appendChild(style);
  }
  document.documentElement.toggleAttribute(NATIVE_HIDDEN_ATTR, hidden);
}

// Build a toggle that visually matches the host console's toolbar conventions.
// The caller wires the `onToggle` callback for state changes. On PatternFly 5
// and OKD 3 the returned wrapper includes a leading `|` divider so the toggle
// reads as a separate group from the toolbar's existing items; on PatternFly 6
// it is a regular toolbar item and inherits the toolbar's own spacing.
export function buildPrettyToggle(
  target: Pick<LogToolbarRefs, 'variant' | 'pf'>,
  label: string,
  initialActive: boolean,
  onToggle: (next: boolean) => void,
): ToggleHandle {
  if (target.variant === 'okd4') {
    const pf = target.pf ?? 'pf-v5';
    const wrap = document.createElement('div');
    wrap.setAttribute(PRETTY_TOGGLE_ATTR, '1');
    if (pf === 'pf-v6') {
      wrap.className = 'pf-v6-c-toolbar__item';
    } else {
      wrap.style.display = 'inline-flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '8px';
      const divider = document.createElement('span');
      divider.textContent = '|';
      divider.style.opacity = '0.4';
      wrap.append(divider);
    }
    const check = document.createElement('div');
    check.className = `${pf}-c-check`;
    const id = `pretty-toggle-${Math.random().toString(36).slice(2, 8)}`;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.className = `${pf}-c-check__input`;
    input.checked = initialActive;
    const lbl = document.createElement('label');
    lbl.className = `${pf}-c-check__label`;
    lbl.htmlFor = id;
    lbl.textContent = label;
    check.append(input, lbl);
    wrap.append(check);
    input.addEventListener('change', () => onToggle(input.checked));
    return {
      el: wrap,
      setActive(active) {
        if (input.checked !== active) input.checked = active;
      },
    };
  }
  // OKD 3: Bootstrap-style inline checkbox with the same `|` divider OKD uses
  // between Save and Expand (.action-divider).
  const wrap = document.createElement('span');
  wrap.setAttribute(PRETTY_TOGGLE_ATTR, '1');
  const divider = document.createElement('span');
  divider.className = 'action-divider';
  divider.textContent = '|';
  const lbl = document.createElement('label');
  lbl.className = 'checkbox-inline';
  lbl.style.marginLeft = '6px';
  lbl.style.cursor = 'pointer';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = initialActive;
  input.style.marginRight = '4px';
  input.style.verticalAlign = 'middle';
  lbl.append(input, document.createTextNode(label));
  wrap.append(divider, lbl);
  input.addEventListener('change', () => onToggle(input.checked));
  return {
    el: wrap,
    setActive(active) {
      if (input.checked !== active) input.checked = active;
    },
  };
}
