import type Database from 'better-sqlite3';
import type {
  CompletedFeature,
  CueFeature,
  EpisodicCue,
  Intent,
  MemoryRole,
  MemorySystem,
  PatternCompletionResult,
  RecallEvidence,
  StateVector,
} from '@memrosetta/types';
import { INTENT_ROUTING } from '@memrosetta/types';
import { rowToMemory, type MemoryRow } from './mapper.js';
import {
  canonicalizeCue,
  getCuesForEpisode,
  scoreEpisodesByCues,
  type HippocampalStatements,
} from './hippocampal.js';

/**
 * Pattern Completion primitive (v4 §6, Codex 3rd review Q13).
 *
 * Closes the reconstructive loop at Layer A: sparse cues become
 * candidate episodes via the hippocampal index, and missing
 * feature values are "completed" from the retrieved episodes' other
 * cues. Without this operator, `reconstructRecall` would collapse into
 * evidence gathering — not actual reconstruction.
 *
 * Explicit non-goal: MINERVA 2 Echo. Pattern Completion here is
 * evidence-aware and deterministic. MINERVA can later plug into the
 * recall synthesis stage via the `pre_synthesis` hook; the Layer A
 * kernel does not need blended trace vectors.
 */

export interface PatternCompleteInput {
  readonly userId: string;
  readonly cues: readonly CueFeature[];
  readonly stateVector?: StateVector;
  readonly intent: Intent;
  readonly maxEpisodes?: number;
  readonly maxMemories?: number;
}

const DEFAULT_MAX_EPISODES = 5;
const DEFAULT_MAX_MEMORIES = 20;

/**
 * Recency decay applied to episode scores. Matches the recency boost
 * constants that v0.9.1 tuned in search.ts (0.99 per hour).
 */
function recencyBoost(lastActivatedAt: string | undefined): number {
  if (!lastActivatedAt) return 0.5;
  const deltaHours = Math.max(
    0,
    (Date.now() - new Date(lastActivatedAt).getTime()) / 3_600_000,
  );
  return Math.pow(0.99, deltaHours);
}

/**
 * Goal-fit boost: an episode whose dominant_goal_id lines up with one
 * of the active goals in the caller's state vector scores 1.2x, else
 * 1.0. This stays intentionally shallow — richer scoring belongs in
 * Step 8 (Anti-Interference) / the retrieval coach.
 */
function goalFitBoost(
  db: Database.Database,
  episodeId: string,
  stateVector: StateVector | undefined,
): number {
  if (!stateVector?.activeGoals || stateVector.activeGoals.length === 0) {
    return 1.0;
  }
  const row = db
    .prepare('SELECT dominant_goal_id FROM episodes WHERE episode_id = ?')
    .get(episodeId) as { dominant_goal_id: string | null } | undefined;
  if (!row?.dominant_goal_id) return 1.0;
  const matched = stateVector.activeGoals.some(
    (g) => g.goalId === row.dominant_goal_id,
  );
  return matched ? 1.2 : 1.0;
}

function allowedBySystems(
  memorySystem: string | null,
  preferred: readonly MemorySystem[],
  intent: Intent,
): boolean {
  if (!memorySystem) return true; // legacy rows without axes — let through
  if (intent === 'browse') return true;
  return preferred.includes(memorySystem as MemorySystem);
}

