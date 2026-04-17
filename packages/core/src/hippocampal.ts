import type Database from 'better-sqlite3';
import type {
  CueAlias,
  CueFeature,
  CuePolarity,
  EpisodicCue,
  FeatureFamily,
} from '@memrosetta/types';
import {
  DEFAULT_HALF_LIFE_HOURS,
  FEATURE_CAPS,
} from '@memrosetta/types';
import { nowIso } from './utils.js';

/**
 * Hippocampal Indexing helpers (v4 §5).
 *
 * Responsibilities:
 *   1. Canonicalization — repo names, tool slugs, topic phrases resolve
 *      through cue_aliases to a single canonical form before touching
 *      the sparse index. Without this, the index fragments and recall
 *      cannot find episodes by semantically equivalent cues.
 *   2. Sparse coding — per-family caps prevent a single family from
 *      dominating an episode's cue bundle.
 *   3. Bounded Hebbian — decay + activation update that never runs away:
 *        decayed = old * exp(-lambda * delta_hours)
 *        new     = decayed + alpha * activation * (1 - decayed)
 *                  + beta * successful_recall
 *   4. Polarity — +1 cues drive episode match up; -1 anti-cues drive
 *      it down. Same (episode, family, value) can exist under both
 *      polarities independently.
 *   5. Family cap pruning — not normalization. After upsert, if the
 *      family exceeds its max cap (FEATURE_CAPS), the weakest
 *      bindings are deleted. Soft within-family normalization
 *      (rescaling strengths so the family sums to 1) is intentionally
 *      NOT implemented here — Codex review flagged it as a potential
 *      feature that belongs in Step 8 (anti-interference), not Step 6.
 *      The current scoring path relies on clamped [0,1] strengths per
 *      cue, not normalized probabilities.
 */

export interface HippocampalOptions {
  /** Decay constant derivation. Overridden per call if supplied. */
  readonly alpha?: number; // default 0.5
  readonly beta?: number; // default 0.1
  /** Override half-life per family (hours). */
  readonly halfLifeHours?: Partial<Record<FeatureFamily, number>>;
  /** Keep at most caps[family][1] cues per family after upsert. */
  readonly enforceCaps?: boolean;
}

const DEFAULT_ALPHA = 0.5;
const DEFAULT_BETA = 0.1;

interface EpisodicIndexRow {
  readonly episode_id: string;
  readonly feature_type: string;
  readonly feature_value: string;
  readonly polarity: number;
  readonly binding_strength: number;
  readonly last_activated_at: string | null;
}

interface CueAliasRow {
  readonly canonical_form: string;
  readonly alias_form: string;
  readonly feature_family: string;
  readonly source: string | null;
  readonly confidence: number | null;
}

export interface HippocampalStatements {
  readonly getBinding: Database.Statement;
  readonly upsertBinding: Database.Statement;
  readonly listBindingsForEpisode: Database.Statement;
  readonly listBindingsInFamily: Database.Statement;
  readonly deleteWeakest: Database.Statement;
  readonly countInFamily: Database.Statement;
  readonly queryEpisodesByFeature: Database.Statement;

  readonly insertCueAlias: Database.Statement;
  readonly resolveCanonical: Database.Statement;
  readonly listAliasesForCanonical: Database.Statement;
}

