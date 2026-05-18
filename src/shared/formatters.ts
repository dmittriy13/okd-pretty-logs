// Timestamp pattern tokens: YYYY MM DD HH mm ss SSS Z
// Local time is used; the input's own TZ offset is only consulted for Z.
export function formatTimestamp(input: string, pattern: string): string {
  if (!input) return input;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  // JS Date drops sub-millisecond precision. Re-extract the fractional part
  // from the original string so `.SSS` always has 3 digits even when the
  // source uses nanoseconds (e.g. "2026-04-22T23:56:55.1188711436+03:00").
  const frac = input.match(/\.(\d+)/);
  const millis = frac ? (frac[1] ?? '').slice(0, 3).padEnd(3, '0') : '000';
  const tzMatch = input.match(/([+-]\d{2}:?\d{2}|Z)$/);
  const tz = tzMatch ? tzMatch[1]! : '';

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const map: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM: pad2(d.getMonth() + 1),
    DD: pad2(d.getDate()),
    HH: pad2(d.getHours()),
    mm: pad2(d.getMinutes()),
    ss: pad2(d.getSeconds()),
    SSS: millis,
    Z: tz,
  };
  // Replace longest tokens first so `SSS` wins over `ss`, `YYYY` over nothing.
  return pattern.replace(/YYYY|SSS|MM|DD|HH|mm|ss|Z/g, (m) => map[m] ?? m);
}

// Shorten a string by a pattern of the form `####*####` where the number of
// `#`s before `*` is the head length and the number after is the tail length.
// Everything in between is replaced with an ellipsis. Pattern without `*` or
// without any `#` returns the value unchanged. If the value is already short
// enough (head + tail + 1 ≥ length), no shortening happens.
export function shortenValue(value: string, pattern: string | undefined | null): string {
  if (!pattern) return value;
  const starIdx = pattern.indexOf('*');
  if (starIdx < 0) return value;
  const head = countHashes(pattern.slice(0, starIdx));
  const tail = countHashes(pattern.slice(starIdx + 1));
  if (head + tail === 0) return value;
  if (value.length <= head + tail + 1) return value;
  return value.slice(0, head) + '…' + value.slice(value.length - tail);
}

function countHashes(s: string): number {
  let n = 0;
  for (const ch of s) if (ch === '#') n++;
  return n;
}

export const TIMESTAMP_KEYS = new Set(['@timestamp', 'timestamp', 'time', 'ts']);

export function isTimestampKey(key: string): boolean {
  return TIMESTAMP_KEYS.has(key);
}
