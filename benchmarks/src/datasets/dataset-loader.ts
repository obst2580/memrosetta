import type { MemoryInput } from '@memrosetta/types';

/**
 * A single benchmark query with its expected answer and evidence references.
 */
export interface BenchmarkQuery {
  readonly queryId: string;
  readonly query: string;
  readonly expectedAnswer?: string;
  readonly relevantMemoryIds?: readonly string[];
  readonly category: string;
}

/**
 * A fully loaded benchmark dataset ready for evaluation.
 *
 * Contains the memory inputs to ingest and the queries to evaluate against.
 * The memoryIdMapping links original dataset IDs (e.g. LoCoMo dia_id) to
 * the deterministic memory IDs generated during conversion.
 */
export interface BenchmarkDataset {
  readonly name: string;
  readonly description: string;
  readonly memoryInputs: readonly MemoryInput[];
  readonly queries: readonly BenchmarkQuery[];
  readonly memoryIdMapping: ReadonlyMap<string, string>;
}

/**
 * Interface for dataset loaders that fetch, validate, and convert benchmark
 * datasets into the common BenchmarkDataset format.
 */
export interface DatasetLoader {
  /**
   * Load the dataset: download if needed, validate, and convert to
   * the common BenchmarkDataset format.
   */
  load(): Promise<BenchmarkDataset>;

  /**
   * Check whether cached data is available locally.
   * Returns true if the dataset can be loaded without network access.
   */
  isAvailable(): Promise<boolean>;
}
