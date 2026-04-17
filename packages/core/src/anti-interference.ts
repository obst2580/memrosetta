import type Database from 'better-sqlite3';
import type {
  AbstractionLevel,
  AbstractionLevelValue,
  Intent,
  RecallEvidence,
  StateVector,
} from '@memrosetta/types';
import { INTENT_ROUTING } from '@memrosetta/types';

/**
 * Anti-Interference filters (v4 §7, Codex 3rd review Q5/Q8).
 *
 * Three independent filters compose into the recall kernel's final
 * ranking step. Each one addresses a specific failure mode:
 *
 *   - diversityPenalty: the same top evidence appearing in slightly
 *     different wording drowns out alternative reconstructions.
 *     Penalize candidates that overlap too much with already-selected
 *     ones.
 *
 *   - goalCompatibilityScore: procedural memories linked to a goal
 *     of a given goal_type should rank higher when the caller's
 *     active goals share that goal_type. Prevents cross-goal
 *     contamination where a Python-review prototype surfaces during
 *     a Rust-review task.
 *
 *   - abstractionLevelGate: verify/explain prefer concrete traces;
 *     decide/reuse prefer higher-level prototypes; browse allows all.
 *
 * Keep this deterministic. Layer C LLM-backed filters plug into
 * `pre_synthesis` / `on_recall` hooks on top, not inline.
 */

export interface AntiInterferenceInput {
  readonly db: Database.Database;
  readonly evidence: readonly RecallEvidence[];
  readonly intent: Intent;
  readonly stateVector?: StateVector;
  /** Penalty weight for duplicates. 0 disables. Default 0.5. */
  readonly diversityWeight?: number;
  /** Minimum Jaccard overlap that counts as "too similar". Default 0.6. */
  readonly diversityThreshold?: number;
  /** Weight for goal compatibility boost (0..1). Default 0.3. */
  readonly goalWeight?: number;
}

export interface ScoredEvidence {
  readonly evidence: RecallEvidence;
  readonly baseScore: number;
  readonly diversityPenalty: number;
  readonly goalCompatibility: number;
  readonly abstractionFit: number;
  readonly finalScore: number;
}

const DEFAULT_DIVERSITY_WEIGHT = 0.5;
const DEFAULT_DIVERSITY_THRESHOLD = 0.6;
const DEFAULT_GOAL_WEIGHT = 0.3;

