import type { BenchmarkDataset, DatasetLoader } from '../dataset-loader.js';

/**
 * Stub implementation for the LongMemEval dataset loader.
 * Full implementation is planned for a later phase.
 */
export class LongMemEvalLoader implements DatasetLoader {
  async load(): Promise<BenchmarkDataset> {
    throw new Error(
      'LongMemEval loader is not yet implemented. Planned for Phase 2.',
    );
  }

  async isAvailable(): Promise<boolean> {
    return false;
  }
}
