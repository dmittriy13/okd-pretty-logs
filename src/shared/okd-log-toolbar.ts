import type { OkdVariant } from './types.js';

export interface LogToolbarRefs {
  variant: OkdVariant;
  // Toolbar element where we observe for re-renders.
  toolbar: HTMLElement;
  // Insertion point for our toggle (rightmost group on each console).
  mountPoint: HTMLElement;
  // Log content area below the toolbar — used to size the overlay.
  contentArea: HTMLElement;
}

// Locate the native log-viewer toolbar on either console.
//
// OKD 4 (PatternFly): <div class="pf-v5-c-log-viewer__header"><div class="co-toolbar">…
// The right group hosts checkbox-style toggles (Wrap lines, Raw) inside a
// `.pf-v5-l-flex` flex container — the natural spot for our toggle.
//
// OKD 3 (Bootstrap/Angular): <log-viewer><div class="log-header">
//   <div class="log-status">…</div><div class="log-actions">Save | Expand</div>
// Bootstrap inline-checkbox fits cleanly next to Save/Expand.
export function findLogToolbar(): LogToolbarRefs | null {
  const pf = document.querySelector<HTMLElement>('.pf-v5-c-log-viewer__header .co-toolbar');
  if (pf) {
    const flex = pf.querySelector<HTMLElement>('.co-toolbar__group--right .pf-v5-l-flex');
    const content = document.querySelector<HTMLElement>('.pf-v5-c-log-viewer__main');
    if (flex && content) {
      return { variant: 'okd4', toolbar: pf, mountPoint: flex, contentArea: content };
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
      return { variant: 'okd3', toolbar: lh, mountPoint: actions, contentArea: content };
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

// Build a toggle that visually matches the host console's toolbar conventions.
// The caller wires the `onToggle` callback for state changes. The returned
// element is a wrapper that includes a leading `|` divider so the toggle
// reads as a separate group from the toolbar's existing items.
export function buildPrettyToggle(
  variant: OkdVariant,
  label: string,
  initialActive: boolean,
  onToggle: (next: boolean) => void,
): ToggleHandle {
  if (variant === 'okd4') {
    const wrap = document.createElement('div');
    wrap.setAttribute(PRETTY_TOGGLE_ATTR, '1');
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '8px';
    const divider = document.createElement('span');
    divider.textContent = '|';
    divider.style.opacity = '0.4';
    const check = document.createElement('div');
    check.className = 'pf-v5-c-check';
    const id = `pretty-toggle-${Math.random().toString(36).slice(2, 8)}`;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.className = 'pf-v5-c-check__input';
    input.checked = initialActive;
    const lbl = document.createElement('label');
    lbl.className = 'pf-v5-c-check__label';
    lbl.htmlFor = id;
    lbl.textContent = label;
    check.append(input, lbl);
    wrap.append(divider, check);
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
