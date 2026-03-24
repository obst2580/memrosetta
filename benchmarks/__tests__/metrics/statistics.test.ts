import { describe, it, expect } from 'vitest';
import {
  percentile,
  mean,
  median,
  standardDeviation,
} from '../../src/utils/statistics.js';

describe('percentile', () => {
  it('returns 0 for empty array', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('returns the single element for single-element array', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 100)).toBe(42);
  });

  it('returns min for 0th percentile', () => {
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
  });

  it('returns max for 100th percentile', () => {
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
  });

  it('interpolates correctly for 50th percentile', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
  });

  it('interpolates correctly for 25th percentile', () => {
    // index = 0.25 * 3 = 0.75
    // sorted[0] + 0.75 * (sorted[1] - sorted[0]) = 10 + 0.75 * 10 = 17.5
    expect(percentile([10, 20, 30, 40], 25)).toBe(17.5);
  });
});

describe('mean', () => {
  it('returns 0 for empty array', () => {
    expect(mean([])).toBe(0);
  });

  it('returns the element for single-element array', () => {
    expect(mean([5])).toBe(5);
  });

  it('calculates correct mean', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });
});

describe('median', () => {
  it('returns 0 for empty array', () => {
    expect(median([])).toBe(0);
  });

  it('returns the element for single-element array', () => {
    expect(median([7])).toBe(7);
  });

  it('returns correct median for odd-length array', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('returns correct median for even-length array', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('standardDeviation', () => {
  it('returns 0 for empty array', () => {
    expect(standardDeviation([])).toBe(0);
  });

  it('returns 0 for single-element array', () => {
    expect(standardDeviation([5])).toBe(0);
  });

  it('returns 0 for identical values', () => {
    expect(standardDeviation([3, 3, 3, 3])).toBe(0);
  });

  it('calculates correct population standard deviation', () => {
    // values: [2, 4, 4, 4, 5, 5, 7, 9]
    // mean = 5, variance = 4, sd = 2
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.0);
  });
});
