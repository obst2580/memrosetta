import type Database from 'better-sqlite3';
import type {
  CueFeature,
  Intent,
  ReconstructRecallInput,
  ReconstructRecallResult,
  RecallEvidence,
  RecallWarning,
  StateVector,
} from '@memrosetta/types';
import { INTENT_ROUTING } from '@memrosetta/types';
import { patternComplete } from './pattern-complete.js';
import type { HippocampalStatements } from './hippocampal.js';
import { applyAntiInterference as applyFullAntiInterference } from './anti-interference.js';
import { searchMemories } from './search.js';

/**
 * Reconstructive Recall API (v4 §6, §8).
 *
 * Pipeline:
 *   1. state vector assembly (coarse + fine merge)
 *   2. cue expansion (explicit + derived from state vector)
 *   3. pattern completion (Step 7b)
 *   4. anti-interference filter (diversity + goal-compat + abstraction gate)
 *   5. reconstructive synthesis (strict verbatim slot-swap, or adaptive LLM)
 *   6. result assembly with warnings and provenance
 *
 * Hook seams (v4 §12):
 *   - `on_evidence_assembly` — fires after anti-interference, before synthesis
 *   - `pre_synthesis`        — fires right before synthesis runs
 *   - `post_synthesis`       — fires after synthesis with the artifact
 *   - `on_recall`            — fires at the end (Reconsolidation plug-point)
 *
 * Default kernel emits no LLM-backed synthesis because Layer C is off:
 * `reconstructRecall` returns a deterministic evidence-bound artifact
 * so the entire recall path stays audit-friendly and reproducible.
 * Layer C kernels (MINERVA 2 Echo, reconsolidation) plug into hooks
 * without touching the Layer A contract.
 */

export type HookName =
  | 'on_evidence_assembly'
  | 'pre_synthesis'
  | 'post_synthesis'
  | 'on_recall';

export interface HookContext {
  readonly on_evidence_assembly: {
    readonly evidence: readonly RecallEvidence[];
    readonly intent: Intent;
    readonly stateVector?: StateVector;
  };
  readonly pre_synthesis: {
    readonly evidence: readonly RecallEvidence[];
    readonly intent: Intent;
    readonly strict?: boolean;
  };
  readonly post_synthesis: {
    readonly artifact: string;
    readonly evidence: readonly RecallEvidence[];
    readonly confidence: number;
  };
  readonly on_recall: {
    readonly artifact: string;
    readonly evidence: readonly RecallEvidence[];
  };
}

export type HookHandler<K extends HookName> = (
  ctx: HookContext[K],
) => void | Promise<void>;

export class RecallHookRegistry {
  private readonly handlers: {
    [K in HookName]: Array<HookHandler<K>>;
  } = {
    on_evidence_assembly: [],
    pre_synthesis: [],
    post_synthesis: [],
    on_recall: [],
  };

  register<K extends HookName>(name: K, handler: HookHandler<K>): void {
    this.handlers[name].push(handler);
  }

  async fire<K extends HookName>(name: K, ctx: HookContext[K]): Promise<void> {
    for (const handler of this.handlers[name]) {
      await handler(ctx);
    }
  }
}

/**
 * Assemble a structured state vector from the call input plus any
 * hints derived from the explicit query. For now the call-supplied
 * context wins; future Step 8 logic can enrich it with active-goal
 * lookup or segment merges.
 */
function assembleStateVector(
  input: ReconstructRecallInput,
): StateVector | undefined {
  return input.context;
}

/**
 * Cue expansion: take caller-supplied cues (if any) plus cues derived
 * from the state vector. Every surface cue arrives un-canonicalized;
 * pattern-complete will canonicalize downstream.
 */
