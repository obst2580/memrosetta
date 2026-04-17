import type {
  Intent,
  ReconstructRecallInput,
  ReconstructRecallResult,
  SqliteMemoryEngine,
} from './engine-types.js';

/**
 * v1.0 reconstructive-memory benchmarks (v4 §15, §17.5).
 *
 * Each scenario shape is deterministic so CI can gate on the metrics
 * without chasing LLM flakiness. Seeding uses the real
 * SqliteMemoryEngine so the kernel under test is exactly the product
 * kernel, not a mock. MockEngine throws on reconstructRecall by design.
 */

export type ScenarioName =
  | 'goal_state_preservation'
  | 'source_fidelity'
  | 'reuse_fit'
  | 'context_preserving_transfer';

export interface ScenarioMetricEntry {
  readonly name: string;
  readonly value: number;
  readonly ideal: number;
  readonly passed: boolean;
}

export interface ScenarioResult {
  readonly scenario: ScenarioName;
  readonly metrics: readonly ScenarioMetricEntry[];
  readonly evidenceCount: number;
  readonly warnings: readonly string[];
  readonly durationMs: number;
}

export interface V1Scenario {
  readonly name: ScenarioName;
  /**
   * Seed the engine with the memories, episodes, goals, and cues the
   * scenario needs. Must be idempotent against a fresh engine.
   */
  readonly seed: (engine: SqliteMemoryEngine) => Promise<void>;
  /** Build the reconstructRecall input the scenario evaluates against. */
  readonly buildInput: () => ReconstructRecallInput;
  /** Interpret the recall result into pass/fail metrics. */
  readonly evaluate: (
    result: ReconstructRecallResult,
  ) => readonly ScenarioMetricEntry[];
}

export type { Intent, ReconstructRecallInput, ReconstructRecallResult };
