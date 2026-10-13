// Small pure helpers used throughout the panel view. Kept here so the main
// `mount()` closure isn't peppered with one-off utility functions.

import { COL_HORIZONTAL_PADDING_PX, MIN_WIDTH_CH, WRAP_CAP_CH } from './constants.js';

export function cssEscapeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// "Complex" = any object/array we should render as an expandable sub-row.
// Empty objects/arrays and `null` render inline as scalars instead so the
// panel isn't polluted with empty expansion blocks.
export function isComplexValue(v: unknown): v is object {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.length > 0;
  return Object.keys(v as Record<string, unknown>).length > 0;
}

export function summarizeComplex(v: object): string {
  if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? '' : 's'}]`;
  const n = Object.keys(v as Record<string, unknown>).length;
  return `{${n} key${n === 1 ? '' : 's'}}`;
}

// Short, structural fields rendered with `white-space: nowrap` in CSS.
// They shouldn't be forced to wrap when their natural width is small, so
// they get a `max-content` track. Everything else is treated as wrappable.
export function isNowrapField(key: string): boolean {
  return (
    key === '@timestamp' ||
    key === 'timestamp' ||
    key === 'time' ||
    key === 'ts' ||
    key === 'level' ||
    key === 'traceId' ||
    key === 'trace_id'
  );
}

// Grid tracks for the visible inline fields, in field order. Widths come from
// the pinned per-field `ch` counts (see the columnWidths block in
// panel-view.ts) so they stay constant as the user scrolls.
//
// Wrap mode: one wrappable field (preferring `message`, falling back to
//   the last wrappable in field order) becomes the stretcher and takes
//   `minmax(0, 1fr)` to absorb leftover width. All other tracks get
//   `${min(pin, WRAP_CAP_CH)}ch` so a single rogue long value can't push
//   the stretcher to zero — the cell wraps within its capped track.
// No-wrap mode: every track gets `${pin}ch` (uncapped). The container's
//   `overflow-x: auto` provides horizontal scroll.
// Without a stretcher (no-wrap, or only nowrap fields like ts/level visible)
// the last track becomes `minmax(<pinned width>, 1fr)`: it never shrinks
// below its pin but absorbs any surplus, so rows span the full panel instead
// of leaving an empty band on the right.
export function buildGridTracks(
  fields: readonly { key: string }[],
  columnWidths: ReadonlyMap<string, number>,
  wrapLines: boolean,
): string[] {
  if (fields.length === 0) return ['minmax(0, 1fr)'];
  const wrappable = fields.filter((f) => !isNowrapField(f.key));
  let stretcherKey: string | null = null;
  if (wrapLines && wrappable.length > 0) {
    const msg = wrappable.find((f) => f.key === 'message');
    stretcherKey = (msg ?? wrappable[wrappable.length - 1]!).key;
  }
  const cap = wrapLines ? WRAP_CAP_CH : Number.POSITIVE_INFINITY;
  const tracks = fields.map((f) => {
    if (f.key === stretcherKey) return 'minmax(0, 1fr)';
    const pin = columnWidths.get(f.key) ?? MIN_WIDTH_CH;
    const w = Math.max(MIN_WIDTH_CH, Math.min(pin, cap));
    return `calc(${w}ch + ${COL_HORIZONTAL_PADDING_PX}px)`;
  });
  if (stretcherKey === null) {
    const last = tracks.length - 1;
    tracks[last] = `minmax(${tracks[last]}, 1fr)`;
  }
  return tracks;
}

export function formatShortUrl(url: string | null): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const pods = u.pathname.match(/\/pods\/([^/]+)/);
    const ns = u.pathname.match(/\/namespaces\/([^/]+)/);
    const parts: string[] = [];
    if (ns) parts.push(`ns=${ns[1]}`);
    if (pods) parts.push(`pod=${pods[1]}`);
    return parts.length ? parts.join(' ') : u.pathname;
  } catch {
    return url;
  }
}