export function patternComplete(
  db: Database.Database,
  hippo: HippocampalStatements,
  input: PatternCompleteInput,
): PatternCompletionResult {
  const routing = INTENT_ROUTING[input.intent];
  const maxEpisodes = input.maxEpisodes ?? DEFAULT_MAX_EPISODES;
  const maxMemories = input.maxMemories ?? DEFAULT_MAX_MEMORIES;

  // 1. Normalize cues to canonical form before matching.
  const canonicalCues: CueFeature[] = input.cues.map((c) => ({
    featureType: c.featureType,
    featureValue: canonicalizeCue(hippo, c.featureType, c.featureValue),
    polarity: c.polarity,
  }));

  // 2. Episode overlap scoring (positive - negative from the index).
  const rawScored = scoreEpisodesByCues(hippo, canonicalCues);
  if (rawScored.length === 0) {
    return {
      memories: [],
      completedFeatures: [],
      supportingEpisodes: [],
      confidence: 0,
    };
  }

  // 3. Apply recency + goal-fit boosts, then take top-K.
  const boosted = rawScored
    .map((e) => {
      const cues = getCuesForEpisode(hippo, e.episodeId);
      const recency = recencyBoost(cues[0]?.lastActivatedAt);
      const goalFit = goalFitBoost(db, e.episodeId, input.stateVector);
      return {
        ...e,
        cues,
        finalScore: e.score * recency * goalFit,
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, maxEpisodes);

  // 4. Weighted completion: accumulate missing-feature evidence from the
  // surviving episodes so downstream synthesis can quote features the
  // caller did not explicitly ask for.
  const completedMap = new Map<string, number>();
  const cuedKeys = new Set(
    canonicalCues.map((c) => `${c.featureType}:${c.featureValue}`),
  );
  for (const ep of boosted) {
    for (const cue of ep.cues) {
      const key = `${cue.featureType}:${cue.featureValue}`;
      if (cuedKeys.has(key)) continue;
      if (cue.polarity !== 1) continue;
      const prev = completedMap.get(key) ?? 0;
      completedMap.set(key, prev + ep.finalScore * cue.bindingStrength);
    }
  }
  const completedFeatures: CompletedFeature[] = Array.from(
    completedMap.entries(),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 32)
    .map(([key, score]) => {
      const [featureType, featureValue] = key.split(':');
      return { featureType, featureValue, score };
    });

  // 5. Expand to memories via memory_episodic_bindings, scoring each
  // by its binding strength times the parent episode score.
  const episodeIds = boosted.map((b) => b.episodeId);
  const placeholders = episodeIds.map(() => '?').join(', ');
  const memoryRows = db
    .prepare(
      `SELECT m.*, b.episode_id, b.binding_strength
       FROM memories m
       JOIN memory_episodic_bindings b ON b.memory_id = m.memory_id
       WHERE b.episode_id IN (${placeholders})
         AND m.user_id = ?
         AND m.is_latest = 1
         AND m.invalidated_at IS NULL`,
    )
    .all(...episodeIds, input.userId) as ReadonlyArray<
    MemoryRow & { episode_id: string; binding_strength: number }
  >;

  const episodeScoreById = new Map(boosted.map((e) => [e.episodeId, e.finalScore]));

  const scoredMemories: Array<RecallEvidence & { score: number }> = [];
  for (const row of memoryRows) {
    if (!allowedBySystems(row.memory_system, routing.preferredSystems, input.intent)) {
      continue;
    }
    const m = rowToMemory(row);
    const epScore = episodeScoreById.get(row.episode_id) ?? 0;
    const memoryScore = epScore * (row.binding_strength ?? 1);
    scoredMemories.push({
      memoryId: m.memoryId,
      episodeId: row.episode_id,
      role: row.memory_role as MemoryRole | null ?? undefined,
      system: (row.memory_system as MemorySystem | null) ?? undefined,
      confidence: m.confidence ?? 1,
      bindingStrength: row.binding_strength ?? 1,
      verbatimContent: m.verbatimContent,
      gistContent: m.gistContent,
      score: memoryScore,
    });
  }

  scoredMemories.sort((a, b) => b.score - a.score);
  const evidence = scoredMemories.slice(0, maxMemories).map(
    ({ score: _score, ...rest }) => rest,
  );

  const confidence =
    evidence.length === 0
      ? 0
      : Math.min(1, boosted[0].finalScore / (boosted[0].positiveMatches || 1));

  return {
    memories: evidence,
    completedFeatures,
    supportingEpisodes: episodeIds,
    confidence,
  };
}
