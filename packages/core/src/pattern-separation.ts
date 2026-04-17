import type Database from 'better-sqlite3';
import type { ExemplarRole } from '@memrosetta/types';
import {
  computeNoveltyScore,
  type NoveltyInput,
} from './novelty.js';
import {
  linkConstructExemplar,
  type ConstructStatements,
} from './constructs.js';

/**
 * Pattern Separation refinement (v4 Layer B, Yassa & Stark 2011).
 *
 * When a new memory is too similar to an existing construct's
 * exemplar set, store-time pattern separation marks the new memory
 * as either a positive reinforcement or an edge-case depending on
 * the delta. Without this, the prototype drifts toward whatever is
 * stored most recently even when the new memory is a boundary
 * case that should stay separately addressable.
 *
 * Layer B flag-gated: the engine only calls this when the
 * corresponding feature is turned on. Helpers remain directly
 * callable for tests and admin flows.
 */

export interface PatternSeparationInput {
  readonly db: Database.Database;
  readonly constructStmts: ConstructStatements;
  readonly userId: string;
  readonly memoryId: string;
  readonly content: string;
  readonly keywords?: readonly string[];
  /**
   * Construct ids the new memory is plausibly an exemplar of
   * (caller decides via semantic/role filtering before invoking).
   */
  readonly candidateConstructs: readonly string[];
  /** Minimum novelty score to treat as a positive exemplar. */
  readonly positiveThreshold?: number;
  /** Novelty scores below this mark it as an edge case. */
  readonly edgeCaseThreshold?: number;
}

export interface PatternSeparationOutcome {
  readonly constructMemoryId: string;
  readonly role: ExemplarRole;
  readonly noveltyScore: number;
  readonly explanation: string;
}

/**
 * Run separation for each candidate construct. Returns a decision
 * per construct; the caller persists the links so the calling
 * transaction can decide atomicity.
 */
export function classifyAsExemplar(
  input: PatternSeparationInput,
): readonly PatternSeparationOutcome[] {
  const positiveThreshold = input.positiveThreshold ?? 0.4;
  const edgeCaseThreshold = input.edgeCaseThreshold ?? 0.75;

  const outcomes: PatternSeparationOutcome[] = [];
  for (const constructId of input.candidateConstructs) {
    const novelty = computeNoveltyScore(input.db, {
      userId: input.userId,
      content: input.content,
      keywords: input.keywords,
      // Exclude the memory being classified so it does not score
      // itself as its own nearest neighbour.
      excludeMemoryId: input.memoryId,
    } satisfies NoveltyInput);

    let role: ExemplarRole;
    if (novelty.score < positiveThreshold) {
      role = 'positive';
    } else if (novelty.score >= edgeCaseThreshold) {
      role = 'edge_case';
    } else {
      role = 'positive';
    }

    outcomes.push({
      constructMemoryId: constructId,
      role,
      noveltyScore: novelty.score,
      explanation: novelty.explanation,
    });
  }
  return outcomes;
}

/**
 * Apply the outcomes from classifyAsExemplar by writing link rows
 * into construct_exemplars.
 */
export function applyPatternSeparationOutcomes(
  stmts: ConstructStatements,
  exemplarMemoryId: string,
  outcomes: readonly PatternSeparationOutcome[],
): void {
  for (const outcome of outcomes) {
    linkConstructExemplar(stmts, {
      constructMemoryId: outcome.constructMemoryId,
      exemplarMemoryId,
      exemplarRole: outcome.role,
      supportScore: outcome.noveltyScore,
    });
  }
}