/**
 * Minimal query → cue extraction (Codex Step 7 review must-fix #1).
 *
 * Splits on whitespace, drops common stopwords and tokens shorter
 * than 3 chars, lower-cases, and emits the remainder as `topic`
 * cues at reduced activation. This is deliberately a heuristic
 * baseline — real query understanding lives in Layer B/C. Without
 * any extraction the recall entry point is unusable for callers
 * that only know a natural-language query.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'are', 'but',
  'not', 'can', 'will', 'what', 'how', 'why', 'when', 'where', 'who',
  '이것', '저것', '이거', '저거', '그리고', '하지만', '그런데',
]);

function extractQueryCues(query: string): CueFeature[] {
  if (!query) return [];
  const tokens = query
    .toLowerCase()
    .split(/[\s,.!?;:()"'\[\]{}<>/\\]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  // De-duplicate while preserving insertion order.
  const seen = new Set<string>();
  const cues: CueFeature[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    cues.push({ featureType: 'topic', featureValue: t });
  }
  return cues;
}

function expandCues(
  input: ReconstructRecallInput,
  state: StateVector | undefined,
): readonly CueFeature[] {
  const cues: CueFeature[] = [];
  if (input.cues) {
    cues.push(...input.cues);
  }

  // Query-derived topic cues (must-fix #1). Caller-supplied cues stay
  // authoritative; query extraction only adds coverage.
  cues.push(...extractQueryCues(input.query));

  if (!state) return cues;

  if (state.project) cues.push({ featureType: 'project', featureValue: state.project });
  if (state.repo) cues.push({ featureType: 'repo', featureValue: state.repo });
  if (state.language) cues.push({ featureType: 'language', featureValue: state.language });
  if (state.framework) cues.push({ featureType: 'framework', featureValue: state.framework });
  if (state.taskMode) cues.push({ featureType: 'task_mode', featureValue: state.taskMode });
  if (state.toolRegime) {
    for (const tool of state.toolRegime) {
      cues.push({ featureType: 'tool', featureValue: tool });
    }
  }
  if (state.activeGoals) {
    for (const g of state.activeGoals) {
      cues.push({ featureType: 'goal', featureValue: g.goalId });
    }
  }
  // Soft fixes #2: use the remaining state-vector fields so they stop
  // being inert metadata.
  if (state.actor) {
    cues.push({ featureType: 'who', featureValue: state.actor });
  }
  if (state.conversationTopic) {
    cues.push({ featureType: 'topic', featureValue: state.conversationTopic });
  }

  return cues;
}

/**
 * Anti-interference stage (v4 §7, Step 9).
 *
 * Layer A strict filters run first (strict provenance, reuse
 * procedural preference). The Step 9 module then applies the
 * full anti-interference pipeline (diversity, goal compatibility,
 * abstraction gating) with scoring information retained for
 * observability via the returned ScoredEvidence.
 *
 * Layer C hooks (reconsolidation, MINERVA echo) run AFTER this
 * stage via the `on_evidence_assembly` / `pre_synthesis` hooks.
 */
function applyAntiInterferenceLocal(
  db: import('better-sqlite3').Database,
  evidence: readonly RecallEvidence[],
  intent: Intent,
  stateVector: StateVector | undefined,
): RecallEvidence[] {
  const routing = INTENT_ROUTING[intent];
  let filtered = [...evidence];

  // Strict provenance first (drops memories without verbatim under verify).
  if (routing.strictProvenance) {
    filtered = filtered.filter(
      (e) => e.verbatimContent != null && e.verbatimContent.length > 0,
    );
  }

  if (intent === 'reuse') {
    filtered.sort((a, b) => {
      const rank: Record<string, number> = {
        procedural: 0,
        semantic: 1,
        episodic: 2,
      };
      const ra = rank[a.system ?? ''] ?? 3;
      const rb = rank[b.system ?? ''] ?? 3;
      return ra - rb;
    });
  }

  if (filtered.length === 0) return filtered;

  // Step 9 full anti-interference: diversity + goal_compat + abstraction.
  const scored = applyFullAntiInterference({
    db,
    evidence: filtered,
    intent,
    stateVector,
  });
  return scored.map((s) => s.evidence);
}

/**
 * Deterministic synthesis: produce an evidence-bound artifact without
 * calling an LLM. For Layer A this is sufficient because the hook
 * contract lets Layer C plug smarter synthesis later.
 */
function synthesize(
  input: ReconstructRecallInput,
  evidence: readonly RecallEvidence[],
): { readonly artifact: string; readonly artifactFormat: string } {
  const routing = INTENT_ROUTING[input.intent];
  const top = evidence.slice(0, input.maxEvidence ?? 5);

  if (input.intent === 'verify') {
    const lines = top
      .map((e) => {
        const body = e.verbatimContent ?? '(no verbatim)';
        return `- ${body}  [memory:${e.memoryId}${e.episodeId ? `; episode:${e.episodeId}` : ''}]`;
      })
      .join('\n');
    return {
      artifact: lines || '(no evidence)',
      artifactFormat: routing.outputFormat,
    };
  }

  if (input.intent === 'explain') {
    const lines = top.map((e) => {
      const body = e.gistContent ?? e.verbatimContent ?? '';
      return `- ${body}`;
    });
    return {
      artifact: lines.join('\n') || '(no evidence)',
      artifactFormat: routing.outputFormat,
    };
  }

  if (input.intent === 'decide') {
    const lines = top.map((e) => {
      const body = e.gistContent ?? e.verbatimContent ?? '';
      const role = e.role ?? 'memory';
      return `- [${role}] ${body}`;
    });
    return {
      artifact: lines.join('\n') || '(no evidence)',
      artifactFormat: routing.outputFormat,
    };
  }

  if (input.intent === 'reuse') {
    // Emit procedural/semantic content ordered by the anti-interference
    // step. Caller can adapt downstream or pass through an LLM hook.
    const lines = top.map((e) => e.gistContent ?? e.verbatimContent ?? '');
    return {
      artifact: lines.join('\n\n') || '(no evidence)',
      artifactFormat: routing.outputFormat,
    };
  }

  // browse
  const lines = top.map((e) => {
    const body = e.gistContent ?? e.verbatimContent ?? '';
    return `- ${body}`;
  });
  return {
    artifact: lines.join('\n') || '(no evidence)',
    artifactFormat: routing.outputFormat,
  };
}

