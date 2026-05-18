import { describe, expect, it } from 'vitest';
import { buildDetailContent } from '../src/panel/internal/details-row.js';
import type { FieldConfig } from '../src/shared/types.js';

const field = (overrides: Partial<FieldConfig> = {}): FieldConfig => ({
  key: 'stack_trace',
  visible: true,
  ...overrides,
});

describe('buildDetailContent', () => {
  it('returns null for null/undefined', () => {
    expect(buildDetailContent(field(), null)).toBeNull();
    expect(buildDetailContent(field(), undefined)).toBeNull();
  });

  it('pretty-prints non-empty objects as JSON', () => {
    const out = buildDetailContent(field({ key: 'meta' }), { a: 1, b: 2 });
    expect(out).toEqual({ content: '{\n  "a": 1,\n  "b": 2\n}', kind: 'json' });
  });

  it('pretty-prints arrays as JSON', () => {
    const out = buildDetailContent(field({ key: 'items' }), [1, 2]);
    expect(out).toEqual({ content: '[\n  1,\n  2\n]', kind: 'json' });
  });

  it('always renders stack_trace strings as plain text', () => {
    const out = buildDetailContent(
      field({ key: 'stack_trace' }),
      'java.lang.NullPointer\n\tat ...',
    );
    expect(out).toEqual({ content: 'java.lang.NullPointer\n\tat ...', kind: 'text' });
  });

  it('parses JSON-looking strings for non-stack-trace fields', () => {
    const out = buildDetailContent(field({ key: 'payload' }), '{"a":1}');
    expect(out).toEqual({ content: '{\n  "a": 1\n}', kind: 'json' });
  });

  it('falls back to plain text when JSON parse fails', () => {
    const out = buildDetailContent(field({ key: 'payload' }), '{not json}');
    expect(out).toEqual({ content: '{not json}', kind: 'text' });
  });

  it('stringifies non-string scalars', () => {
    expect(buildDetailContent(field({ key: 'n' }), 42)).toEqual({ content: '42', kind: 'text' });
    expect(buildDetailContent(field({ key: 'b' }), true)).toEqual({
      content: 'true',
      kind: 'text',
    });
  });
});
