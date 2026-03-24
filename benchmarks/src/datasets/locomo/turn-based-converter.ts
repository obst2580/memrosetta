import type { BenchmarkDataset } from '../dataset-loader.js';
import type { LoCoMoSample } from './locomo-types.js';
import type { LoCoMoConverterStrategy } from './converter-types.js';
import { convertLoCoMoDataset } from './locomo-converter.js';

/**
 * Default converter: maps each dialogue turn to one MemoryInput.
 * This preserves the original benchmark behavior.
 */
export class TurnBasedConverter implements LoCoMoConverterStrategy {
  async convert(samples: readonly LoCoMoSample[]): Promise<BenchmarkDataset> {
    return convertLoCoMoDataset(samples);
  }
}
