import type Database from 'better-sqlite3';
import type { Memory, SearchQuery, SearchResponse, SearchResult, SearchFilters } from '@memrosetta/types';
import { rowToMemory, type MemoryRow } from './mapper.js';

// Characters that have special meaning in FTS5 query syntax, plus common
// punctuation that should be stripped for clean token matching.
const FTS5_SPECIAL_CHARS = /["\*\(\):^{}\[\]?!.,;'\\]/g;

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
  const allTokens = rawQuery
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => t.replace(FTS5_SPECIAL_CHARS, ''))
    .filter(t => t.length > 0);

  if (allTokens.length === 0) {
    return '';
  }

  // Filter stop words for better relevance
  const meaningful = allTokens.filter(t => !STOP_WORDS.has(t));

  // Fall back to all tokens if every token was a stop word
  const tokens = meaningful.length > 0 ? meaningful : allTokens;

  if (tokens.length === 0) return '';
  if (tokens.length === 1) return `"${tokens[0]}"`;

  // Short queries (2-4 tokens): AND mode for higher precision
  // Long queries (5+ tokens): OR mode to avoid overly restrictive matching
  if (tokens.length <= 4) {
    return tokens.map(t => `"${t}"`).join(' AND ');
  }

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
// Vector search
// ---------------------------------------------------------------------------

export interface VectorSearchResult {
  readonly memory: Memory;
  readonly distance: number;
}

/**
 * Brute-force cosine similarity search. Used as fallback when sqlite-vec
 * is not available, or when the vector table is not loaded.
 */
