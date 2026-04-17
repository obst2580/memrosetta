/**
 * Hippocampal Indexing types (v4 §5, Teyler & DiScenna 1986).
 *
 * A sparse cue index that points at episodes the way the hippocampus
 * points at distributed cortical traces. Feature families have
 * different entropy characteristics and different caps (§5.1).
 * Polarity is bipolar: +1 positive cues drive match scores up, -1
 * anti-cues drive them down so recall can represent "not this repo,
 * not this goal" style exclusion contexts.
 */

export type FeatureFamily =
  | 'who'
  | 'project'
  | 'repo'
  | 'tool'
  | 'goal'
  | 'task_mode'
  | 'topic'
  | 'entity'
  | 'concept'
  | 'constraint'
  | 'decision_subject'
  | 'language'
  | 'framework';

export type CuePolarity = 1 | -1;

export interface CueFeature {
  readonly featureType: FeatureFamily;
  readonly featureValue: string; // canonical form only
  readonly polarity?: CuePolarity; // default 1
}

export interface EpisodicCue {
  readonly episodeId: string;
  readonly featureType: FeatureFamily;
  readonly featureValue: string;
  readonly polarity: CuePolarity;
  readonly bindingStrength: number;
  readonly lastActivatedAt?: string;
}

export interface CueAlias {
  readonly canonicalForm: string;
  readonly aliasForm: string;
  readonly featureFamily: FeatureFamily;
  readonly source?: 'manual' | 'learned' | 'derived';
  readonly confidence?: number;
}

/**
 * Per-family caps (v4 §5.1). Bounds the sparse index so one family
 * cannot dominate an episode's cue bundle and drown out discriminative
 * features from other families. [min, max] is advisory: helpers cap
 * at max, and retention when normalizing prefers higher-strength cues.
 */
export const FEATURE_CAPS: Readonly<Record<FeatureFamily, readonly [number, number]>> = {
  who: [1, 2],
  project: [1, 3],
  repo: [1, 3],
  tool: [1, 3],
  goal: [1, 3],
  task_mode: [1, 2],
  language: [1, 3],
  framework: [1, 3],
  topic: [3, 6],
  entity: [4, 8],
  concept: [4, 8],
  constraint: [2, 5],
  decision_subject: [1, 3],
};

/**
 * Default half-life (hours) per feature family (v4 spec 17.3 +
 * Codex-approved tuning). Used to derive the Hebbian decay lambda:
 *    lambda = ln(2) / half_life_hours
 */
export const DEFAULT_HALF_LIFE_HOURS: Readonly<Record<FeatureFamily, number>> = {
  who: 90 * 24,
  project: 90 * 24,
  repo: 90 * 24,
  tool: 14 * 24,
  task_mode: 14 * 24,
  framework: 14 * 24,
  language: 60 * 24,
  topic: 3 * 24,
  entity: 3 * 24,
  concept: 3 * 24,
  constraint: 7 * 24,
  decision_subject: 30 * 24,
  goal: 24, // overridden at call time by active goal horizon
};
