/**
 * Calculate the p-th percentile of a sorted array using linear interpolation.
 * @param sorted - Pre-sorted array of numbers (ascending)
 * @param p - Percentile value (0-100)
 * @returns The interpolated percentile value, or 0 for empty arrays
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  if (sorted.length === 1) {
    return sorted[0];
  }

  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const fraction = index - lower;
  return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
}

/**
 * Calculate the arithmetic mean of an array of numbers.
 * @returns 0 for empty arrays
 */
export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

/**
 * Calculate the median (50th percentile) of an array of numbers.
 * The array does not need to be pre-sorted.
 * @returns 0 for empty arrays
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 50);
}

/**
 * Calculate the population standard deviation of an array of numbers.
 * @returns 0 for empty arrays or single-element arrays
 */
export function standardDeviation(values: readonly number[]): number {
  if (values.length <= 1) {
    return 0;
  }

  const avg = mean(values);
  const squaredDiffs = values.map((v) => (v - avg) ** 2);
  const avgSquaredDiff = mean(squaredDiffs);
  return Math.sqrt(avgSquaredDiff);
}
