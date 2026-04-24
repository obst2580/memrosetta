import type Database from 'better-sqlite3';
import type { Memory, SearchQuery, SearchResponse, SearchResult, SearchFilters } from '@memrosetta/types';
import { rowToMemory, type MemoryRow } from './mapper.js';
import { applyContextSignatureBoost } from './context.js';

// Characters that have special meaning in FTS5 query syntax, plus common
// punctuation that should be stripped for clean token matching.
const FTS5_SPECIAL_CHARS = /["\*\(\):^{}\[\]?!.,;'\\/]/g;

// Common English stop words that add noise to FTS queries.
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'it', 'its', 'they', 'them', 'their', 'what', 'which',
  'who', 'whom', 'this', 'that', 'am', 'at', 'by', 'for', 'from',
  'in', 'into', 'of', 'on', 'to', 'with', 'and', 'but', 'or', 'nor',
  'not', 'so', 'if', 'then', 'than', 'too', 'very', 'just',
  'how', 'when', 'where', 'why', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'only',
  'own', 'same', 'about', 'up', 'out', 'off', 'over', 'under',
  'again', 'further', 'once', 'here', 'there', 'these', 'those',
  'go', 'went', 'going', 'get', 'got', 'getting',
]);

// Low-signal Korean question / request tokens that often appear in
// natural-language search prompts but rarely occur in stored memories.
const KOREAN_LOW_SIGNAL_TOKENS = new Set([
  '뭐지',
  '뭐야',
  '뭔지',
  '어디',
  '왜',
  '어떻게',
  '언제',
  '누구',
  '알려줘',
]);

/**
 * Normalize a raw user query into FTS-friendly tokens.
 *
 * - NFKC normalization to reduce unicode variants
 * - lowercase for stable matching
 * - strip punctuation / FTS syntax characters
 * - filter English stop words and low-signal Korean question tokens
 * - fall back to the full token list when every token is low-signal
 */
export function preprocessQuery(rawQuery: string): readonly string[] {
  const normalized = rawQuery
    .normalize('NFKC')
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => t.replace(FTS5_SPECIAL_CHARS, ''))
    .filter(t => t.length > 0);

  if (normalized.length === 0) {
    return [];
  }

  const meaningful = normalized.filter(
    t => !STOP_WORDS.has(t) && !KOREAN_LOW_SIGNAL_TOKENS.has(t),
  );

  return meaningful.length > 0 ? meaningful : normalized;
}

/**
 * Build an FTS5 MATCH query from a raw user query string.
 *
 * Splits by whitespace, escapes FTS5 special characters,
 * filters stop words for better relevance, wraps each token
 * in double quotes for literal matching, and joins with OR.
 *
 * If all meaningful tokens are stop words, falls back to using
 * the original tokens to avoid returning empty results.
 */
export function buildFtsQuery(rawQuery: string): string {
  const tokens = preprocessQuery(rawQuery);

  if (tokens.length === 0) return '';
  if (tokens.length === 1) return `"${tokens[0]}"`;

  // Two-token queries still benefit from precision.
  if (tokens.length === 2) {
    return tokens.map(t => `"${t}"`).join(' AND ');
  }

  // Three or more tokens come from natural-language prompts often enough
  // that OR recall is safer than forcing every token to match.
  return tokens.map(t => `"${t}"`).join(' OR ');
}

export interface SearchSqlResult {
  readonly sql: string;
  readonly params: readonly unknown[];
}

const DEFAULT_LIMIT = 20;

/**
 * Build the SQL query and parameters for a search request.
 *
 * The query joins memories with the FTS5 index and applies
 * optional filters (namespace, memoryType, dateRange, minConfidence, onlyLatest).
 * Results are ordered by BM25 rank (ascending, since BM25 scores are negative --
 * more negative means more relevant).
 */
