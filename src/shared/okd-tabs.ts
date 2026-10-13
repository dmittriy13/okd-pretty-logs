// Helpers used only by the reconnect flow: navigate away from /logs and back
// so the host framework remounts the native log component (which re-opens
// the WebSocket). Tab-injection helpers were dropped along with the embedded
// custom tab in favour of an in-toolbar toggle.

const TABLIST_SELECTORS = [
  '.co-m-horizontal-nav [role="tablist"]',
  '.co-m-horizontal-nav__menu',
  '.pf-v6-c-tabs__list',
  '.pf-v5-c-tabs__list',
  '.pf-c-tabs__list',
  '.horizontal-nav-tabs',
  '.nav.nav-tabs',
];

export function findTabList(doc: Document = document): HTMLElement | null {
  for (const sel of TABLIST_SELECTORS) {
    const el = doc.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

export function findLogsTab(tabList: HTMLElement): HTMLElement | null {
  const candidates = tabList.querySelectorAll<HTMLElement>('a, button, [role="tab"]');
  for (const el of candidates) {
    const text = (el.textContent ?? '').trim().toLowerCase();
    if (text === 'logs' || text === 'log') return el;
  }
  return null;
}

// Pick any tab that isn't Logs — used by reconnect to wiggle the route.
export function findSiblingTab(tabList: HTMLElement, exclude: HTMLElement): HTMLElement | null {
  const candidates = tabList.querySelectorAll<HTMLElement>('a, button, [role="tab"]');
  for (const el of candidates) {
    if (el === exclude || exclude.contains(el)) continue;
    const txt = (el.textContent ?? '').trim().toLowerCase();
    if (!txt || txt === 'logs' || txt === 'log') continue;
    return el;
  }
  return null;
}
