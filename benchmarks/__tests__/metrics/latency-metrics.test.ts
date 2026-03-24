import { describe, it, expect } from 'vitest';
import { computeLatencyMetrics } from '../../src/metrics/latency-metrics.js';

describe('computeLatencyMetrics', () => {
  it('computes correct metrics for a normal distribution of samples', () => {
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const result = computeLatencyMetrics('search', samples);

    expect(result.operation).toBe('search');
    expect(result.sampleCount).toBe(10);
    expect(result.meanMs).toBe(55);
    expect(result.minMs).toBe(10);
    expect(result.maxMs).toBe(100);
    expect(result.p50Ms).toBeCloseTo(55, 1);
  });

  it('computes correct metrics for a single sample', () => {
    const samples = [42];
    const result = computeLatencyMetrics('store', samples);

    expect(result.operation).toBe('store');
    expect(result.sampleCount).toBe(1);
    expect(result.meanMs).toBe(42);
    expect(result.minMs).toBe(42);
    expect(result.maxMs).toBe(42);
    expect(result.p50Ms).toBe(42);
    expect(result.p95Ms).toBe(42);
    expect(result.p99Ms).toBe(42);
  });

  it('returns all zeros for empty samples', () => {
    const result = computeLatencyMetrics('empty', []);

    expect(result.operation).toBe('empty');
    expect(result.sampleCount).toBe(0);
    expect(result.meanMs).toBe(0);
    expect(result.minMs).toBe(0);
    expect(result.maxMs).toBe(0);
    expect(result.p50Ms).toBe(0);
    expect(result.p95Ms).toBe(0);
    expect(result.p99Ms).toBe(0);
  });

  it('computes known p50/p95/p99 for well-understood input', () => {
    // 100 samples: 1, 2, 3, ..., 100
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    const result = computeLatencyMetrics('bulk', samples);

    expect(result.sampleCount).toBe(100);
    expect(result.meanMs).toBeCloseTo(50.5);
    expect(result.minMs).toBe(1);
    expect(result.maxMs).toBe(100);
    // p50 of 1..100: 50.5
    expect(result.p50Ms).toBeCloseTo(50.5, 1);
    // p95: 0.95 * 99 = 94.05 -> linear interpolation between index 94 and 95
    // sorted[94] = 95, sorted[95] = 96 -> 95 + 0.05*1 = 95.05
    expect(result.p95Ms).toBeCloseTo(95.05, 1);
    // p99: 0.99 * 99 = 98.01 -> sorted[98] = 99, sorted[99] = 100 -> 99 + 0.01*1 = 99.01
    expect(result.p99Ms).toBeCloseTo(99.01, 1);
  });

  it('handles unsorted input correctly', () => {
    const samples = [50, 10, 90, 30, 70];
    const result = computeLatencyMetrics('unsorted', samples);

    expect(result.minMs).toBe(10);
    expect(result.maxMs).toBe(90);
    expect(result.meanMs).toBe(50);
    expect(result.p50Ms).toBe(50);
  });

  it('does not mutate the input array', () => {
    const samples = [50, 10, 90, 30, 70];
    const original = [...samples];
    computeLatencyMetrics('test', samples);
    expect(samples).toEqual(original);
  });
});