export async function reconstructRecall(
  db: Database.Database,
  hippo: HippocampalStatements,
  input: ReconstructRecallInput,
  hooks: RecallHookRegistry = new RecallHookRegistry(),
): Promise<ReconstructRecallResult> {
  const warnings: RecallWarning[] = [];

  // 1. State vector
  const stateVector = assembleStateVector(input);

  // 2. Cue expansion
  const cues = expandCues(input, stateVector);
  if (cues.length === 0) {
    warnings.push({
      kind: 'no_evidence',
      message: 'No cues or state vector provided — recall cannot match',
    });
    return {
      artifact: '(no cues)',
      artifactFormat: INTENT_ROUTING[input.intent].outputFormat,
      intent: input.intent,
      evidence: [],
      completedFeatures: [],
      supportingEpisodes: [],
      confidence: 0,
      warnings,
    };
  }

  // 3. Pattern completion
  const completion = patternComplete(db, hippo, {
    userId: input.userId,
    cues,
    stateVector,
    intent: input.intent,
    maxMemories: input.maxEvidence,
  });

  if (completion.supportingEpisodes.length === 0) {
    // Distinguish "write-side gap" (episodic layer is empty for this
    // user at all) from "recall-side miss" (layer exists but no cues
    // hit). The former is actionable via backfill; the latter is a
    // genuine query-evidence mismatch.
    const episodicLayerEmpty = isEpisodicLayerEmpty(db, input.userId);
    if (episodicLayerEmpty) {
      // Opt-in degraded fallback: only kicks in for non-strict
      // intents. verify and reuse still fail closed — recall's
      // contract is that verify == verbatim-only, and wrapping
      // lexical search hits as "evidence" would violate that.
      const degradedOk =
        input.allowDegraded === true &&
        !INTENT_ROUTING[input.intent].strictProvenance &&
        input.intent === 'browse';

      if (degradedOk) {
        const fallback = buildDegradedFallback(db, input, hooks);
        warnings.push({
          kind: 'episodic_layer_empty',
          message:
            'Episodic layer is empty for this user — no episodes or bindings exist yet.',
          hint: "Run 'memrosetta maintain --build-episodes' to backfill episodes from existing memories.",
        });
        warnings.push({
          kind: 'degraded_search_fallback',
          message:
            'Returned lexical search results in place of reconstructive recall (confidence capped).',
          hint: 'Not reconstructive recall — verbatim/gist traceability is not guaranteed for this intent.',
        });
        return {
          ...(await fallback),
          warnings,
        };
      }

      warnings.push({
        kind: 'episodic_layer_empty',
        message:
          'Episodic layer is empty for this user — no episodes or bindings exist yet.',
        hint: "Run 'memrosetta maintain --build-episodes' to backfill episodes from existing memories, or wait for store() to accumulate new ones once auto-bind is enabled.",
      });
    } else {
      warnings.push({
        kind: 'no_episodes_matched',
        message: 'No episodes matched the provided cues',
      });
    }
  }

  // 4. Anti-interference (Step 9 full pipeline)
  const filtered = applyAntiInterferenceLocal(
    db,
    completion.memories,
    input.intent,
    stateVector,
  );

  if (filtered.length === 0 && completion.memories.length > 0) {
    warnings.push({
      kind: 'intent_mismatch',
      message: `Evidence found but none compatible with intent=${input.intent}`,
    });
  }

  if (INTENT_ROUTING[input.intent].strictProvenance) {
    const missingVerbatim = completion.memories.filter(
      (m) => !m.verbatimContent,
    );
    for (const m of missingVerbatim) {
      warnings.push({
        kind: 'provenance_gap',
        memoryId: m.memoryId,
        message: 'verify intent requires verbatim content but memory has none',
      });
    }
  }

  await hooks.fire('on_evidence_assembly', {
    evidence: filtered,
    intent: input.intent,
    stateVector,
  });

  // 5. Synthesis
  await hooks.fire('pre_synthesis', {
    evidence: filtered,
    intent: input.intent,
    strict: input.strict,
  });

  const { artifact, artifactFormat } = synthesize(input, filtered);

  await hooks.fire('post_synthesis', {
    artifact,
    evidence: filtered,
    confidence: completion.confidence,
  });

  if (completion.confidence < 0.3 && filtered.length > 0) {
    warnings.push({
      kind: 'low_confidence',
      message: `Recall confidence ${completion.confidence.toFixed(2)} is below threshold`,
    });
  }

  // 6. Result + final hook
  const result: ReconstructRecallResult = {
    artifact,
    artifactFormat,
    intent: input.intent,
    evidence: filtered,
    completedFeatures: completion.completedFeatures,
    supportingEpisodes: completion.supportingEpisodes,
    confidence: completion.confidence,
    warnings,
  };

  await hooks.fire('on_recall', {
    artifact,
    evidence: filtered,
  });

  return result;
}