export function createHippocampalStatements(
  db: Database.Database,
): HippocampalStatements {
  return {
    getBinding: db.prepare(
      `SELECT * FROM episodic_index
       WHERE episode_id = ? AND feature_type = ? AND feature_value = ? AND polarity = ?`,
    ),
    upsertBinding: db.prepare(`
      INSERT INTO episodic_index
        (episode_id, feature_type, feature_value, polarity, binding_strength, last_activated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(episode_id, feature_type, feature_value, polarity)
      DO UPDATE SET
        binding_strength = excluded.binding_strength,
        last_activated_at = excluded.last_activated_at
    `),
    listBindingsForEpisode: db.prepare(
      `SELECT * FROM episodic_index
       WHERE episode_id = ?
       ORDER BY binding_strength DESC, last_activated_at DESC`,
    ),
    listBindingsInFamily: db.prepare(
      `SELECT * FROM episodic_index
       WHERE episode_id = ? AND feature_type = ?
       ORDER BY binding_strength DESC, last_activated_at DESC`,
    ),
    deleteWeakest: db.prepare(
      `DELETE FROM episodic_index
       WHERE rowid IN (
         SELECT rowid FROM episodic_index
         WHERE episode_id = ? AND feature_type = ?
         ORDER BY binding_strength ASC, last_activated_at ASC
         LIMIT ?
       )`,
    ),
    countInFamily: db.prepare(
      `SELECT COUNT(*) AS cnt FROM episodic_index
       WHERE episode_id = ? AND feature_type = ?`,
    ),
    queryEpisodesByFeature: db.prepare(
      `SELECT episode_id, feature_type, feature_value, polarity,
              binding_strength, last_activated_at
       FROM episodic_index
       WHERE feature_type = ? AND feature_value = ?`,
    ),

    insertCueAlias: db.prepare(`
      INSERT INTO cue_aliases
        (canonical_form, alias_form, feature_family, source, confidence)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(canonical_form, alias_form, feature_family) DO NOTHING
    `),
    resolveCanonical: db.prepare(
      `SELECT canonical_form FROM cue_aliases
       WHERE alias_form = ? AND feature_family = ?`,
    ),
    listAliasesForCanonical: db.prepare(
      `SELECT * FROM cue_aliases WHERE canonical_form = ? AND feature_family = ?`,
    ),
  };
}

export function registerCueAlias(
  stmts: HippocampalStatements,
  alias: CueAlias,
): void {
  stmts.insertCueAlias.run(
    alias.canonicalForm,
    alias.aliasForm,
    alias.featureFamily,
    alias.source ?? null,
    alias.confidence ?? null,
  );
}

/**
 * Resolve a surface cue into its canonical form using cue_aliases.
 * Returns the input unchanged when no alias row matches, so callers
 * that forget to seed aliases still see a consistent API.
 */
export function canonicalizeCue(
  stmts: HippocampalStatements,
  featureFamily: FeatureFamily,
  rawValue: string,
): string {
  const lower = rawValue.trim().toLowerCase();
  const row = stmts.resolveCanonical.get(lower, featureFamily) as
    | { canonical_form: string }
    | undefined;
  return row?.canonical_form ?? lower;
}

function halfLifeToLambda(halfLifeHours: number): number {
  return Math.log(2) / Math.max(halfLifeHours, 0.1);
}

function rowToCue(row: EpisodicIndexRow): EpisodicCue {
  return {
    episodeId: row.episode_id,
    featureType: row.feature_type as FeatureFamily,
    featureValue: row.feature_value,
    polarity: row.polarity as CuePolarity,
    bindingStrength: row.binding_strength,
    lastActivatedAt: row.last_activated_at ?? undefined,
  };
}

export interface ReinforceInput {
  readonly episodeId: string;
  readonly feature: CueFeature;
  readonly activation: number; // 0..1
  readonly successfulRecall?: number; // optional reward signal
  readonly options?: HippocampalOptions;
}

/**
 * Bounded Hebbian reinforcement. Also inserts if the binding does not
 * yet exist (new cues start at strength = alpha * activation).
 *
 * After update, enforces the family-specific cap by pruning the
 * weakest bindings when `enforceCaps` is true (default true).
 */
