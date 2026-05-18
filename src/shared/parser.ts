import type { LogLine } from './types.js';

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export interface DecoderState {
  tail: Uint8Array;
  seq: number;
  // Some apps (e.g. Spring Boot with logback's JsonLayout pretty-printed)
  // emit one logical log entry across many newline-delimited fragments.
  // We accumulate such fragments until the brace count balances, then emit
  // them as a single LogLine. `pending` holds the in-flight buffer + depth.
  pending: { text: string; depth: number; t: number } | null;
}

export function makeDecoderState(): DecoderState {
  return { tail: new Uint8Array(0), seq: 0, pending: null };
}

const PENDING_MAX_LEN = 64 * 1024;

const CHAR_BACKSLASH = 0x5c;
const CHAR_QUOTE = 0x22;
const CHAR_LBRACE = 0x7b;
const CHAR_RBRACE = 0x7d;
const NL = 0x0a;
const CR = 0x0d;

// Count net `{` − `}` occurring outside of JSON strings on this line.
// Strings in JSON cannot span newlines, so we always start outside a string;
// `\\` escapes are still tracked within the line.
function lineBraceDelta(s: string): number {
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (escape) {
      escape = false;
      continue;
    }
    if (inStr) {
      if (c === CHAR_BACKSLASH) escape = true;
      else if (c === CHAR_QUOTE) inStr = false;
      continue;
    }
    if (c === CHAR_QUOTE) {
      inStr = true;
      continue;
    }
    if (c === CHAR_LBRACE) depth++;
    else if (c === CHAR_RBRACE) depth--;
  }
  return depth;
}

function findLevel(parsed: Record<string, unknown> | null): string | undefined {
  if (!parsed) return undefined;
  const v = parsed['level'];
  if (typeof v === 'string') return v.toUpperCase();
  return undefined;
}

function findTimestamp(parsed: Record<string, unknown> | null): string | undefined {
  if (!parsed) return undefined;
  const keys = ['@timestamp', 'timestamp', 'time', 'ts'];
  for (const k of keys) {
    const v = parsed[k];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

function tryParseJson(line: string): Record<string, unknown> | null {
  const t = line.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  try {
    const v = JSON.parse(t) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  return null;
}

function emitLine(
  state: DecoderState,
  raw: string,
  socketId: number,
  now: number,
  lines: LogLine[],
): void {
  const parsed = tryParseJson(raw);
  lines.push({
    socketId,
    seq: ++state.seq,
    t: now,
    raw,
    parsed,
    level: findLevel(parsed),
    timestamp: findTimestamp(parsed),
  });
}

// Feed a single newline-delimited fragment into the JSON-merger. Either emits
// a finished log entry into `lines`, or stores the fragment in `state.pending`
// for the next call to complete.
function feedFragment(
  state: DecoderState,
  fragment: string,
  socketId: number,
  now: number,
  lines: LogLine[],
): void {
  if (state.pending) {
    state.pending.text += '\n' + fragment;
    state.pending.depth += lineBraceDelta(fragment);
    if (state.pending.depth <= 0 || state.pending.text.length > PENDING_MAX_LEN) {
      const text = state.pending.text;
      const t = state.pending.t;
      state.pending = null;
      emitLine(state, text, socketId, t, lines);
    }
    return;
  }
  const trimmed = fragment.trim();
  if (trimmed.startsWith('{')) {
    const delta = lineBraceDelta(fragment);
    if (delta <= 0) {
      emitLine(state, fragment, socketId, now, lines);
    } else {
      state.pending = { text: fragment, depth: delta, t: now };
    }
    return;
  }
  emitLine(state, fragment, socketId, now, lines);
}

export function decodeBase64Chunk(
  state: DecoderState,
  base64Payload: string,
  socketId: number,
  now: number,
  decoder: TextDecoder = new TextDecoder('utf-8'),
): LogLine[] {
  if (!base64Payload) return [];
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(base64Payload);
  } catch {
    return [];
  }
  const combined = state.tail.length ? concatBytes(state.tail, bytes) : bytes;
  const lines: LogLine[] = [];
  let start = 0;
  for (let i = 0; i < combined.length; i++) {
    if (combined[i] === NL) {
      let end = i;
      if (end > start && combined[end - 1] === CR) end--;
      const slice = combined.subarray(start, end);
      const raw = decoder.decode(slice);
      if (raw.length > 0 || end !== start) {
        feedFragment(state, raw, socketId, now, lines);
      }
      start = i + 1;
    }
  }
  state.tail = start < combined.length ? combined.subarray(start) : new Uint8Array(0);
  return lines;
}

export function flushTail(state: DecoderState, socketId: number, now: number): LogLine[] {
  const lines: LogLine[] = [];
  if (state.tail.length > 0) {
    const raw = new TextDecoder('utf-8').decode(state.tail);
    state.tail = new Uint8Array(0);
    if (raw) feedFragment(state, raw, socketId, now, lines);
  }
  // On stream close, surface any half-completed multi-line JSON as raw text
  // so the user can still inspect it (rather than dropping it silently).
  if (state.pending) {
    const text = state.pending.text;
    const t = state.pending.t;
    state.pending = null;
    emitLine(state, text, socketId, t, lines);
  }
  return lines;
}

export const POD_LOG_URL_RE =
  /\/(?:api\/kubernetes\/)?api\/v1\/namespaces\/[^/]+\/pods\/[^/]+\/log(?:\?|$)/;
