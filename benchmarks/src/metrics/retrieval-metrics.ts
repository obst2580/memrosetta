/**
 * Calculate precision at K.
 * Precision@K = (number of relevant items in top-K) / K
 */
export function precisionAtK(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number {
  const effectiveK = Math.min(k, retrieved.length);

  if (effectiveK === 0) {
    return 0;
  }

  let relevantCount = 0;
  for (let i = 0; i < effectiveK; i++) {
    if (relevant.has(retrieved[i])) {
      relevantCount++;
    }
  }

  return relevantCount / effectiveK;
}

/**
 * Calculate recall at K.
 * Recall@K = (number of relevant items in top-K) / (total relevant items)
 */
export function recallAtK(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number {
  if (relevant.size === 0) {
    return 0;
  }

  const effectiveK = Math.min(k, retrieved.length);
  let relevantCount = 0;
  for (let i = 0; i < effectiveK; i++) {
    if (relevant.has(retrieved[i])) {
      relevantCount++;
    }
  }

  return relevantCount / relevant.size;
}

/**
 * Calculate NDCG (Normalized Discounted Cumulative Gain) at K.
 * Uses binary relevance: 1 if item is in the relevant set, 0 otherwise.
 * DCG = sum(rel_i / log2(i + 2)) for i = 0..k-1 (positions are 0-indexed)
 * IDCG = ideal DCG with all relevant items placed first.
 */
export function ndcgAtK(
  retrieved: readonly string[],
  relevant: ReadonlySet<string>,
  k: number,
): number {
  const effectiveK = Math.min(k, retrieved.length);

  if (effectiveK === 0 || relevant.size === 0) {
    return 0;
  }

  // Calculate DCG
  let dcg = 0;
  let relevantInTopK = 0;
  for (let i = 0; i < effectiveK; i++) {
    const rel = relevant.has(retrieved[i]) ? 1 : 0;
    if (rel === 1) {
      relevantInTopK++;
    }
    dcg += rel / Math.log2(i + 2); // i+2 because log2(1) = 0 at position 0, so use i+2
  }

  if (dcg === 0) {
    return 0;
  }

  // Calculate IDCG: ideal ranking places all relevant items first
  const idealRelevantCount = Math.min(relevant.size, effectiveK);
  let idcg = 0;
  for (let i = 0; i < idealRelevantCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  return dcg / idcg;
}

/**
 * Calculate Mean Reciprocal Rank (MRR) across multiple queries.
 * For each query, finds the rank of the first relevant result.
 * MRR = (1/|Q|) * sum(1/rank_i)
 */
/**
 * Stale Suppression Rate: fraction of returned results that are NOT invalidated/superseded.
 * Higher is better. Measures how well search avoids returning outdated information.
 *
 * A result is considered "fresh" when isLatest is true AND invalidatedAt is absent.
 * Returns 1.0 for empty result sets (no stale results were returned).
 */
export function staleSuppression(
  results: readonly { readonly memory: { readonly invalidatedAt?: string; readonly isLatest: boolean } }[],
): number {
  if (results.length === 0) return 1.0;
  const fresh = results.filter(r => !r.memory.invalidatedAt && r.memory.isLatest);
  return fresh.length / results.length;
}

/**
 * Calculate Mean Reciprocal Rank (MRR) across multiple queries.
 * For each query, finds the rank of the first relevant result.
 * MRR = (1/|Q|) * sum(1/rank_i)
 */
export function mrr(
  retrievedPerQuery: readonly (readonly string[])[],
  relevantPerQuery: readonly ReadonlySet<string>[],
): number {
  if (retrievedPerQuery.length === 0) {
    return 0;
  }

  let totalReciprocalRank = 0;

  for (let q = 0; q < retrievedPerQuery.length; q++) {
    const retrieved = retrievedPerQuery[q];
    const relevant = relevantPerQuery[q];

    for (let i = 0; i < retrieved.length; i++) {
      if (relevant.has(retrieved[i])) {
        totalReciprocalRank += 1 / (i + 1);
        break;
      }
    }
  }

  return totalReciprocalRank / retrievedPerQuery.length;
}
