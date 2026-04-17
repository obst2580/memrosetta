/**
 * Layer B construct types (v4 §7, §10, §13).
 *
 * A construct is a procedural/semantic memory elevated to reusable
 * schema status. It carries structured slots, constraints, explicit
 * anti-patterns (what NOT to do), success signals, and an
 * abstraction level that the recall kernel uses for intent gating.
 *
 * Constructs live Day-one as tables, but runtime induction is gated
 * behind Layer B feature flags. Tests pin the schema so Layer C can
 * plug into the same shape later.
 */

export type ExemplarRole = 'positive' | 'negative' | 'edge_case';

/** 1 = concrete memory, 5 = abstract principle (Rosch 1978 prototype). */
export type AbstractionLevelValue = 1 | 2 | 3 | 4 | 5;

export interface ConstructSlot {
  readonly name: string;
  readonly value?: string;
  readonly confidence?: number;
  readonly evidenceMemoryIds?: readonly string[];
  readonly extractionSource?: string;
  readonly alternatives?: ReadonlyArray<{
    readonly value: string;
    readonly confidence: number;
  }>;
  readonly required?: boolean;
}

export interface MemoryConstruct {
  readonly memoryId: string;
  readonly canonicalForm: string;
  readonly slots?: readonly ConstructSlot[];
  readonly constraints?: readonly { type: string; value: unknown }[];
  readonly antiPatterns?: readonly { description: string; evidenceMemoryIds?: readonly string[] }[];
  readonly successSignals?: readonly { signal: string; threshold?: number | string }[];
  readonly applicability?: readonly { type: string; value: string }[];
  readonly abstractionLevel: AbstractionLevelValue;
  readonly constructConfidence?: number;
  readonly reuseCount: number;
  readonly reuseSuccessCount: number;
  readonly lastReindexAt?: string;
}

export interface MemoryConstructInput {
  readonly memoryId: string;
  readonly canonicalForm: string;
  readonly slots?: readonly ConstructSlot[];
  readonly constraints?: readonly { type: string; value: unknown }[];
  readonly antiPatterns?: readonly { description: string; evidenceMemoryIds?: readonly string[] }[];
  readonly successSignals?: readonly { signal: string; threshold?: number | string }[];
  readonly applicability?: readonly { type: string; value: string }[];
  readonly abstractionLevel?: AbstractionLevelValue;
  readonly constructConfidence?: number;
}

export interface ConstructExemplarLink {
  readonly constructMemoryId: string;
  readonly exemplarMemoryId: string;
  readonly exemplarRole: ExemplarRole;
  readonly supportScore?: number;
  readonly createdAt: string;
}

export interface NoveltyScore {
  /** 0..1. Higher means more surprising given existing beliefs. */
  readonly score: number;
  /** Raw distance to the nearest-neighbour memory. */
  readonly nearestDistance?: number;
  /** Count of close neighbours above the similarity threshold. */
  readonly neighborCount: number;
  /** Heuristic label used for logging / debugging. */
  readonly explanation: string;
}