export function reinforceEpisodicCue(
  db: Database.Database,
  stmts: HippocampalStatements,
  input: ReinforceInput,
): EpisodicCue {
  const polarity: CuePolarity = input.feature.polarity ?? 1;
  const value = input.feature.featureValue;
  const alpha = input.options?.alpha ?? DEFAULT_ALPHA;
  const beta = input.options?.beta ?? DEFAULT_BETA;
  const halfLife =
    input.options?.halfLifeHours?.[input.feature.featureType] ??
    DEFAULT_HALF_LIFE_HOURS[input.feature.featureType];
  const lambda = halfLifeToLambda(halfLife);

  const now = nowIso();

  const txn = db.transaction(() => {
    const existing = stmts.getBinding.get(
      input.episodeId,
      input.feature.featureType,
      value,
      polarity,
    ) as EpisodicIndexRow | undefined;

    let newStrength: number;
    if (existing) {
      const lastTs = existing.last_activated_at
        ? new Date(existing.last_activated_at).getTime()
        : Date.now();
      const deltaHours = Math.max(0, (Date.now() - lastTs) / 3_600_000);
      const decayed = existing.binding_strength * Math.exp(-lambda * deltaHours);
      newStrength =
        decayed +
        alpha * input.activation * (1 - decayed) +
        beta * (input.successfulRecall ?? 0);
    } else {
      newStrength =
        alpha * input.activation + beta * (input.successfulRecall ?? 0);
    }

    // Clamp to [0, 1] so no single cue runs away unbounded.
    newStrength = Math.max(0, Math.min(1, newStrength));

    stmts.upsertBinding.run(
      input.episodeId,
      input.feature.featureType,
      value,
      polarity,
      newStrength,
      now,
    );

    if (input.options?.enforceCaps !== false) {
      enforceFamilyCap(stmts, input.episodeId, input.feature.featureType);
    }
  });
  txn();

  const row = stmts.getBinding.get(
    input.episodeId,
    input.feature.featureType,
    value,
    polarity,
  ) as EpisodicIndexRow;
  return rowToCue(row);
}

function enforceFamilyCap(
  stmts: HippocampalStatements,
  episodeId: string,
  family: FeatureFamily,
): void {
  const cap = FEATURE_CAPS[family]?.[1];
  if (!cap) return;
  const { cnt } = stmts.countInFamily.get(episodeId, family) as { cnt: number };
  if (cnt <= cap) return;
  stmts.deleteWeakest.run(episodeId, family, cnt - cap);
}

export function getCuesForEpisode(
  stmts: HippocampalStatements,
  episodeId: string,
): readonly EpisodicCue[] {
  const rows = stmts.listBindingsForEpisode.all(
    episodeId,
  ) as readonly EpisodicIndexRow[];
  return rows.map(rowToCue);
}

export function getCuesForEpisodeFamily(
  stmts: HippocampalStatements,
  episodeId: string,
  family: FeatureFamily,
): readonly EpisodicCue[] {
  const rows = stmts.listBindingsInFamily.all(
    episodeId,
    family,
  ) as readonly EpisodicIndexRow[];
  return rows.map(rowToCue);
}

export interface EpisodeMatchScore {
  readonly episodeId: string;
  readonly score: number;
  readonly positiveMatches: number;
  readonly negativePenalty: number;
}

/**
 * Score episodes against a list of canonical cues.
 * Positive cues add `bindingStrength` to score.
 * Negative cues (polarity=-1) subtract `bindingStrength` from score.
 *
 * Callers that want recency/goal weighting on top of structural match
 * should compose further in the recall kernel (Step 7).
 */
export function scoreEpisodesByCues(
  stmts: HippocampalStatements,
  cues: readonly CueFeature[],
): readonly EpisodeMatchScore[] {
  const aggregate = new Map<string, {
    positive: number;
    negative: number;
  }>();

  for (const cue of cues) {
    const polarity: CuePolarity = cue.polarity ?? 1;
    const rows = stmts.queryEpisodesByFeature.all(
      cue.featureType,
      cue.featureValue,
    ) as readonly EpisodicIndexRow[];

    for (const row of rows) {
      const entry = aggregate.get(row.episode_id) ?? { positive: 0, negative: 0 };

      // Treat the episode's stored polarity as authoritative: if the
      // index holds a negative cue for value X and the caller asks
      // about X with either polarity, the -1 binding is an anti-cue
      // against the match score.
      if (row.polarity === -1) {
        entry.negative += row.binding_strength;
      } else if (polarity === 1) {
        entry.positive += row.binding_strength;
      }

      aggregate.set(row.episode_id, entry);
    }
  }

  const results: EpisodeMatchScore[] = [];
  for (const [episodeId, { positive, negative }] of aggregate) {
    results.push({
      episodeId,
      score: positive - negative,
      positiveMatches: positive,
      negativePenalty: negative,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