/**
 * Degraded fallback: when the episodic layer is empty but the caller
 * explicitly opted in with `allowDegraded` and the intent is `browse`,
 * serve lexical search results wrapped as recall evidence.
 *
 * Contract:
 *   - confidence is capped at 0.4 (below any real recall)
 *   - evidence is marked with the memory's system/role but NO
 *     episodeId (since no episode exists)
 *   - supportingEpisodes is always empty
 *   - artifact header explicitly labels the result as degraded
 *
 * Strict intents never reach this path; their routing keeps them
 * honest even if `allowDegraded` is true.
 */
async function buildDegradedFallback(
  db: Database.Database,
  input: ReconstructRecallInput,
  hooks: RecallHookRegistry,
): Promise<Omit<ReconstructRecallResult, 'warnings'>> {
  const limit = Math.max(1, input.maxEvidence ?? 5);
  const searchResponse = searchMemories(
    db,
    { userId: input.userId, query: input.query, limit },
    /* skipAccessTracking */ true,
  );

  const evidence: RecallEvidence[] = searchResponse.results.map((r) => ({
    memoryId: r.memory.memoryId,
    role: r.memory.memoryRole,
    system: r.memory.memorySystem,
    confidence: Math.min(0.4, r.score ?? 0.2),
    verbatimContent: r.memory.verbatim ?? r.memory.content,
    gistContent: r.memory.gist,
  }));

  await hooks.fire('on_evidence_assembly', {
    evidence,
    intent: input.intent,
    stateVector: input.context,
  });

  const headerLines = [
    '[degraded: lexical search fallback — episodic layer empty]',
    '',
  ];
  const bodyLines = evidence.map((e, i) => {
    const body =
      (e.gistContent ?? e.verbatimContent ?? '').replace(/\s+/g, ' ').trim() ||
      '(no body)';
    return `${i + 1}. ${body}`;
  });
  const artifact = [...headerLines, ...bodyLines].join('\n') || '(no results)';

  await hooks.fire('post_synthesis', {
    artifact,
    evidence,
    confidence: 0.3,
  });

  return {
    artifact,
    artifactFormat: INTENT_ROUTING[input.intent].outputFormat,
    intent: input.intent,
    evidence,
    completedFeatures: [],
    supportingEpisodes: [],
    confidence: evidence.length > 0 ? 0.3 : 0,
  };
}

/**
 * Detect whether the episodic layer is uninitialized for a given
 * user. Used by recall to distinguish a write-side gap (no episodes
 * exist at all → backfill can fix it) from a recall-side miss (layer
 * populated but cues didn't hit anything).
 *
 * Checked tables: episodes + memory_episodic_bindings. If both are
 * empty for this user, we treat the layer as "not materialized yet".
 */
export function isEpisodicLayerEmpty(
  db: Database.Database,
  userId: string,
): boolean {
  try {
    const epRow = db
      .prepare('SELECT COUNT(*) AS c FROM episodes WHERE user_id = ?')
      .get(userId) as { c: number } | undefined;
    if ((epRow?.c ?? 0) > 0) return false;
    const bindRow = db
      .prepare(
        `SELECT COUNT(*) AS c
           FROM memory_episodic_bindings b
           JOIN memories m ON m.memory_id = b.memory_id
          WHERE m.user_id = ?`,
      )
      .get(userId) as { c: number } | undefined;
    return (bindRow?.c ?? 0) === 0;
  } catch {
    // Missing tables → v9 schema. Treat as empty.
    return true;
  }
}
