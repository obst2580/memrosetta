import type { BenchmarkDataset } from '../dataset-loader.js';
import type { LoCoMoSample } from './locomo-types.js';

/**
 * Interface for converting raw LoCoMo samples into BenchmarkDataset format.
 * Implementations can use different strategies (turn-based, fact-extraction, etc.)
 */
export interface LoCoMoConverterStrategy {
  convert(samples: readonly LoCoMoSample[]): Promise<BenchmarkDataset>;
}
