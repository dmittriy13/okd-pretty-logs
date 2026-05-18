import { describe, expect, it } from 'vitest';
import { formatTimestamp, shortenValue } from '../src/shared/formatters.js';

describe('formatTimestamp', () => {
  it('formats with default pattern and truncates nano precision to 3 digits', () => {
    const out = formatTimestamp('2026-04-22T23:56:55.1188711436+03:00', 'YYYY-MM-DD HH:mm:ss.SSS');
    // We don't assert the HH/mm because the test host may be in a different
    // timezone; only check date, seconds and millisecond precision.
    expect(out).toMatch(/^2026-04-2[23] \d\d:\d\d:55\.118$/);
  });

  it('pads short fractional seconds to 3 digits', () => {
    const out = formatTimestamp('2026-04-22T12:00:00.5Z', 'HH:mm:ss.SSS');
    expect(out).toMatch(/:00\.500$/);
  });

  it('emits 000 millis when the input has no fractional part', () => {
    const out = formatTimestamp('2026-04-22T12:00:00Z', 'HH:mm:ss.SSS');
    expect(out).toMatch(/:00\.000$/);
  });

  it('returns the input unchanged when it is not a valid date', () => {
    expect(formatTimestamp('not-a-date', 'YYYY')).toBe('not-a-date');
  });

  it('leaves unknown literal characters in the pattern alone', () => {
    const out = formatTimestamp('2026-04-22T12:00:00Z', '[ts] YYYY');
    expect(out).toBe('[ts] 2026');
  });

  it('renders Z token with the input timezone suffix', () => {
    const out = formatTimestamp('2026-04-22T12:00:00+03:00', 'Z');
    expect(out).toBe('+03:00');
  });
});

describe('shortenValue', () => {
  it('returns input unchanged when pattern is empty or lacks a star', () => {
    expect(shortenValue('abcdef', '')).toBe('abcdef');
    expect(shortenValue('abcdef', undefined)).toBe('abcdef');
    expect(shortenValue('abcdef', '####')).toBe('abcdef');
  });

  it('keeps head N + tail N and ellipsis in the middle', () => {
    expect(shortenValue('1234567890abcdef', '####*####')).toBe('1234…cdef');
  });

  it('handles asymmetric head/tail', () => {
    expect(shortenValue('abcdefghijklmn', '##*###')).toBe('ab…lmn');
  });

  it('leaves the value alone when it is already shorter than head+tail+1', () => {
    expect(shortenValue('short', '####*####')).toBe('short');
  });

  it('returns unchanged when both head and tail are zero', () => {
    expect(shortenValue('abcdef', '*')).toBe('abcdef');
  });
});
