export type {
  BenchmarkResult,
  RetrievalMetrics,
  LatencyMetrics,
  QAMetrics,
  CategoryMetrics,
} from '../metrics/metric-types.js';

/**
 * Comparison between two benchmark runs for the same phase.
 */
export interface MetricDelta {
  readonly name: string;
  readonly current: number;
  readonly previous: number;
  readonly delta: number;
  readonly deltaPercent: number;
}

export interface ReportComparison {
  readonly phase: string;
  readonly currentTimestamp: string;
  readonly previousTimestamp: string;
  readonly deltas: readonly MetricDelta[];
}
