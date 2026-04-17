import type { CuePolarity, FeatureFamily } from './hippocampal.js';

export type MemoryType = 'fact' | 'preference' | 'decision' | 'event';

/**
 * Tulving 3-system axis (v4 §2.1 / §5 of reconstructive-memory spec).
 * Primary cognitive routing layer — decides the retrieval path
 * (episodic: time+space+source; semantic: concept expansion;
 * procedural: slot matching).
 */
export type MemorySystem = 'episodic' | 'semantic' | 'procedural';

/**
 * Product/task-level role axis (v4 §5). Orthogonal to MemorySystem.
 * Legacy values (`fact`, `preference`, `decision`, `event`) remain
 * canonical; new roles extend rather than replace. This is an open
 * union because role vocabulary is expected to grow as the taxonomy
 * stabilizes.
 */
export type MemoryRole =
  | 'fact'
  | 'preference'
  | 'decision'
  | 'event'
  | 'pattern'
  | 'procedure'
  | 'heuristic'
  | 'schema'
  | 'observation'
  | 'review_prompt'
  | 'migration_recipe'
  | (string & Record<never, never>);

export type MemoryAliasDerivation =
  | 'generalized_from'
  | 'episodic_instance_of'
  | 'procedural_distillation'
  | 'semantic_extraction';

export interface MemoryAlias {
  readonly memoryId: string;
  readonly aliasSystem?: MemorySystem;
  readonly aliasRole?: MemoryRole;
  readonly derivationType: MemoryAliasDerivation;
  readonly confidence: number;
  readonly createdByKernel: 'consolidation' | 'manual';
  readonly createdAt: string;
}

/**
 * Derived state of a memory based on existing fields.
 * - current: is_latest=1 AND invalidated_at IS NULL
 * - superseded: is_latest=0
 * - invalidated: invalidated_at IS NOT NULL
 */
export type MemoryState = 'current' | 'superseded' | 'invalidated';

export type MemoryTier = 'hot' | 'warm' | 'cold';

export type SourceKind =
  | 'chat'
  | 'document'
  | 'observation'
  | 'reflection'
  | 'tool_output';

/**
 * Structured provenance record for a memory (v4 reconstructive-memory spec).
 *
 * Every memory can have 0..N source attestations. Unlike the legacy
 * `sourceId` scalar, attestations are structured and support multiple
 * provenance records per memory (e.g. a single fact attested by both a
 * chat turn and a referenced document).
 *
 * attestedAt is assigned by the engine when the attestation is persisted.
 */
export interface SourceAttestation {
  readonly sourceKind: SourceKind;
  readonly sourceRef: string;
  readonly sourceSpeaker?: string;
  readonly confidence?: number;
  readonly attestedAt?: string;
}

