// Small pure helpers used throughout the panel view. Kept here so the main
// `mount()` closure isn't peppered with one-off utility functions.

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