export function buildSearchSql(query: SearchQuery): SearchSqlResult {
  const ftsQuery = buildFtsQuery(query.query);
  const params: unknown[] = [ftsQuery, query.userId];
  const whereClauses: string[] = [
    'memories_fts MATCH ?',
    'm.user_id = ?',
  ];

  if (query.namespace != null) {
    whereClauses.push('m.namespace = ?');
    params.push(query.namespace);
  }

  const filters = query.filters;

  if (filters?.memoryTypes && filters.memoryTypes.length > 0) {
    const placeholders = filters.memoryTypes.map(() => '?').join(', ');
    whereClauses.push(`m.memory_type IN (${placeholders})`);
    for (const mt of filters.memoryTypes) {
      params.push(mt);
    }
  }

  if (filters?.dateRange?.start) {
    whereClauses.push('m.document_date >= ?');
    params.push(filters.dateRange.start);
  }

  if (filters?.dateRange?.end) {
    whereClauses.push('m.document_date <= ?');
    params.push(filters.dateRange.end);
  }

  if (filters?.minConfidence != null) {
    whereClauses.push('m.confidence >= ?');
    params.push(filters.minConfidence);
  }

  // State-based filtering: `states` supersedes onlyLatest + excludeInvalidated when present.
  if (filters?.states && filters.states.length > 0) {
    const stateConditions: string[] = [];
    if (filters.states.includes('current')) {
      stateConditions.push('(m.is_latest = 1 AND m.invalidated_at IS NULL)');
    }
    if (filters.states.includes('superseded')) {
      stateConditions.push('(m.is_latest = 0 AND m.invalidated_at IS NULL)');
    }
    if (filters.states.includes('invalidated')) {
      stateConditions.push('(m.invalidated_at IS NOT NULL)');
    }
    if (stateConditions.length > 0) {
      whereClauses.push(`(${stateConditions.join(' OR ')})`);
    }
  } else {
    // Legacy behavior: onlyLatest + excludeInvalidated
    const onlyLatest = filters?.onlyLatest ?? true;
    if (onlyLatest) {
      whereClauses.push('m.is_latest = 1');
    }

    const excludeInvalidated = filters?.excludeInvalidated ?? true;
    if (excludeInvalidated) {
      whereClauses.push('m.invalidated_at IS NULL');
    }
  }

  if (filters?.eventDateRange?.start) {
    whereClauses.push('m.event_date_start >= ?');
    params.push(filters.eventDateRange.start);
  }

  if (filters?.eventDateRange?.end) {
    whereClauses.push('m.event_date_end <= ?');
    params.push(filters.eventDateRange.end);
  }

  const limit = query.limit ?? DEFAULT_LIMIT;
  params.push(limit);

  const sql = [
    'SELECT m.*, bm25(memories_fts, 1.0, 0.5) as rank',
    'FROM memories m',
    'JOIN memories_fts ON m.id = memories_fts.rowid',
    `WHERE ${whereClauses.join(' AND ')}`,
    'ORDER BY rank',
    'LIMIT ?',
  ].join('\n');

  return { sql, params };
}

/**
 * Normalize BM25 scores to a 0-1 range within a result set.
 *
 * BM25 raw scores are negative (more negative = more relevant).
 * After normalization: 1.0 = most relevant, 0.0 = least relevant.
 */
export function normalizeScores(bm25Scores: readonly number[]): readonly number[] {
  if (bm25Scores.length === 0) {
    return [];
  }

  if (bm25Scores.length === 1) {
    return [1.0];
  }

  let min = Infinity;
  let max = -Infinity;
  for (const score of bm25Scores) {
    if (score < min) min = score;
    if (score > max) max = score;
  }
  const range = max - min;

  if (range === 0) {
    return bm25Scores.map(() => 1.0);
  }

  // min (most negative) -> 1.0, max (least negative) -> 0.0
  return bm25Scores.map(score => (max - score) / range);
}

interface RankedRow extends MemoryRow {
  readonly rank: number;
}

// ---------------------------------------------------------------------------
// FTS search (extracted from searchMemories for reuse in hybrid)
// ---------------------------------------------------------------------------

/**
 * Execute FTS5 search and return ranked results.
 * This is the core FTS search logic, separated for use in both
 * standalone FTS and hybrid search modes.
 */
export function ftsSearch(
  db: Database.Database,
  query: SearchQuery,
): readonly SearchResult[] {
  const ftsQuery = buildFtsQuery(query.query);

  if (!ftsQuery) {
    return [];
  }

  const { sql, params } = buildSearchSql(query);
  const rows = db.prepare(sql).all(...params) as readonly RankedRow[];

  if (rows.length === 0) {
    return [];
  }

  const rawScores = rows.map(r => r.rank);
  const normalized = normalizeScores(rawScores);

  return rows.map((row, i) => ({
    memory: rowToMemory(row),
    score: normalized[i],
    matchType: 'fts' as const,
  }));
}


// ---------------------------------------------------------------------------
// searchMemories (main entry point)
// ---------------------------------------------------------------------------

