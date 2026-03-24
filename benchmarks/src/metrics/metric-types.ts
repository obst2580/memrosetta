export interface RetrievalMetrics {
  readonly precisionAtK: Readonly<Record<number, number>>;
  readonly recallAtK: Readonly<Record<number, number>>;
  readonly ndcgAtK: Readonly<Record<number, number>>;
  readonly mrr: number;
}

export interface LatencyMetrics {
  readonly operation: string;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly meanMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly sampleCount: number;
}

export interface QAMetrics {
  readonly totalQuestions: number;
  readonly correctAnswers: number;
  readonly accuracy: number;
  readonly byCategory: Readonly<Record<string, CategoryMetrics>>;
}

export interface CategoryMetrics {
  readonly total: number;
  readonly correct: number;
  readonly accuracy: number;
}

export interface BenchmarkResult {
  readonly name: string;
  readonly phase: string;
  readonly timestamp: string;
  readonly dataset: string;
  readonly engineVersion: string;
  readonly retrieval: RetrievalMetrics;
  readonly latency: readonly LatencyMetrics[];
  readonly qa?: QAMetrics;
  readonly metadata: Readonly<Record<string, unknown>>;
}
