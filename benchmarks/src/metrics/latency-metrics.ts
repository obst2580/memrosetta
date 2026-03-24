import { percentile, mean as calcMean } from '../utils/statistics.js';
import type { LatencyMetrics } from './metric-types.js';

/**
 * Compute latency metrics from a set of timing samples.
 * Produces p50, p95, p99, mean, min, max, and sample count.
 */
export function computeLatencyMetrics(
  operation: string,
  samples: readonly number[],
): LatencyMetrics {
  if (samples.length === 0) {
    return {
      operation,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      meanMs: 0,
      minMs: 0,
      maxMs: 0,
      sampleCount: 0,
    };
  }

  const sorted = [...samples].sort((a, b) => a - b);

  return {
    operation,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    meanMs: calcMean(samples),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    sampleCount: samples.length,
  };
}