/**
 * Apply activation weighting to search results.
 *
 * final_score = original_score * activation_weight
 * activation_weight = 0.5 + 0.5 * activationScore
 *
 * Low activation halves the score; high activation keeps it intact.
 *
 * @deprecated Use applyThreeFactorReranking instead.
 */
function applyActivationWeighting(
  results: readonly SearchResult[],
): readonly SearchResult[] {
  return results.map(r => {
    const activationWeight = 0.5 + 0.5 * r.memory.activationScore;
    return {
      ...r,
      score: r.score * activationWeight,
    };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Generative Agents-inspired 3-factor reranking.
 * final_score = w_recency * recency + w_importance * importance + w_relevance * relevance
 *
 * - recency: exponential decay from learnedAt (0.99^hours)
 * - importance: memory.salience (0-1)
 * - relevance: original search score (from FTS/vector/RRF)
 *
 * Recency is weighted 2x by default so recent memories surface first
 * when keyword relevance is similar. The decay rate of 0.99 per hour
 * means a 3-day-old memory retains ~49% and a 10-day-old ~9%,
 * providing strong but not absolute preference for freshness.
 *
 * All three are min-max normalized before combining.
 */
export function applyThreeFactorReranking(
  results: readonly SearchResult[],
  weights?: { recency?: number; importance?: number; relevance?: number },
): readonly SearchResult[] {
  if (results.length === 0) return results;

  const w = {
    recency: weights?.recency ?? 2.0,
    importance: weights?.importance ?? 1.0,
    relevance: weights?.relevance ?? 1.0,
  };

  const now = Date.now();

  const scored = results.map(r => {
    // Recency: exponential decay, 0.99^hours_since_learned
    // 1 day  = 0.99^24  ≈ 0.79
    // 3 days = 0.99^72  ≈ 0.49
    // 7 days = 0.99^168 ≈ 0.19
    // 30 days= 0.99^720 ≈ 0.0007
    const hoursSince = (now - new Date(r.memory.learnedAt).getTime()) / (1000 * 60 * 60);
    const recency = Math.pow(0.99, Math.max(0, hoursSince));

    // Importance: salience field (default 1.0)
    const importance = r.memory.salience ?? 1.0;

    // Relevance: original search score
    const relevance = r.score;

    return { ...r, recency, importance, relevance };
  });

  // Min-max normalize each factor using loop-based approach to avoid stack overflow.
  // Uses a minimum range threshold (epsilon) to prevent amplifying noise when
  // values are nearly identical (e.g., two memories stored milliseconds apart).
  const NORM_EPSILON = 0.01;
  const safeNormalize = (values: readonly number[]): readonly number[] => {
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min;
    if (range < NORM_EPSILON) return values.map(() => 1.0);
    return values.map(v => (v - min) / range);
  };

  const recencies = safeNormalize(scored.map(s => s.recency));
  const importances = safeNormalize(scored.map(s => s.importance));
  const relevances = safeNormalize(scored.map(s => s.relevance));

  return scored.map((s, i) => ({
    memory: s.memory,
    score: w.recency * recencies[i] + w.importance * importances[i] + w.relevance * relevances[i],
    matchType: s.matchType,
  })).sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Remove duplicate search results based on content identity.
 * Keeps the first (highest-scored) occurrence when duplicates exist.
 */
export function deduplicateResults(
  results: readonly SearchResult[],
): readonly SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of results) {
    const key = result.memory.content.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

// ---------------------------------------------------------------------------
// Keyword boost
// ---------------------------------------------------------------------------

/**
 * Boost scores for results whose memory keywords overlap with the query tokens.
 * Each matching keyword adds a 10% boost, capped at 50%.
 */
export function applyKeywordBoost(
  results: readonly SearchResult[],
  queryTokens: readonly string[],
): readonly SearchResult[] {
  if (queryTokens.length === 0) return results;

  const querySet = new Set(queryTokens.map(t => t.toLowerCase()));

  return results.map(result => {
    const memKeywords = (result.memory.keywords ?? []).map(k => k.toLowerCase());
    const overlap = memKeywords.filter(k => querySet.has(k)).length;

    if (overlap === 0) return result;

    // 10% boost per matching keyword, capped at 50%
    const boost = Math.min(overlap * 0.1, 0.5);

    return {
      ...result,
      score: result.score * (1 + boost),
    };
  }).sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Context-dependent retrieval boost
// ---------------------------------------------------------------------------

export interface SearchContextFilters {
  readonly project?: string;
  readonly namespace?: string;
  readonly sessionId?: string;
}

/**
 * Apply lightweight context-dependent retrieval boosts.
 *
 * The current Memory type does not yet expose every context field, so this
 * function reads the required metadata directly from SQLite. If the schema
 * has not been upgraded yet (for example, `project` does not exist), it
 * gracefully falls back to no boost.
 */
export function applyContextBoost(
  db: Database.Database,
  results: readonly SearchResult[],
  contextFilters?: SearchContextFilters,
): readonly SearchResult[] {
  if (!contextFilters || results.length === 0) {
    return results;
  }

  const hasProject = typeof contextFilters.project === 'string' && contextFilters.project.length > 0;
  const hasNamespace = typeof contextFilters.namespace === 'string' && contextFilters.namespace.length > 0;
  const hasSessionId = typeof contextFilters.sessionId === 'string' && contextFilters.sessionId.length > 0;

  if (!hasProject && !hasNamespace && !hasSessionId) {
    return results;
  }

  const ids = results.map(r => r.memory.memoryId);
  const placeholders = ids.map(() => '?').join(',');

  try {
    const rows = db.prepare(`
      SELECT memory_id, namespace, project
      FROM memories
      WHERE memory_id IN (${placeholders})
    `).all(...ids) as readonly {
      memory_id: string;
      namespace: string | null;
      project: string | null;
    }[];

    const contextById = new Map(rows.map(row => [row.memory_id, row]));

    return results.map(result => {
      const row = contextById.get(result.memory.memoryId);
      if (!row) return result;

      let boostedScore = result.score;

      if (hasProject && row.project === contextFilters.project) {
        boostedScore += 0.25;
      }
      if (hasNamespace && row.namespace === contextFilters.namespace) {
        boostedScore += 0.15;
      }
      if (hasSessionId && row.namespace === contextFilters.sessionId) {
        boostedScore += 0.10;
      }

      if (boostedScore === result.score) {
        return result;
      }

      return {
        ...result,
        score: boostedScore,
      };
    }).sort((a, b) => b.score - a.score);
  } catch {
    // Schema may not yet contain context columns (e.g. pre-v0.7.0 DB).
    return results;
  }
}

// ---------------------------------------------------------------------------
// Hebbian co-access boost
// ---------------------------------------------------------------------------

const COACCESS_WEIGHT = 0.15;
const COACCESS_SEED_COUNT = 5;

/**
 * Boost candidates that are strongly co-accessed with already top-ranked
 * seed memories. Graceful fallback when the co-access table is absent.
 */
/**
 * Spreading Activation boost (v0.8.0).
 *
 * Takes the top-5 seed results, spreads activation through the
 * explicit relation graph + co-access graph (1-2 hops), and boosts
 * any result that was reached by the spread. This surfaces memories
 * that are graph-adjacent to the top hits even if their text/vector
 * similarity was borderline.
 *
 * v0.8.0-lite: only boosts existing results. Does NOT fetch new
 * candidates from the graph — that is v0.9.0 territory.
 */
export function applySpreadingBoost(
  db: Database.Database,
  results: readonly SearchResult[],
): readonly SearchResult[] {
  if (results.length < 2) return results;

  try {
    const { spreadActivation } = require('./spreading.js') as {
      spreadActivation: (
        db: Database.Database,
        seedIds: readonly string[],
        opts?: { maxHops?: number; maxNeighborsPerHop?: number; includeCoAccess?: boolean },
      ) => ReadonlyMap<string, number>;
    };

    const seedIds = results.slice(0, 5).map((r) => r.memory.memoryId);
    const activation = spreadActivation(db, seedIds, {
      maxHops: 2,
      maxNeighborsPerHop: 10,
      includeCoAccess: true,
    });

    if (activation.size === 0) return results;

    const boosted = results.map((r) => {
      const boost = activation.get(r.memory.memoryId);
      if (boost == null || boost === 0) return r;
      return { ...r, score: r.score + boost };
    });

    return [...boosted].sort((a, b) => b.score - a.score);
  } catch {
    return results;
  }
}

export function applyCoAccessBoost(
  db: Database.Database,
  results: readonly SearchResult[],
): readonly SearchResult[] {
  if (results.length < 2) {
    return results;
  }

  const seedIds = results
    .slice(0, COACCESS_SEED_COUNT)
    .map(r => r.memory.memoryId);
  const candidateIds = results.map(r => r.memory.memoryId);

  const seedPlaceholders = seedIds.map(() => '?').join(',');
  const candidatePlaceholders = candidateIds.map(() => '?').join(',');

  try {
    const rows = db.prepare(`
      SELECT memory_a_id, memory_b_id, strength
      FROM memory_coaccess
      WHERE (
        memory_a_id IN (${seedPlaceholders})
        AND memory_b_id IN (${candidatePlaceholders})
      ) OR (
        memory_b_id IN (${seedPlaceholders})
        AND memory_a_id IN (${candidatePlaceholders})
      )
    `).all(...seedIds, ...candidateIds, ...seedIds, ...candidateIds) as readonly {
      memory_a_id: string;
      memory_b_id: string;
      strength: number | null;
    }[];

    if (rows.length === 0) {
      return results;
    }

    const seedSet = new Set(seedIds);
    const boostById = new Map<string, number>();

    for (const row of rows) {
      const strength = row.strength ?? 0;
      if (strength <= 0) continue;

      const aIsSeed = seedSet.has(row.memory_a_id);
      const bIsSeed = seedSet.has(row.memory_b_id);

      if (aIsSeed && row.memory_b_id !== row.memory_a_id) {
        boostById.set(
          row.memory_b_id,
          (boostById.get(row.memory_b_id) ?? 0) + strength * COACCESS_WEIGHT,
        );
      }
      if (bIsSeed && row.memory_a_id !== row.memory_b_id) {
        boostById.set(
          row.memory_a_id,
          (boostById.get(row.memory_a_id) ?? 0) + strength * COACCESS_WEIGHT,
        );
      }
    }

    if (boostById.size === 0) {
      return results;
    }

    return results.map(result => {
      const boost = boostById.get(result.memory.memoryId) ?? 0;
      if (boost === 0) {
        return result;
      }

      return {
        ...result,
        score: result.score + boost,
      };
    }).sort((a, b) => b.score - a.score);
  } catch {
    // Pre-v0.7.0 DBs will not have memory_coaccess.
    return results;
  }
}

/**
 * Extract meaningful tokens from a query string (same logic as buildFtsQuery).
 * Exported for use in keyword boosting.
 */
export function extractQueryTokens(rawQuery: string): readonly string[] {
  return preprocessQuery(rawQuery);
}

/**
 * Update access tracking for memories returned in search results.
 * Increments access_count and sets last_accessed_at.
 */
export function updateAccessTracking(
  db: Database.Database,
  memoryIds: readonly string[],
): void {
  if (memoryIds.length === 0) return;

  const now = new Date().toISOString();
  const stmt = db.prepare(
    'UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE memory_id = ?',
  );

  const updateAll = db.transaction((ids: readonly string[]) => {
    for (const id of ids) {
      stmt.run(now, id);
    }
  });

  updateAll(memoryIds);
}

/**
 * Execute a search against the memories table.
 *
 * When queryVec is not provided, performs FTS-only search (backward compatible).
 * When queryVec is provided, performs hybrid search combining FTS + vector
 * results via convex combination score fusion.
 *
 * Results are weighted by activation score and access tracking is updated.
 */
export function searchMemories(
  db: Database.Database,
  query: SearchQuery,
  skipAccessTracking: boolean = false,
  contextFilters?: SearchContextFilters,
): SearchResponse {
  const startTime = performance.now();

  // FTS-only path (v0.11: vector / HF embedder path removed).
  const queryTokens = extractQueryTokens(query.query);
  const ftsResults = ftsSearch(db, query);

  const weighted = applyThreeFactorReranking(ftsResults);
  const boosted = applyKeywordBoost(weighted, queryTokens);
  const contextBoosted = applyContextBoost(db, boosted, contextFilters);
  const signatureBoosted = applyContextSignatureBoost(contextBoosted, query.currentContext);
  const coAccessBoosted = applyCoAccessBoost(db, signatureBoosted);
  const spreadBoosted = applySpreadingBoost(db, coAccessBoosted);
  const finalResults = deduplicateResults(spreadBoosted);

  if (!skipAccessTracking) {
    updateAccessTracking(db, finalResults.map(r => r.memory.memoryId));
  }

  return {
    results: finalResults,
    totalCount: finalResults.length,
    queryTimeMs: performance.now() - startTime,
  };
}
