// Pure-math helpers for the row virtualizer. They operate on parallel arrays
// (`rowHeights[i]` is the measured/estimated height of the i-th filtered row)
// and a prefix-sum array (`prefixSums[i]` is the total height of rows 0..i).
//
// The caller is responsible for keeping the arrays in sync; these functions
// never mutate them out of band.

// Recompute prefix sums from row heights. The output array length is matched
// to `rowHeights.length`. Mutates `prefixSums` in place (kept as an out-param
// to avoid allocations on every reconcile pass).
export function rebuildPrefixSum(rowHeights: number[], prefixSums: number[]): void {
  const n = rowHeights.length;
  prefixSums.length = n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += rowHeights[i] ?? 0;
    prefixSums[i] = sum;
  }
}

export function totalHeight(prefixSums: number[]): number {
  return prefixSums.length === 0 ? 0 : (prefixSums[prefixSums.length - 1] ?? 0);
}

// Top of the i-th row inside the virtual list = sum of all previous heights.
export function rowTop(prefixSums: number[], i: number): number {
  if (i <= 0) return 0;
  return prefixSums[i - 1] ?? 0;
}

// Binary-search the index of the row that contains pixel offset `y`.
// Returns the first row whose cumulative bottom is strictly greater than `y`.
export function findRowAtY(prefixSums: number[], y: number): number {
  const n = prefixSums.length;
  if (n === 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((prefixSums[mid] ?? 0) <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