function tokenize(text: string | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .split(/[\s,.!?;:()"'\[\]{}<>/\\]+/)
      .filter((t) => t.length >= 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const t of a) {
    if (b.has(t)) intersect += 1;
  }
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

function evidenceText(e: RecallEvidence): string | undefined {
  return e.gistContent ?? e.verbatimContent;
}

/**
 * Resolve the active-goal goal_types for the caller so per-evidence
 * compatibility can be computed with a single DB round-trip per
 * active goal. Returns empty map when no active goals are supplied.
 */
function resolveActiveGoalTypes(
  db: Database.Database,
  stateVector: StateVector | undefined,
): Map<string, string> {
  const byId = new Map<string, string>();
  if (!stateVector?.activeGoals || stateVector.activeGoals.length === 0) {
    return byId;
  }
  const ids = stateVector.activeGoals.map((g) => g.goalId);
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT goal_id, goal_type FROM goals WHERE goal_id IN (${placeholders})`,
    )
    .all(...ids) as readonly { goal_id: string; goal_type: string | null }[];
  for (const row of rows) {
    if (row.goal_type) byId.set(row.goal_id, row.goal_type);
  }
  return byId;
}

/**
 * Look up the dominant goal(s) of the memory's parent episode so the
 * evidence can be matched against the caller's active goal types.
 */
function resolveMemoryGoalType(
  db: Database.Database,
  memoryId: string,
  episodeId: string | undefined,
): string | undefined {
  // Prefer direct goal_memory_links attribution.
  const direct = db
    .prepare(
      `SELECT g.goal_type
       FROM goal_memory_links l
       JOIN goals g ON g.goal_id = l.goal_id
       WHERE l.memory_id = ?
       ORDER BY l.created_at DESC LIMIT 1`,
    )
    .get(memoryId) as { goal_type: string | null } | undefined;
  if (direct?.goal_type) return direct.goal_type;

  if (!episodeId) return undefined;
  const viaEpisode = db
    .prepare(
      `SELECT g.goal_type FROM episodes e
       LEFT JOIN goals g ON g.goal_id = e.dominant_goal_id
       WHERE e.episode_id = ?`,
    )
    .get(episodeId) as { goal_type: string | null } | undefined;
  return viaEpisode?.goal_type ?? undefined;
}

/**
 * Abstraction level gating per intent. Returns a multiplier in
 * [0, 1]: 1 means "fully compatible", 0 means "blocked".
 */
function abstractionFit(
  evidence: RecallEvidence,
  intent: Intent,
  db: Database.Database,
): number {
  const routing = INTENT_ROUTING[intent];
  if (routing.abstractionLevel === 'all') return 1;

  const level = lookupAbstractionLevel(db, evidence.memoryId);

  const preferred = preferredLevelsFor(routing.abstractionLevel);
  if (level == null) {
    // Layer A facts without a construct — treat as mid. Browse already
    // returned above; for gated intents, accept with a mild dampen.
    return preferred.includes(3) ? 0.9 : 0.7;
  }
  return preferred.includes(level) ? 1 : 0.5;
}

function lookupAbstractionLevel(
  db: Database.Database,
  memoryId: string,
): AbstractionLevelValue | null {
  const row = db
    .prepare('SELECT abstraction_level FROM memory_constructs WHERE memory_id = ?')
    .get(memoryId) as { abstraction_level: number } | undefined;
  if (!row) return null;
  return row.abstraction_level as AbstractionLevelValue;
}

function preferredLevelsFor(level: AbstractionLevel): readonly number[] {
  switch (level) {
    case 'lowest':
      return [1];
    case 'low':
      return [1, 2];
    case 'mid':
      return [2, 3, 4];
    case 'high':
      return [4, 5];
    case 'all':
    default:
      return [1, 2, 3, 4, 5];
  }
}

export function applyAntiInterference(
  input: AntiInterferenceInput,
): readonly ScoredEvidence[] {
  const diversityWeight = input.diversityWeight ?? DEFAULT_DIVERSITY_WEIGHT;
  const diversityThreshold = input.diversityThreshold ?? DEFAULT_DIVERSITY_THRESHOLD;
  const goalWeight = input.goalWeight ?? DEFAULT_GOAL_WEIGHT;

  const activeGoalTypes = resolveActiveGoalTypes(input.db, input.stateVector);
  const activeGoalTypeSet = new Set(activeGoalTypes.values());

  const selectedTokens: Set<string>[] = [];
  const scored: ScoredEvidence[] = [];

  // Evidence arrives pre-sorted by pattern completion (binding_strength
  // * episode score). We walk in order so earlier picks anchor
  // diversity comparisons.
  for (const e of input.evidence) {
    const tokens = tokenize(evidenceText(e));

    // Diversity penalty: max overlap against already-selected.
    let maxOverlap = 0;
    for (const prev of selectedTokens) {
      const sim = jaccard(tokens, prev);
      if (sim > maxOverlap) maxOverlap = sim;
    }
    const overlapPenalty =
      maxOverlap >= diversityThreshold ? diversityWeight * maxOverlap : 0;

    // Goal compatibility.
    const memoryGoalType = resolveMemoryGoalType(
      input.db,
      e.memoryId,
      e.episodeId,
    );
    let goalCompat = 0;
    if (memoryGoalType && activeGoalTypeSet.size > 0) {
      goalCompat = activeGoalTypeSet.has(memoryGoalType) ? goalWeight : -goalWeight / 2;
    }

    const abstractionMultiplier = abstractionFit(e, input.intent, input.db);

    const baseScore = e.confidence * (e.bindingStrength ?? 1);
    const finalScore =
      Math.max(0, baseScore * abstractionMultiplier + goalCompat - overlapPenalty);

    scored.push({
      evidence: e,
      baseScore,
      diversityPenalty: overlapPenalty,
      goalCompatibility: goalCompat,
      abstractionFit: abstractionMultiplier,
      finalScore,
    });
    selectedTokens.push(tokens);
  }

  scored.sort((a, b) => b.finalScore - a.finalScore);
  return scored;
}
