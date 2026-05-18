import { describe, expect, it } from 'vitest';
import { decodeBase64Chunk, flushTail, makeDecoderState } from '../src/shared/parser.js';

function b64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}
function b64bytes(b: Uint8Array): string {
  return Buffer.from(b).toString('base64');
}

describe('decodeBase64Chunk', () => {
  it('parses a single JSON line', () => {
    const s = makeDecoderState();
    const out = decodeBase64Chunk(s, b64('{"level":"INFO","message":"hi"}\n'), 1, 100);
    expect(out).toHaveLength(1);
    expect(out[0]!.parsed).toEqual({ level: 'INFO', message: 'hi' });
    expect(out[0]!.level).toBe('INFO');
    expect(out[0]!.raw).toBe('{"level":"INFO","message":"hi"}');
  });

  it('splits multi-line frames into separate lines', () => {
    const s = makeDecoderState();
    const payload = '{"level":"INFO","message":"a"}\n{"level":"WARN","message":"b"}\n';
    const out = decodeBase64Chunk(s, b64(payload), 1, 100);
    expect(out).toHaveLength(2);
    expect(out[0]!.level).toBe('INFO');
    expect(out[1]!.level).toBe('WARN');
  });

  it('falls back to raw string on non-JSON lines', () => {
    const s = makeDecoderState();
    const out = decodeBase64Chunk(s, b64('plain text not json\n'), 1, 100);
    expect(out).toHaveLength(1);
    expect(out[0]!.parsed).toBeNull();
    expect(out[0]!.raw).toBe('plain text not json');
    expect(out[0]!.level).toBeUndefined();
  });

  it('mixes JSON and non-JSON in one frame', () => {
    const s = makeDecoderState();
    const payload =
      '[0.006s][warning][metaspace] tuned\n{"level":"INFO","message":"started"}\nlogback bootstrap line\n';
    const out = decodeBase64Chunk(s, b64(payload), 1, 100);
    expect(out).toHaveLength(3);
    expect(out[0]!.parsed).toBeNull();
    expect(out[1]!.parsed).not.toBeNull();
    expect(out[2]!.parsed).toBeNull();
  });

  it('buffers a partial line across two frames', () => {
    const s = makeDecoderState();
    const part1 = b64('{"level":"INFO","mes');
    const part2 = b64('sage":"hi"}\n');
    const out1 = decodeBase64Chunk(s, part1, 1, 100);
    const out2 = decodeBase64Chunk(s, part2, 1, 101);
    expect(out1).toHaveLength(0);
    expect(out2).toHaveLength(1);
    expect(out2[0]!.parsed).toEqual({ level: 'INFO', message: 'hi' });
  });

  it('handles multibyte UTF-8 split across frames', () => {
    const s = makeDecoderState();
    const bytes = new TextEncoder().encode('{"message":"Привет"}\n');
    const cut = 10;
    const first = bytes.subarray(0, cut);
    const second = bytes.subarray(cut);
    const out1 = decodeBase64Chunk(s, b64bytes(first), 1, 100);
    const out2 = decodeBase64Chunk(s, b64bytes(second), 1, 101);
    expect(out1).toHaveLength(0);
    expect(out2).toHaveLength(1);
    expect(out2[0]!.parsed).toEqual({ message: 'Привет' });
  });

  it('strips trailing CR before LF', () => {
    const s = makeDecoderState();
    const out = decodeBase64Chunk(s, b64('{"level":"INFO","message":"crlf"}\r\n'), 1, 100);
    expect(out).toHaveLength(1);
    expect(out[0]!.parsed).toEqual({ level: 'INFO', message: 'crlf' });
  });

  it('extracts @timestamp field', () => {
    const s = makeDecoderState();
    const out = decodeBase64Chunk(
      s,
      b64('{"@timestamp":"2026-04-23T10:00:00Z","level":"INFO","message":"x"}\n'),
      1,
      100,
    );
    expect(out[0]!.timestamp).toBe('2026-04-23T10:00:00Z');
  });

  it('ignores empty input gracefully', () => {
    const s = makeDecoderState();
    expect(decodeBase64Chunk(s, '', 1, 100)).toHaveLength(0);
  });

  it('flushTail emits the buffered tail on close', () => {
    const s = makeDecoderState();
    decodeBase64Chunk(s, b64('no newline at end'), 1, 100);
    const out = flushTail(s, 1, 200);
    expect(out).toHaveLength(1);
    expect(out[0]!.raw).toBe('no newline at end');
    expect(out[0]!.parsed).toBeNull();
  });

  it('increments seq monotonically per socket', () => {
    const s = makeDecoderState();
    const out = decodeBase64Chunk(s, b64('one\ntwo\nthree\n'), 1, 100);
    expect(out.map((l) => l.seq)).toEqual([1, 2, 3]);
  });

  it('uppercases level', () => {
    const s = makeDecoderState();
    const out = decodeBase64Chunk(s, b64('{"level":"info","message":"x"}\n'), 1, 100);
    expect(out[0]!.level).toBe('INFO');
  });

  it('merges pretty-printed JSON spanning multiple newline-delimited fragments', () => {
    const s = makeDecoderState();
    const payload =
      '{"@timestamp":"2026-04-26T21:11:43.474+03:00",\n' +
      '"@version":"1",\n' +
      '"message":"hello",\n' +
      '"level":"INFO"}\n';
    const out = decodeBase64Chunk(s, b64(payload), 1, 100);
    expect(out).toHaveLength(1);
    expect(out[0]!.parsed).toMatchObject({
      '@timestamp': '2026-04-26T21:11:43.474+03:00',
      '@version': '1',
      message: 'hello',
      level: 'INFO',
    });
    expect(out[0]!.level).toBe('INFO');
  });

  it('merges across multiple decode calls (frame split mid-object)', () => {
    const s = makeDecoderState();
    const out1 = decodeBase64Chunk(s, b64('{"level":"INFO",\n"message":"a"'), 1, 100);
    const out2 = decodeBase64Chunk(s, b64(',\n"end":true}\n'), 1, 101);
    expect(out1).toHaveLength(0);
    expect(out2).toHaveLength(1);
    expect(out2[0]!.parsed).toEqual({ level: 'INFO', message: 'a', end: true });
  });

  it('keeps non-JSON lines as separate raw entries even between two JSON objects', () => {
    const s = makeDecoderState();
    const payload = '{"a":1}\nplain\n{"b":2}\n';
    const out = decodeBase64Chunk(s, b64(payload), 1, 100);
    expect(out).toHaveLength(3);
    expect(out[0]!.parsed).toEqual({ a: 1 });
    expect(out[1]!.parsed).toBeNull();
    expect(out[1]!.raw).toBe('plain');
    expect(out[2]!.parsed).toEqual({ b: 2 });
  });

  it('does not eat braces inside JSON string values', () => {
    const s = makeDecoderState();
    const payload = '{"message":"open {brace}",\n"level":"INFO"}\n';
    const out = decodeBase64Chunk(s, b64(payload), 1, 100);
    expect(out).toHaveLength(1);
    expect(out[0]!.parsed).toEqual({ message: 'open {brace}', level: 'INFO' });
  });

  it('flushTail emits an unbalanced multi-line buffer as raw on close', () => {
    const s = makeDecoderState();
    decodeBase64Chunk(s, b64('{"level":"INFO",\n"message":"truncated'), 1, 100);
    const out = flushTail(s, 1, 200);
    expect(out.length).toBeGreaterThanOrEqual(1);
    const last = out[out.length - 1]!;
    expect(last.raw).toContain('"level":"INFO"');
    expect(last.raw).toContain('"message":"truncated');
  });
});
