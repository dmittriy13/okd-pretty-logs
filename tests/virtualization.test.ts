import { describe, expect, it } from 'vitest';
import {
  findRowAtY,
  rebuildPrefixSum,
  rowTop,
  totalHeight,
} from '../src/panel/internal/virtualization.js';

describe('rebuildPrefixSum', () => {
  it('produces ascending sums matching cumulative heights', () => {
    const heights = [10, 20, 30, 40];
    const sums: number[] = [];
    rebuildPrefixSum(heights, sums);
    expect(sums).toEqual([10, 30, 60, 100]);
  });

  it('handles empty input', () => {
    const sums: number[] = [5, 5, 5];
    rebuildPrefixSum([], sums);
    expect(sums).toEqual([]);
  });

  it('treats missing entries as 0', () => {
    const heights: number[] = [10];
    heights[2] = 30;
    const sums: number[] = [];
    rebuildPrefixSum(heights, sums);
    expect(sums).toEqual([10, 10, 40]);
  });
});

describe('totalHeight', () => {
  it('returns 0 for empty sums', () => {
    expect(totalHeight([])).toBe(0);
  });
  it('returns the last prefix sum', () => {
    expect(totalHeight([10, 30, 60])).toBe(60);
  });
});

describe('rowTop', () => {
  it('returns 0 for the first row', () => {
    expect(rowTop([10, 30, 60], 0)).toBe(0);
  });
  it('returns the prefix sum of the previous row', () => {
    expect(rowTop([10, 30, 60], 1)).toBe(10);
    expect(rowTop([10, 30, 60], 2)).toBe(30);
  });
});

describe('findRowAtY', () => {
  it('returns 0 when no rows are present', () => {
    expect(findRowAtY([], 100)).toBe(0);
  });
  it('binary-searches the row containing y', () => {
    const sums = [10, 30, 60, 100];
    expect(findRowAtY(sums, 0)).toBe(0);
    expect(findRowAtY(sums, 9)).toBe(0);
    expect(findRowAtY(sums, 10)).toBe(1);
    expect(findRowAtY(sums, 29)).toBe(1);
    expect(findRowAtY(sums, 30)).toBe(2);
    expect(findRowAtY(sums, 59)).toBe(2);
    expect(findRowAtY(sums, 60)).toBe(3);
    expect(findRowAtY(sums, 99)).toBe(3);
  });
  it('clamps to the last row when y exceeds totalHeight', () => {
    expect(findRowAtY([10, 30, 60], 1000)).toBe(2);
  });
});
