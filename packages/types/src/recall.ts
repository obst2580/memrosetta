import type { MemoryRole, MemorySystem } from './memory.js';
import type { CueFeature } from './hippocampal.js';
import type { StateVector } from './episode.js';

/**
 * Reconstructive Recall types (v4 §6, §8).
 *
 * The five intents map different task postures onto different recall
 * pressures:
 *   - reuse   — procedural/semantic, mid abstraction, not strict
 *   - explain — episodic+semantic narrative, low abstraction, not strict
 *   - decide  — semantic+episodic evidence list, high abstraction
 *   - browse  — all systems, ranked list
 *   - verify  — verbatim+source, strict provenance
 */
export type Intent = 'reuse' | 'explain' | 'decide' | 'browse' | 'verify';

export type AbstractionLevel = 'lowest' | 'low' | 'mid' | 'high' | 'all';

export interface IntentRouting {
  readonly preferredSystems: readonly MemorySystem[];
  readonly abstractionLevel: AbstractionLevel;
  readonly strictProvenance: boolean;
  readonly outputFormat: string;
}

export const INTENT_ROUTING: Readonly<Record<Intent, IntentRouting>> = {
  reuse: {
    preferredSystems: ['procedural', 'semantic'],
    abstractionLevel: 'mid',
    strictProvenance: false,
    outputFormat: 'artifact',
  },
  explain: {
    preferredSystems: ['episodic', 'semantic'],
    abstractionLevel: 'low',
    strictProvenance: false,
    outputFormat: 'narrative',
  },
  decide: {
    preferredSystems: ['semantic', 'episodic'],
    abstractionLevel: 'high',
    strictProvenance: false,
    outputFormat: 'evidence_list',
  },
  browse: {
    preferredSystems: ['episodic', 'semantic', 'procedural'],
    abstractionLevel: 'all',
    strictProvenance: false,
    outputFormat: 'ranked_list',
  },
  verify: {
    preferredSystems: ['episodic', 'semantic', 'procedural'],
    abstractionLevel: 'lowest',
    strictProvenance: true,
    outputFormat: 'verbatim_with_sources',
  },
};

export interface RecallEvidence {
  readonly memoryId: string;
  readonly episodeId?: string;
  readonly role?: MemoryRole;
  readonly system?: MemorySystem;
  readonly confidence: number;
  readonly bindingStrength?: number;
  readonly verbatimContent?: string;
  readonly gistContent?: string;
}

export interface CompletedFeature {
  readonly featureType: string;
  readonly featureValue: string;
  readonly score: number;
}

/**
 * Recall warning taxonomy.
 *
 * - no_evidence: no cues and no state vector → nothing to match
 * - low_confidence: patternComplete returned evidence but the
 *   aggregate confidence is below threshold
 * - provenance_gap: intent=verify but a surviving memory lacks
 *   verbatim content (strict provenance violation)
 * - no_episodes_matched: cues present, episodes queried, but
 *   zero hits in the hippocampal index
 * - episodic_layer_empty: the entire episodic layer is uninitialized
 *   for this user (no episodes, no bindings). Distinguished from
 *   `no_episodes_matched` because this is a write-side gap, not a
 *   recall-side miss — ask the caller to run episode backfill.
 * - degraded_search_fallback: `allowDegraded` was set, the episodic
 *   layer was empty, and the kernel served lexical search results
 *   instead of true reconstructive recall. Confidence is capped.
 * - intent_mismatch: evidence was found but the intent's routing
 *   filter rejected all candidates
 *
 * `stale_gist` is intentionally deferred to Layer B (Systems
 * Consolidation / Replay) because Layer A has no automatic gist
 * contradiction detection path to emit it from. Codex Step 7
 * review flagged mentioning it here without emitting as a taxonomy
 * mismatch.
 */
export interface RecallWarning {
  readonly kind:
    | 'no_evidence'
    | 'low_confidence'
    | 'provenance_gap'
    | 'no_episodes_matched'
    | 'episodic_layer_empty'
    | 'degraded_search_fallback'
    | 'intent_mismatch';
  readonly message: string;
  readonly memoryId?: string;
  readonly hint?: string;
}

export interface ReconstructRecallInput {
  readonly userId: string;
  readonly query: string;
  readonly context?: StateVector;
  readonly cues?: readonly CueFeature[];
  readonly intent: Intent;
  readonly strict?: boolean;
  readonly sourceTypes?: readonly MemorySystem[];
  readonly maxEvidence?: number;
  readonly includeExemplars?: boolean;
  /**
   * Opt-in fallback: if the episodic layer is empty (write-side gap)
   * AND the intent is non-strict (`browse`), return lexical search
   * results wrapped as evidence instead of an empty artifact. The
   * result is clearly marked — confidence is capped, a
   * `degraded_search_fallback` warning is emitted, and the artifact
   * header states the degradation explicitly. Strict intents
   * (`verify`) still fail closed even with this flag on.
   */
  readonly allowDegraded?: boolean;
}

export interface ReconstructRecallResult {
  readonly artifact: string;
  readonly artifactFormat: string;
  readonly intent: Intent;
  readonly evidence: readonly RecallEvidence[];
  readonly completedFeatures: readonly CompletedFeature[];
  readonly supportingEpisodes: readonly string[];
  readonly confidence: number;
  readonly warnings: readonly RecallWarning[];
}

export interface PatternCompletionResult {
  readonly memories: readonly RecallEvidence[];
  readonly completedFeatures: readonly CompletedFeature[];
  readonly supportingEpisodes: readonly string[];
  readonly confidence: number;
}
