import { describe, expect, it } from 'vitest';
import {
  cssEscapeKey,
  formatShortUrl,
  isComplexValue,
  isNowrapField,
  summarizeComplex,
} from '../src/panel/internal/helpers.js';

describe('cssEscapeKey', () => {
  it('keeps alphanumerics, underscore, and hyphen', () => {
    expect(cssEscapeKey('foo_bar-1')).toBe('foo_bar-1');
  });
  it('replaces unsafe characters with underscore', () => {
    expect(cssEscapeKey('@timestamp')).toBe('_timestamp');
    expect(cssEscapeKey('a.b.c')).toBe('a_b_c');
    expect(cssEscapeKey('field name')).toBe('field_name');
  });
});

describe('isComplexValue', () => {
  it('returns true for non-empty objects and arrays', () => {
    expect(isComplexValue({ a: 1 })).toBe(true);
    expect(isComplexValue([1])).toBe(true);
  });
  it('returns false for empty objects and arrays', () => {
    expect(isComplexValue({})).toBe(false);
    expect(isComplexValue([])).toBe(false);
  });
  it('returns false for scalars and null', () => {
    expect(isComplexValue(null)).toBe(false);
    expect(isComplexValue('s')).toBe(false);
    expect(isComplexValue(42)).toBe(false);
    expect(isComplexValue(undefined)).toBe(false);
  });
});

describe('summarizeComplex', () => {
  it('describes arrays with pluralised item count', () => {
    expect(summarizeComplex([1])).toBe('[1 item]');
    expect(summarizeComplex([1, 2, 3])).toBe('[3 items]');
  });
  it('describes objects with pluralised key count', () => {
    expect(summarizeComplex({ a: 1 })).toBe('{1 key}');
    expect(summarizeComplex({ a: 1, b: 2 })).toBe('{2 keys}');
  });
});

describe('isNowrapField', () => {
  it('treats timestamps and tagging fields as nowrap', () => {
    expect(isNowrapField('@timestamp')).toBe(true);
    expect(isNowrapField('timestamp')).toBe(true);
    expect(isNowrapField('time')).toBe(true);
    expect(isNowrapField('ts')).toBe(true);
    expect(isNowrapField('level')).toBe(true);
    expect(isNowrapField('traceId')).toBe(true);
    expect(isNowrapField('trace_id')).toBe(true);
  });
  it('treats arbitrary fields as wrappable', () => {
    expect(isNowrapField('message')).toBe(false);
    expect(isNowrapField('logger_name')).toBe(false);
  });
});

describe('formatShortUrl', () => {
  it('extracts ns and pod from a pod-log URL', () => {
    expect(formatShortUrl('wss://host/api/v1/namespaces/team-a/pods/svc-abc/log?follow=true')).toBe(
      'ns=team-a pod=svc-abc',
    );
  });
  it('falls back to the pathname when no ns/pod present', () => {
    expect(formatShortUrl('wss://host/some/other/path')).toBe('/some/other/path');
  });
  it('returns the input when not a URL', () => {
    expect(formatShortUrl('not a url')).toBe('not a url');
  });
  it('returns empty string for null', () => {
    expect(formatShortUrl(null)).toBe('');
  });
});