export function bruteForceVectorSearch(
  db: Database.Database,
  queryVec: Float32Array,
  userId: string,
  limit: number,
  filters?: SearchFilters,
): readonly VectorSearchResult[] {
  // Build query to get all memories with embeddings for this user
  const whereClauses: string[] = ['user_id = ?', 'embedding IS NOT NULL'];
  const params: unknown[] = [userId];

  // State-based filtering: `states` supersedes onlyLatest + excludeInvalidated
  if (filters?.states && filters.states.length > 0) {
    const stateConditions: string[] = [];
    if (filters.states.includes('current')) {
      stateConditions.push('(is_latest = 1 AND invalidated_at IS NULL)');
    }
    if (filters.states.includes('superseded')) {
      stateConditions.push('(is_latest = 0 AND invalidated_at IS NULL)');
    }
    if (filters.states.includes('invalidated')) {
      stateConditions.push('(invalidated_at IS NOT NULL)');
    }
    if (stateConditions.length > 0) {
      whereClauses.push(`(${stateConditions.join(' OR ')})`);
    }
  } else {
    const onlyLatest = filters?.onlyLatest ?? true;
    if (onlyLatest) {
      whereClauses.push('is_latest = 1');
    }

    const excludeInvalidated = filters?.excludeInvalidated ?? true;
    if (excludeInvalidated) {
      whereClauses.push('invalidated_at IS NULL');
    }
  }

  if (filters?.memoryTypes && filters.memoryTypes.length > 0) {
    const mtPlaceholders = filters.memoryTypes.map(() => '?').join(',');
    whereClauses.push(`memory_type IN (${mtPlaceholders})`);
    for (const mt of filters.memoryTypes) {
      params.push(mt);
    }
  }

  if (filters?.dateRange?.start) {
    whereClauses.push('document_date >= ?');
    params.push(filters.dateRange.start);
  }

  if (filters?.dateRange?.end) {
    whereClauses.push('document_date <= ?');
    params.push(filters.dateRange.end);
  }

  if (filters?.minConfidence != null) {
    whereClauses.push('confidence >= ?');
    params.push(filters.minConfidence);
  }

  if (filters?.eventDateRange?.start) {
    whereClauses.push('event_date_start >= ?');
    params.push(filters.eventDateRange.start);
  }

  if (filters?.eventDateRange?.end) {
    whereClauses.push('event_date_end <= ?');
    params.push(filters.eventDateRange.end);
  }

  const sql = `SELECT * FROM memories WHERE ${whereClauses.join(' AND ')}`;
  const rows = db.prepare(sql).all(...params) as readonly MemoryRow[];

  if (rows.length === 0) {
    return [];
  }

  // Compute cosine similarity for each row
  const scored = rows.map(row => {
    const embBuf = row.embedding as Buffer;
    const embVec = new Float32Array(embBuf.buffer, embBuf.byteOffset, embBuf.byteLength / 4);
    const similarity = cosineSimilarity(queryVec, embVec);
    // Convert similarity to distance (lower = more similar, for consistency with sqlite-vec)
    const distance = 1 - similarity;
    return { memory: rowToMemory(row), distance };
  });

  return scored
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

/**
 * Vector search using sqlite-vec KNN query.
 * Falls back to brute-force JS cosine similarity if vec_memories table
 * is not available.
 */
export function vectorSearch(
  db: Database.Database,
  queryVec: Float32Array,
  userId: string,
  limit: number,
  filters?: SearchFilters,
  useVecTable: boolean = true,
): readonly VectorSearchResult[] {
  if (!useVecTable) {
    return bruteForceVectorSearch(db, queryVec, userId, limit, filters);
  }

  // Step 1: KNN search in vec_memories
  const candidateLimit = Math.min(limit * 5, 200);
  const vecBuf = Buffer.from(queryVec.buffer, queryVec.byteOffset, queryVec.byteLength);

  let candidates: readonly { rowid: number; distance: number }[];
  try {
    candidates = db.prepare(`
      SELECT rowid, distance
      FROM vec_memories
      WHERE embedding MATCH ?
      AND k = ?
    `).all(vecBuf, candidateLimit) as readonly { rowid: number; distance: number }[];
  } catch {
    // vec_memories table might not exist or sqlite-vec not loaded
    return bruteForceVectorSearch(db, queryVec, userId, limit, filters);
  }

  if (candidates.length === 0) return [];

  // Step 2: Get full memory rows with filters
  const rowids = candidates.map(c => c.rowid);
  const distanceMap = new Map(candidates.map(c => [c.rowid, c.distance]));

  const placeholders = rowids.map(() => '?').join(',');
  let sql = `SELECT * FROM memories WHERE id IN (${placeholders}) AND user_id = ?`;
  const params: unknown[] = [...rowids, userId];

  // State-based filtering: `states` supersedes onlyLatest + excludeInvalidated
  if (filters?.states && filters.states.length > 0) {
    const stateConditions: string[] = [];
    if (filters.states.includes('current')) {
      stateConditions.push('(is_latest = 1 AND invalidated_at IS NULL)');
    }
    if (filters.states.includes('superseded')) {
      stateConditions.push('(is_latest = 0 AND invalidated_at IS NULL)');
    }
    if (filters.states.includes('invalidated')) {
      stateConditions.push('(invalidated_at IS NOT NULL)');
    }
    if (stateConditions.length > 0) {
      sql += ` AND (${stateConditions.join(' OR ')})`;
    }
  } else {
    const onlyLatest = filters?.onlyLatest ?? true;
    if (onlyLatest) {
      sql += ' AND is_latest = 1';
    }

    const excludeInvalidated = filters?.excludeInvalidated ?? true;
    if (excludeInvalidated) {
      sql += ' AND invalidated_at IS NULL';
    }
  }

  if (filters?.memoryTypes && filters.memoryTypes.length > 0) {
    const mtPlaceholders = filters.memoryTypes.map(() => '?').join(',');
    sql += ` AND memory_type IN (${mtPlaceholders})`;
    for (const mt of filters.memoryTypes) {
      params.push(mt);
    }
  }

  if (filters?.dateRange?.start) {
    sql += ' AND document_date >= ?';
    params.push(filters.dateRange.start);
  }

  if (filters?.dateRange?.end) {
    sql += ' AND document_date <= ?';
    params.push(filters.dateRange.end);
  }

  if (filters?.minConfidence != null) {
    sql += ' AND confidence >= ?';
    params.push(filters.minConfidence);
  }

  if (filters?.eventDateRange?.start) {
    sql += ' AND event_date_start >= ?';
    params.push(filters.eventDateRange.start);
  }

  if (filters?.eventDateRange?.end) {
    sql += ' AND event_date_end <= ?';
    params.push(filters.eventDateRange.end);
  }

  const rows = db.prepare(sql).all(...params) as readonly MemoryRow[];

  return rows
    .map(row => ({
      memory: rowToMemory(row),
      distance: distanceMap.get(row.id) ?? Infinity,
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion (RRF)
// ---------------------------------------------------------------------------

/**
 * Merge FTS and vector search results using Reciprocal Rank Fusion.
 *
 * RRF score = sum over lists of 1 / (k + rank).
 * Lower k gives sharper rank discrimination; k=20 is better suited for
 * memory search with smaller result sets (5-50 items) than the web-search
 * default of 60.
 */
export function rrfMerge(
  ftsResults: readonly { readonly memory: Memory; readonly rank: number }[],
  vecResults: readonly { readonly memory: Memory; readonly rank: number }[],
  k: number = 20,
  limit: number = 10,
): readonly SearchResult[] {
  const scores = new Map<string, { score: number; memory: Memory }>();

  for (let i = 0; i < ftsResults.length; i++) {
    const item = ftsResults[i];
    const existing = scores.get(item.memory.memoryId);
    if (existing) {
      existing.score += 1 / (k + i + 1);
    } else {
      scores.set(item.memory.memoryId, {
        score: 1 / (k + i + 1),
        memory: item.memory,
      });
    }
  }

  for (let i = 0; i < vecResults.length; i++) {
    const item = vecResults[i];
    const existing = scores.get(item.memory.memoryId);
    if (existing) {
      existing.score += 1 / (k + i + 1);
    } else {
      scores.set(item.memory.memoryId, {
        score: 1 / (k + i + 1),
        memory: item.memory,
      });
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([, { score, memory }]) => ({
      memory,
      score,
      matchType: 'hybrid' as const,
    }));
}

/**
 * Weighted RRF merge: FTS results get higher weight than vector results.
 *
 * ftsWeight=2.0 means FTS rank contributes 2x more than vector rank.
 * This preserves FTS precision while allowing vector to boost semantically
 * similar results that FTS might rank lower.
 *
 * Items found by both FTS and vector get the combined score (strongest signal).
 */
export function rrfMergeWeighted(
  ftsResults: readonly { readonly memory: Memory; readonly rank: number }[],
  vecResults: readonly { readonly memory: Memory; readonly rank: number }[],
  k: number = 20,
  limit: number = 10,
  ftsWeight: number = 2.0,
  vecWeight: number = 1.0,
): readonly SearchResult[] {
  const scores = new Map<string, { score: number; memory: Memory }>();

  for (let i = 0; i < ftsResults.length; i++) {
    const item = ftsResults[i];
    const contribution = ftsWeight / (k + i + 1);
    const existing = scores.get(item.memory.memoryId);
    if (existing) {
      existing.score += contribution;
    } else {
      scores.set(item.memory.memoryId, {
        score: contribution,
        memory: item.memory,
      });
    }
  }

  for (let i = 0; i < vecResults.length; i++) {
    const item = vecResults[i];
    const contribution = vecWeight / (k + i + 1);
    const existing = scores.get(item.memory.memoryId);
    if (existing) {
      existing.score += contribution;
    } else {
      scores.set(item.memory.memoryId, {
        score: contribution,
        memory: item.memory,
      });
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([, { score, memory }]) => ({
      memory,
      score,
      matchType: 'hybrid' as const,
    }));
}

// ---------------------------------------------------------------------------
// Convex combination fusion (score-level merge)
// ---------------------------------------------------------------------------

/**
 * Score-level fusion: alpha * normalizedVecSim + (1 - alpha) * normalizedFtsSim.
 *
 * Unlike RRF (which discards score magnitude), this preserves score information.
 * Both FTS and vector scores are min-max normalized within the result set so
 * neither modality dominates due to scale differences.
 *
 * Items found by both sources get the combined score (strongest signal).
 * Items found by only one source get at most alpha or (1-alpha) of max.
 */
export function convexCombinationMerge(
  ftsResults: readonly SearchResult[],
  vecResults: readonly VectorSearchResult[],
  alpha: number = 0.5,
  limit: number = 10,
): readonly SearchResult[] {
  // Collect raw vector similarities
  const vecSims = new Map<string, { sim: number; memory: Memory }>();
  for (const vr of vecResults) {
    vecSims.set(vr.memory.memoryId, {
      sim: 1 - vr.distance,
      memory: vr.memory,
    });
  }

  // Min-max normalize vector similarities
  const vecValues = [...vecSims.values()].map(v => v.sim);
  const vecMin = vecValues.length > 0 ? Math.min(...vecValues) : 0;
  const vecMax = vecValues.length > 0 ? Math.max(...vecValues) : 1;
  const vecRange = vecMax - vecMin || 1;

  // Min-max normalize FTS scores within result set
  const ftsValues = ftsResults.map(r => r.score);
  const ftsMin = ftsValues.length > 0 ? Math.min(...ftsValues) : 0;
  const ftsMax = ftsValues.length > 0 ? Math.max(...ftsValues) : 1;
  const ftsRange = ftsMax - ftsMin || 1;

  // Merge all candidates
  const merged = new Map<string, { score: number; memory: Memory }>();

  for (const fr of ftsResults) {
    const normFts = (fr.score - ftsMin) / ftsRange;
    const vecEntry = vecSims.get(fr.memory.memoryId);
    const normVec = vecEntry ? (vecEntry.sim - vecMin) / vecRange : 0;
    const score = alpha * normVec + (1 - alpha) * normFts;
    merged.set(fr.memory.memoryId, { score, memory: fr.memory });
  }

  for (const [id, entry] of vecSims) {
    if (merged.has(id)) continue;
    const normVec = (entry.sim - vecMin) / vecRange;
    const score = alpha * normVec;
    merged.set(id, { score, memory: entry.memory });
  }

  return [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, memory }) => ({
      memory,
      score,
      matchType: 'hybrid' as const,
    }));
}

// ---------------------------------------------------------------------------
// Cosine similarity (JS fallback)
// ---------------------------------------------------------------------------

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }
  const len = a.length;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
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
 * - recency: exponential decay from learnedAt (0.995^hours)
 * - importance: memory.salience (0-1)
 * - relevance: original search score (from FTS/vector/RRF)
 *
 * All three are min-max normalized before combining.
 */
export function applyThreeFactorReranking(
  results: readonly SearchResult[],
  weights?: { recency?: number; importance?: number; relevance?: number },
): readonly SearchResult[] {
  if (results.length === 0) return results;

  const w = {
    recency: weights?.recency ?? 1.0,
    importance: weights?.importance ?? 1.0,
    relevance: weights?.relevance ?? 1.0,
  };

  const now = Date.now();

  const scored = results.map(r => {
    // Recency: exponential decay, 0.995^hours_since_learned
    const hoursSince = (now - new Date(r.memory.learnedAt).getTime()) / (1000 * 60 * 60);
    const recency = Math.pow(0.995, Math.max(0, hoursSince));

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

/**
 * Extract meaningful tokens from a query string (same logic as buildFtsQuery).
 * Exported for use in keyword boosting.
 */
export function extractQueryTokens(rawQuery: string): readonly string[] {
  const allTokens = rawQuery
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => t.replace(FTS5_SPECIAL_CHARS, ''))
    .filter(t => t.length > 0);

  const meaningful = allTokens.filter(t => !STOP_WORDS.has(t));
  return meaningful.length > 0 ? meaningful : allTokens;
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
  queryVec?: Float32Array,
  useVecTable: boolean = true,
  skipAccessTracking: boolean = false,
): SearchResponse {
  const startTime = performance.now();

  // Extract query tokens for keyword boosting
  const queryTokens = extractQueryTokens(query.query);

  // Always run FTS search
  const ftsResults = ftsSearch(db, query);

  let finalResults: readonly SearchResult[];

  // If no vector, return FTS-only results (backward compatible)
  if (!queryVec) {
    const weighted = applyThreeFactorReranking(ftsResults);
    const boosted = applyKeywordBoost(weighted, queryTokens);
    finalResults = deduplicateResults(boosted);

    // Update access tracking for returned results
    if (!skipAccessTracking) {
      updateAccessTracking(db, finalResults.map(r => r.memory.memoryId));
    }

    return {
      results: finalResults,
      totalCount: finalResults.length,
      queryTimeMs: performance.now() - startTime,
    };
  }

  // Run vector search
  const vecLimit = (query.limit ?? DEFAULT_LIMIT) * 2;
  const vecResults = vectorSearch(
    db, queryVec, query.userId, vecLimit, query.filters, useVecTable,
  );

  // If FTS returned nothing but vector returned results, use vector-only
  if (ftsResults.length === 0 && vecResults.length > 0) {
    const vecOnly: readonly SearchResult[] = vecResults
      .slice(0, query.limit ?? DEFAULT_LIMIT)
      .map(r => ({
        memory: r.memory,
        score: 1 - r.distance, // Convert distance back to similarity
        matchType: 'vector' as const,
      }));

    const weighted = applyThreeFactorReranking(vecOnly);
    const boosted = applyKeywordBoost(weighted, queryTokens);
    finalResults = deduplicateResults(boosted);
  } else if (vecResults.length === 0) {
    // If vector returned nothing, return FTS-only
    const weighted = applyThreeFactorReranking(ftsResults);
    const boosted = applyKeywordBoost(weighted, queryTokens);
    finalResults = deduplicateResults(boosted);
  } else {
    // Convex combination fusion: principled score-level merge
    const limit = query.limit ?? DEFAULT_LIMIT;
    const merged = convexCombinationMerge(ftsResults, vecResults, 0.3, limit);

    const weighted = applyThreeFactorReranking(merged);
    const boosted = applyKeywordBoost(weighted, queryTokens);
    finalResults = deduplicateResults(boosted);
  }

  // Update access tracking for returned results
  updateAccessTracking(db, finalResults.map(r => r.memory.memoryId));

  return {
    results: finalResults,
    totalCount: finalResults.length,
    queryTimeMs: performance.now() - startTime,
  };
}