export interface MemoryInput {
  readonly userId: string;
  readonly namespace?: string;
  readonly memoryType: MemoryType;
  readonly content: string;
  readonly rawText?: string;
  readonly documentDate?: string;
  readonly sourceId?: string;
  readonly confidence?: number;
  readonly salience?: number;
  readonly keywords?: readonly string[];
  /** ISO 8601 - when the event started */
  readonly eventDateStart?: string;
  /** ISO 8601 - when the event ended */
  readonly eventDateEnd?: string;
  /** ISO 8601 - when this fact became invalid */
  readonly invalidatedAt?: string;
  /** Encoding context: project identifier (derived from cwd at store time) */
  readonly project?: string;
  /** Encoding context: activity type at store time (debugging, implementation, review, etc.) */
  readonly activityType?: string;
  /**
   * Structured provenance records for this memory. Persisted into the
   * source_attestations table in the same transaction as the memory row.
   * If omitted or empty, no attestations are written.
   */
  readonly sources?: readonly SourceAttestation[];
  /**
   * Episode this memory belongs to (coarse event segmentation boundary).
   * If provided, a memory_episodic_bindings row is inserted inside the
   * same transaction as the memory row. If omitted, the engine falls
   * back to the user's currently-open episode (if any) so the memory
   * is not orphaned. Pass `autoBindEpisode: false` to disable that
   * fallback.
   */
  readonly episodeId?: string;
  /**
   * When true (default) and `episodeId` is not provided, the engine
   * binds this memory to the user's currently-open episode (as
   * produced by `openEpisode()`). Set to false to force an orphan
   * write — useful for backfill paths or tests that manage episode
   * wiring externally.
   */
  readonly autoBindEpisode?: boolean;
  /** Segment within the episode, if known (fine-grained boundary). */
  readonly segmentId?: string;
  /** Segment position within the episode (used for ordering). */
  readonly segmentPosition?: number;
  /** Initial Hebbian binding strength (default 1.0). */
  readonly bindingStrength?: number;
  /**
   * Goal this memory belongs to. If provided, a goal_memory_links row
   * is inserted inside the same transaction as the memory. The goal
   * must already exist (FK enforced). Without a goal binding, recall
   * cannot distinguish "fact about X" from "fact captured while solving
   * X", which is the whole point of goal-state memory.
   */
  readonly goalId?: string;
  readonly goalLinkRole?: 'step' | 'evidence' | 'decision' | 'side_effect';
  readonly goalLinkWeight?: number;
  /**
   * Dual Representation (Fuzzy Trace Theory, v4 spec §2.2/§2.7):
   * verbatim is the immutable raw trace; gist is the compressed,
   * transfer-friendly form. If `verbatim` is omitted, the engine
   * uses `content` as the initial verbatim (backwards compatible).
   * If `gist` is omitted, the background consolidation loop will
   * populate it asynchronously — recall that asks for gist-level
   * recall will simply fall back to verbatim until then.
   */
  readonly verbatim?: string;
  readonly gist?: string;
  readonly gistConfidence?: number;
  readonly gistExtractedModel?: string;
  /**
   * Tulving 2-axis routing (v4 §5). If omitted, the engine derives
   * `memorySystem` + `memoryRole` from the legacy `memoryType` field
   * (fact/preference/decision -> semantic; event -> episodic; etc.).
   * Explicit values override the default mapping.
   */
  readonly memorySystem?: MemorySystem;
  readonly memoryRole?: MemoryRole;
  /**
   * Cue features to register against the memory's parent episode.
   * Each cue is canonicalized and reinforced in the hippocampal index
   * inside the same transaction as the memory row, so recall can find
   * this memory via pattern completion. Requires `episodeId` to be
   * supplied too — cues without an episode anchor are dropped.
   */
  readonly cues?: ReadonlyArray<MemoryCueInput>;
}

export interface Memory extends MemoryInput {
  readonly memoryId: string;
  readonly learnedAt: string;
  readonly isLatest: boolean;
  /** Memory tier: hot (working memory), warm (recent), cold (archived). Engine-managed. */
  readonly tier: MemoryTier;
  /** ACT-R activation score (0-1). Engine-managed. */
  readonly activationScore: number;
  /** Number of times this memory was accessed in search. Engine-managed. */
  readonly accessCount: number;
  /** ISO 8601 - when this memory was last accessed via search. Engine-managed. */
  readonly lastAccessedAt?: string;
  /** memory_id of the original memory, if this is a compressed summary. Engine-managed. */
  readonly compressedFrom?: string;
  /** Number of times this memory was used (retrieved and acted upon). Engine-managed. */
  readonly useCount: number;
  /** Number of times this memory was reported as helpful. Engine-managed. */
  readonly successCount: number;
  /** Dual-representation verbatim (immutable raw trace). Engine-managed. */
  readonly verbatimContent?: string;
  /** Dual-representation gist (compressed). Engine-managed. */
  readonly gistContent?: string;
  readonly gistConfidence?: number;
  readonly gistExtractedAt?: string;
  readonly gistExtractedModel?: string;
  /**
   * Tulving 2-axis (v4 §5). Engine derives from legacy memoryType
   * when storeMemory omits explicit values.
   */
  readonly memorySystem?: MemorySystem;
  readonly memoryRole?: MemoryRole;
}

export interface MemoryCueInput {
  readonly featureType: FeatureFamily;
  readonly featureValue: string;
  readonly polarity?: CuePolarity;
  readonly activation?: number;
}
