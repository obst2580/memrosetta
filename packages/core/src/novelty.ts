import type Database from 'better-sqlite3';
import type { NoveltyScore } from '@memrosetta/types';

/**
 * Novelty / Prediction Error weighting (v4 §2.3 Layer B,
 * Schultz, Dayan & Montague 1997).
 *
 * Without novelty weighting, trivial and important memories compete
 * equally during retrieval: repetition alone dominates. This helper
 * estimates how surprising a new memory is relative to existing
 * neighbours so downstream Layer B kernels (salience update,
 * replay priority, prototype induction) can prefer unexpected
 * signals over well-trodden territory.
 *
 * Keep this cheap. The heuristic relies on FTS overlap with recent
 * memories — no LLM call, no embedding diff. Layer C kernels can
 * plug a richer scoring function into the same `computeNoveltyScore`
 * interface.
 */

export interface NoveltyInput {
  readonly userId: string;
  readonly content: string;
  readonly keywords?: readonly string[];
  /** Consider only memories newer than this ISO timestamp. */
  readonly sinceIso?: string;
  /** Similarity threshold above which a neighbour counts as "close". */
  readonly similarityThreshold?: number;
  /**
   * Exclude a specific memory from the neighbour comparison. Used by
   * Pattern Separation when the new memory is already persisted and
   * needs to be scored against its siblings, not itself.
   */
  readonly excludeMemoryId?: string;
}

/**
 * Extracts a rough "token signature" by splitting on non-word chars
 * and dropping very short tokens. Intentionally language-agnostic so
 * Korean input works (morphology refinement is Step 10+ debt).
 */
function signature(text: string, extraKeywords?: readonly string[]): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[\s,.!?;:()"'\[\]{}<>/\\]+/)
    .filter((t) => t.length >= 2);
  const set = new Set(tokens);
  if (extraKeywords) {
    for (const k of extraKeywords) {
      set.add(k.toLowerCase());
    }
  }
  return set;
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

export function computeNoveltyScore(
  db: Database.Database,
  input: NoveltyInput,
): NoveltyScore {
  const threshold = input.similarityThreshold ?? 0.3;
  const sig = signature(input.content, input.keywords);
  if (sig.size === 0) {
    return { score: 1, neighborCount: 0, explanation: 'empty content' };
  }

  const params: unknown[] = [input.userId];
  let sinceClause = '';
  if (input.sinceIso) {
    sinceClause = 'AND learned_at >= ?';
    params.push(input.sinceIso);
  }
  let excludeClause = '';
  if (input.excludeMemoryId) {
    excludeClause = 'AND memory_id != ?';
    params.push(input.excludeMemoryId);
  }

  const candidates = db
    .prepare(
      `SELECT memory_id, content, keywords
       FROM memories
       WHERE user_id = ?
         AND is_latest = 1
         AND invalidated_at IS NULL
         ${sinceClause}
         ${excludeClause}
       ORDER BY learned_at DESC
       LIMIT 200`,
    )
    .all(...params) as readonly {
    memory_id: string;
    content: string;
    keywords: string | null;
  }[];

  if (candidates.length === 0) {
    return {
      score: 1,
      neighborCount: 0,
      explanation: 'no prior memories — maximally novel',
    };
  }

  let nearestDistance = 1;
  let neighborCount = 0;
  for (const c of candidates) {
    const otherSig = signature(c.content, c.keywords ? c.keywords.split(' ') : undefined);
    const sim = jaccard(sig, otherSig);
    if (sim >= threshold) neighborCount += 1;
    const distance = 1 - sim;
    if (distance < nearestDistance) nearestDistance = distance;
  }

  // Score 1 = fully novel (no overlap with anyone). 0 = duplicate of
  // a recent neighbour. Weight neighbour density in so "repeated
  // topic" drops the score even if a single neighbour is not
  // exactly identical.
  const baseScore = nearestDistance;
  const densityPenalty = Math.min(0.3, neighborCount * 0.05);
  const score = Math.max(0, Math.min(1, baseScore - densityPenalty));

  return {
    score,
    nearestDistance,
    neighborCount,
    explanation:
      neighborCount === 0
        ? 'no close neighbours'
        : `${neighborCount} close neighbour(s), nearest distance ${nearestDistance.toFixed(3)}`,
  };
}
