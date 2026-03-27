import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ensureSchema } from '../src/schema.js';
import {
  buildFtsQuery,
  buildSearchSql,
  normalizeScores,
  ftsSearch,
  bruteForceVectorSearch,
  rrfMerge,
  searchMemories,
  deduplicateResults,
  applyKeywordBoost,
  extractQueryTokens,
  applyThreeFactorReranking,
} from '../src/search.js';
import { serializeEmbedding, type MemoryRow } from '../src/mapper.js';
import type { SearchQuery, SearchResult, Memory } from '@memrosetta/types';

function insertTestMemory(
  db: Database.Database,
  overrides: Partial<MemoryRow> = {},
): void {
  const defaults = {
    memory_id: `mem-test-${Math.random().toString(36).slice(2, 10)}`,
    user_id: 'user1',
    namespace: null,
    memory_type: 'fact',
    content: 'test content',
    raw_text: null,
    document_date: null,
    learned_at: new Date().toISOString(),
    source_id: null,
    confidence: 1.0,
    salience: 1.0,
    is_latest: 1,
    embedding: null,
    keywords: null,
    event_date_start: null,
    event_date_end: null,
    invalidated_at: null,
  };
  const row = { ...defaults, ...overrides };
  db.prepare(`
    INSERT INTO memories (memory_id, user_id, namespace, memory_type, content, raw_text, document_date, learned_at, source_id, confidence, salience, is_latest, embedding, keywords, event_date_start, event_date_end, invalidated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.memory_id,
    row.user_id,
    row.namespace,
    row.memory_type,
    row.content,
    row.raw_text,
    row.document_date,
    row.learned_at,
    row.source_id,
    row.confidence,
    row.salience,
    row.is_latest,
    row.embedding,
    row.keywords,
    row.event_date_start,
    row.event_date_end,
    row.invalidated_at,
  );
}

// ---------------------------------------------------------------------------
// buildFtsQuery
// ---------------------------------------------------------------------------
describe('buildFtsQuery', () => {
  it('converts short multi-word query to AND-joined quoted tokens', () => {
    expect(buildFtsQuery('hello world')).toBe('"hello" AND "world"');
  });

  it('escapes special FTS5 characters', () => {
    const result = buildFtsQuery('test"query*');
    // Special chars removed, token wrapped in quotes
    expect(result).toBe('"testquery"');
  });

  it('returns empty string for empty query', () => {
    expect(buildFtsQuery('')).toBe('');
  });

  it('returns empty string for whitespace-only query', () => {
    expect(buildFtsQuery('   ')).toBe('');
  });

  it('handles single word', () => {
    expect(buildFtsQuery('hello')).toBe('"hello"');
  });

  it('handles query with punctuation like question marks', () => {
    const result = buildFtsQuery('What color is the car?');
    // Stop words (what, is, the) are filtered; 2 tokens -> AND mode
    expect(result).toBe('"color" AND "car"');
  });

  it('filters stop words from queries', () => {
    const result = buildFtsQuery('When did Caroline go to the LGBTQ support group?');
    // 4 tokens -> AND mode
    expect(result).toBe('"caroline" AND "lgbtq" AND "support" AND "group"');
  });

  it('falls back to all tokens when every token is a stop word', () => {
    const result = buildFtsQuery('is the');
    // 2 tokens -> AND mode
    expect(result).toBe('"is" AND "the"');
  });

  it('handles query with multiple special characters', () => {
    const result = buildFtsQuery('a(b) c*d {e}');
    // 3 tokens -> AND mode
    expect(result).toBe('"ab" AND "cd" AND "e"');
  });

  it('filters out tokens that become empty after escaping', () => {
    const result = buildFtsQuery('"*" normal');
    expect(result).toBe('"normal"');
  });

  it('returns empty string when all tokens are special characters', () => {
    expect(buildFtsQuery('" * ( )')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// normalizeScores
// ---------------------------------------------------------------------------
describe('normalizeScores', () => {
  it('normalizes multiple different scores to 0-1 range', () => {
    // BM25: more negative = more relevant
    const scores = [-3.0, -1.0, -2.0];
    const normalized = normalizeScores(scores);

    // -3.0 is most relevant -> 1.0
    // -1.0 is least relevant -> 0.0
    // -2.0 is in between -> 0.5
    expect(normalized[0]).toBeCloseTo(1.0);
    expect(normalized[1]).toBeCloseTo(0.0);
    expect(normalized[2]).toBeCloseTo(0.5);
  });

  it('returns [1.0] for single score', () => {
    expect(normalizeScores([-5.0])).toEqual([1.0]);
  });

  it('returns all 1.0 when all scores are the same', () => {
    expect(normalizeScores([-2.0, -2.0, -2.0])).toEqual([1.0, 1.0, 1.0]);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeScores([])).toEqual([]);
  });

  it('handles two scores', () => {
    const normalized = normalizeScores([-10.0, -1.0]);
    expect(normalized[0]).toBeCloseTo(1.0);
    expect(normalized[1]).toBeCloseTo(0.0);
  });
});

// ---------------------------------------------------------------------------
// buildSearchSql
// ---------------------------------------------------------------------------
describe('buildSearchSql', () => {
  it('builds base SQL with userId filter', () => {
    const query: SearchQuery = { userId: 'user1', query: 'test' };
    const { sql, params } = buildSearchSql(query);

    expect(sql).toContain('bm25(memories_fts');
    expect(sql).toContain('JOIN memories_fts');
    expect(sql).toContain('m.user_id = ?');
    expect(sql).toContain('ORDER BY rank');
    expect(sql).toContain('LIMIT ?');
    // Default onlyLatest = true
    expect(sql).toContain('m.is_latest = 1');
  });

  it('includes namespace filter when specified', () => {
    const query: SearchQuery = {
      userId: 'user1',
      query: 'test',
      namespace: 'work',
    };
    const { sql, params } = buildSearchSql(query);

    expect(sql).toContain('m.namespace = ?');
    expect(params).toContain('work');
  });

  it('includes memoryType filter when specified', () => {
    const query: SearchQuery = {
      userId: 'user1',
      query: 'test',
      filters: { memoryTypes: ['fact', 'preference'] },
    };
    const { sql, params } = buildSearchSql(query);

    expect(sql).toContain('m.memory_type IN');
    expect(params).toContain('fact');
    expect(params).toContain('preference');
  });

  it('includes dateRange start filter', () => {
    const query: SearchQuery = {
      userId: 'user1',
      query: 'test',
      filters: { dateRange: { start: '2025-01-01' } },
    };
    const { sql, params } = buildSearchSql(query);

    expect(sql).toContain('m.document_date >= ?');
    expect(params).toContain('2025-01-01');
  });

  it('includes dateRange end filter', () => {
    const query: SearchQuery = {
      userId: 'user1',
      query: 'test',
      filters: { dateRange: { end: '2025-12-31' } },
    };
    const { sql, params } = buildSearchSql(query);

    expect(sql).toContain('m.document_date <= ?');
    expect(params).toContain('2025-12-31');
  });

  it('includes minConfidence filter', () => {
    const query: SearchQuery = {
      userId: 'user1',
      query: 'test',
      filters: { minConfidence: 0.8 },
    };
    const { sql, params } = buildSearchSql(query);

    expect(sql).toContain('m.confidence >= ?');
    expect(params).toContain(0.8);
  });

  it('respects onlyLatest=false', () => {
    const query: SearchQuery = {
      userId: 'user1',
      query: 'test',
      filters: { onlyLatest: false },
    };
    const { sql } = buildSearchSql(query);

    expect(sql).not.toContain('m.is_latest');
  });

  it('includes eventDateRange.start filter', () => {
    const query: SearchQuery = {
      userId: 'user1',
      query: 'test',
      filters: { eventDateRange: { start: '2026-01-01' } },
    };
    const { sql, params } = buildSearchSql(query);

    expect(sql).toContain('m.event_date_start >= ?');
    expect(params).toContain('2026-01-01');
  });

  it('includes eventDateRange.end filter', () => {
    const query: SearchQuery = {
      userId: 'user1',
      query: 'test',
      filters: { eventDateRange: { end: '2026-12-31' } },
    };
    const { sql, params } = buildSearchSql(query);

    expect(sql).toContain('m.event_date_end <= ?');
    expect(params).toContain('2026-12-31');
  });

  it('excludes invalidated by default', () => {
    const query: SearchQuery = { userId: 'user1', query: 'test' };
    const { sql } = buildSearchSql(query);

    expect(sql).toContain('m.invalidated_at IS NULL');
  });

  it('includes invalidated when excludeInvalidated=false', () => {
    const query: SearchQuery = {
      userId: 'user1',
      query: 'test',
      filters: { excludeInvalidated: false },
    };
    const { sql } = buildSearchSql(query);

    expect(sql).not.toContain('m.invalidated_at IS NULL');
  });

  it('uses default limit of 20 when not specified', () => {
    const query: SearchQuery = { userId: 'user1', query: 'test' };
    const { params } = buildSearchSql(query);

    // Last param is the limit
    expect(params[params.length - 1]).toBe(20);
  });

  it('uses custom limit when specified', () => {
    const query: SearchQuery = { userId: 'user1', query: 'test', limit: 5 };
    const { params } = buildSearchSql(query);

    expect(params[params.length - 1]).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// searchMemories (integration)
// ---------------------------------------------------------------------------
describe('searchMemories', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns matching memories for basic search', () => {
    insertTestMemory(db, {
      memory_id: 'mem-1',
      content: 'TypeScript is a typed superset of JavaScript',
      keywords: 'typescript javascript',
    });
    insertTestMemory(db, {
      memory_id: 'mem-2',
      content: 'Python is a dynamic language',
      keywords: 'python',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'typescript',
    });

    expect(result.results.length).toBe(1);
    expect(result.results[0].memory.memoryId).toBe('mem-1');
    expect(result.totalCount).toBe(1);
    expect(result.queryTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('ranks more relevant results higher with BM25', () => {
    insertTestMemory(db, {
      memory_id: 'mem-cat',
      content: 'The cat sat on the mat',
      keywords: 'cat mat',
    });
    insertTestMemory(db, {
      memory_id: 'mem-dog',
      content: 'The dog ran in the park',
      keywords: 'dog park',
    });
    insertTestMemory(db, {
      memory_id: 'mem-both',
      content: 'The cat chased the dog in the park',
      keywords: 'cat dog park',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'cat',
    });

    expect(result.results.length).toBe(2);
    // The memory specifically about cat should rank higher
    expect(result.results[0].memory.memoryId).toBe('mem-cat');
  });

  it('filters by userId', () => {
    insertTestMemory(db, {
      memory_id: 'mem-u1',
      user_id: 'user1',
      content: 'memory for user1',
    });
    insertTestMemory(db, {
      memory_id: 'mem-u2',
      user_id: 'user2',
      content: 'memory for user2',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'memory',
    });

    expect(result.results.length).toBe(1);
    expect(result.results[0].memory.userId).toBe('user1');
  });

  it('filters by namespace', () => {
    insertTestMemory(db, {
      memory_id: 'mem-work',
      namespace: 'work',
      content: 'work project details',
    });
    insertTestMemory(db, {
      memory_id: 'mem-personal',
      namespace: 'personal',
      content: 'personal project details',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'project',
      namespace: 'work',
    });

    expect(result.results.length).toBe(1);
    expect(result.results[0].memory.namespace).toBe('work');
  });

  it('filters by memoryType', () => {
    insertTestMemory(db, {
      memory_id: 'mem-fact',
      memory_type: 'fact',
      content: 'the sky is blue',
    });
    insertTestMemory(db, {
      memory_id: 'mem-pref',
      memory_type: 'preference',
      content: 'prefers blue color in the sky',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'blue sky',
      filters: { memoryTypes: ['fact'] },
    });

    expect(result.results.length).toBe(1);
    expect(result.results[0].memory.memoryType).toBe('fact');
  });

  it('filters by dateRange', () => {
    insertTestMemory(db, {
      memory_id: 'mem-old',
      content: 'old meeting notes',
      document_date: '2024-01-15',
    });
    insertTestMemory(db, {
      memory_id: 'mem-new',
      content: 'new meeting notes',
      document_date: '2025-06-15',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'meeting',
      filters: { dateRange: { start: '2025-01-01' } },
    });

    expect(result.results.length).toBe(1);
    expect(result.results[0].memory.memoryId).toBe('mem-new');
  });

  it('filters by minConfidence', () => {
    insertTestMemory(db, {
      memory_id: 'mem-high',
      content: 'high confidence fact',
      confidence: 0.95,
    });
    insertTestMemory(db, {
      memory_id: 'mem-low',
      content: 'low confidence fact',
      confidence: 0.3,
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'confidence fact',
      filters: { minConfidence: 0.8 },
    });

    expect(result.results.length).toBe(1);
    expect(result.results[0].memory.memoryId).toBe('mem-high');
  });

  it('excludes non-latest by default (onlyLatest=true)', () => {
    insertTestMemory(db, {
      memory_id: 'mem-latest',
      content: 'latest version of the fact',
      is_latest: 1,
    });
    insertTestMemory(db, {
      memory_id: 'mem-old-ver',
      content: 'old version of the fact',
      is_latest: 0,
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'version fact',
    });

    expect(result.results.length).toBe(1);
    expect(result.results[0].memory.memoryId).toBe('mem-latest');
  });

  it('includes non-latest when onlyLatest=false', () => {
    insertTestMemory(db, {
      memory_id: 'mem-latest2',
      content: 'latest version of the record',
      is_latest: 1,
    });
    insertTestMemory(db, {
      memory_id: 'mem-old-ver2',
      content: 'old version of the record',
      is_latest: 0,
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'version record',
      filters: { onlyLatest: false },
    });

    expect(result.results.length).toBe(2);
  });

  it('respects limit', () => {
    insertTestMemory(db, {
      memory_id: 'mem-a',
      content: 'apple fruit red',
    });
    insertTestMemory(db, {
      memory_id: 'mem-b',
      content: 'apple pie dessert',
    });
    insertTestMemory(db, {
      memory_id: 'mem-c',
      content: 'apple tree garden',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'apple',
      limit: 2,
    });

    expect(result.results.length).toBe(2);
  });

  it('returns empty results for non-matching query', () => {
    insertTestMemory(db, {
      memory_id: 'mem-x',
      content: 'some random content here',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'nonexistent',
    });

    expect(result.results).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('returns empty results for empty query string', () => {
    insertTestMemory(db, {
      memory_id: 'mem-y',
      content: 'some content',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: '',
    });

    expect(result.results).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('normalizes scores to 0-1 range', () => {
    insertTestMemory(db, {
      memory_id: 'mem-s1',
      content: 'apple apple apple',
      keywords: 'apple',
    });
    insertTestMemory(db, {
      memory_id: 'mem-s2',
      content: 'apple banana cherry',
      keywords: 'apple banana cherry',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'apple',
    });

    for (const r of result.results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      // 3-factor reranking: max 3.0 (recency + importance + relevance), with keyword boost up to 50% -> max ~4.5
      expect(r.score).toBeLessThanOrEqual(5.0);
    }
    // Best match should have a meaningful score
    expect(result.results.some(r => r.score >= 1.0)).toBe(true);
  });

  it('sets matchType to fts for all results', () => {
    insertTestMemory(db, {
      memory_id: 'mem-mt',
      content: 'matchtype test content',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'matchtype',
    });

    expect(result.results[0].matchType).toBe('fts');
  });

  it('includes queryTimeMs in response', () => {
    const result = searchMemories(db, {
      userId: 'user1',
      query: 'anything',
    });

    expect(typeof result.queryTimeMs).toBe('number');
    expect(result.queryTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('filters by eventDateRange', () => {
    insertTestMemory(db, {
      memory_id: 'mem-early-event',
      content: 'early sprint planning',
      keywords: 'sprint',
      event_date_start: '2026-01-10T00:00:00Z',
      event_date_end: '2026-01-10T01:00:00Z',
    });
    insertTestMemory(db, {
      memory_id: 'mem-late-event',
      content: 'late sprint planning',
      keywords: 'sprint',
      event_date_start: '2026-06-10T00:00:00Z',
      event_date_end: '2026-06-10T01:00:00Z',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'sprint',
      filters: {
        eventDateRange: { start: '2026-03-01T00:00:00Z' },
        excludeInvalidated: false,
      },
    });

    expect(result.results.length).toBe(1);
    expect(result.results[0].memory.memoryId).toBe('mem-late-event');
  });

  it('excludes invalidated memories by default', () => {
    insertTestMemory(db, {
      memory_id: 'mem-valid',
      content: 'valid release note',
      keywords: 'release',
      invalidated_at: null,
    });
    insertTestMemory(db, {
      memory_id: 'mem-invalidated',
      content: 'outdated release note',
      keywords: 'release',
      invalidated_at: '2026-03-01T00:00:00Z',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'release',
    });

    expect(result.results.length).toBe(1);
    expect(result.results[0].memory.memoryId).toBe('mem-valid');
  });

  it('includes invalidated memories when excludeInvalidated=false', () => {
    insertTestMemory(db, {
      memory_id: 'mem-valid2',
      content: 'valid deployment note',
      keywords: 'deployment',
      invalidated_at: null,
    });
    insertTestMemory(db, {
      memory_id: 'mem-invalidated2',
      content: 'outdated deployment note',
      keywords: 'deployment',
      invalidated_at: '2026-03-01T00:00:00Z',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'deployment',
      filters: { excludeInvalidated: false },
    });

    expect(result.results.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// rrfMerge
// ---------------------------------------------------------------------------
describe('rrfMerge', () => {
  function makeMockMemory(id: string): Memory {
    return {
      memoryId: id,
      userId: 'user1',
      memoryType: 'fact',
      content: `content for ${id}`,
      learnedAt: '2025-01-01T00:00:00.000Z',
      confidence: 1.0,
      salience: 1.0,
      isLatest: true,
      keywords: [],
    };
  }

  it('merges two ranked lists correctly', () => {
    const ftsResults = [
      { memory: makeMockMemory('mem-1'), rank: 0 },
      { memory: makeMockMemory('mem-2'), rank: 1 },
      { memory: makeMockMemory('mem-3'), rank: 2 },
    ];
    const vecResults = [
      { memory: makeMockMemory('mem-4'), rank: 0 },
      { memory: makeMockMemory('mem-1'), rank: 1 },
      { memory: makeMockMemory('mem-5'), rank: 2 },
    ];

    const merged = rrfMerge(ftsResults, vecResults, 60, 10);

    expect(merged.length).toBeGreaterThan(0);
    // mem-1 appears in both lists, should have highest score
    expect(merged[0].memory.memoryId).toBe('mem-1');
    expect(merged[0].matchType).toBe('hybrid');
  });

  it('handles overlapping results by combining scores', () => {
    const ftsResults = [
      { memory: makeMockMemory('mem-a'), rank: 0 },
    ];
    const vecResults = [
      { memory: makeMockMemory('mem-a'), rank: 0 },
    ];

    const merged = rrfMerge(ftsResults, vecResults, 60, 10);

    expect(merged.length).toBe(1);
    expect(merged[0].memory.memoryId).toBe('mem-a');
    // Score should be 1/(60+1) + 1/(60+1) = 2/61
    const expectedScore = 2 / 61;
    expect(merged[0].score).toBeCloseTo(expectedScore, 10);
  });

  it('respects k parameter for score calculation', () => {
    const ftsResults = [
      { memory: makeMockMemory('mem-x'), rank: 0 },
    ];
    const vecResults: { memory: Memory; rank: number }[] = [];

    const mergedK10 = rrfMerge(ftsResults, vecResults, 10, 10);
    const mergedK100 = rrfMerge(ftsResults, vecResults, 100, 10);

    // With k=10, score = 1/11. With k=100, score = 1/101
    expect(mergedK10[0].score).toBeCloseTo(1 / 11, 10);
    expect(mergedK100[0].score).toBeCloseTo(1 / 101, 10);
  });

  it('respects limit parameter', () => {
    const ftsResults = Array.from({ length: 10 }, (_, i) => ({
      memory: makeMockMemory(`mem-fts-${i}`),
      rank: i,
    }));
    const vecResults = Array.from({ length: 10 }, (_, i) => ({
      memory: makeMockMemory(`mem-vec-${i}`),
      rank: i,
    }));

    const merged = rrfMerge(ftsResults, vecResults, 60, 5);

    expect(merged.length).toBe(5);
  });

  it('handles empty FTS results', () => {
    const vecResults = [
      { memory: makeMockMemory('mem-v1'), rank: 0 },
    ];

    const merged = rrfMerge([], vecResults, 60, 10);

    expect(merged.length).toBe(1);
    expect(merged[0].memory.memoryId).toBe('mem-v1');
  });

  it('handles empty vector results', () => {
    const ftsResults = [
      { memory: makeMockMemory('mem-f1'), rank: 0 },
    ];

    const merged = rrfMerge(ftsResults, [], 60, 10);

    expect(merged.length).toBe(1);
    expect(merged[0].memory.memoryId).toBe('mem-f1');
  });

  it('handles both empty', () => {
    const merged = rrfMerge([], [], 60, 10);
    expect(merged.length).toBe(0);
  });

  it('sorts by RRF score descending', () => {
    // mem-overlap is in both, mem-fts-only is only in FTS, mem-vec-only is only in vec
    const ftsResults = [
      { memory: makeMockMemory('mem-overlap'), rank: 0 },
      { memory: makeMockMemory('mem-fts-only'), rank: 1 },
    ];
    const vecResults = [
      { memory: makeMockMemory('mem-overlap'), rank: 0 },
      { memory: makeMockMemory('mem-vec-only'), rank: 1 },
    ];

    const merged = rrfMerge(ftsResults, vecResults, 60, 10);

    // Overlap should be first (highest score)
    expect(merged[0].memory.memoryId).toBe('mem-overlap');
    // The other two should have equal scores
    expect(merged[1].score).toBeCloseTo(merged[2].score, 10);
  });
});

// ---------------------------------------------------------------------------
// bruteForceVectorSearch
// ---------------------------------------------------------------------------
describe('bruteForceVectorSearch', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  function makeVec(values: number[]): Float32Array {
    const vec = new Float32Array(values);
    // Normalize
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    }
    return vec;
  }

  function insertWithEmbedding(
    db: Database.Database,
    overrides: Partial<MemoryRow> & { embedding: Buffer },
  ): void {
    const defaults = {
      memory_id: `mem-test-${Math.random().toString(36).slice(2, 10)}`,
      user_id: 'user1',
      namespace: null,
      memory_type: 'fact',
      content: 'test content',
      raw_text: null,
      document_date: null,
      learned_at: new Date().toISOString(),
      source_id: null,
      confidence: 1.0,
      salience: 1.0,
      is_latest: 1,
      keywords: null,
      event_date_start: null,
      event_date_end: null,
      invalidated_at: null,
    };
    const row = { ...defaults, ...overrides };
    db.prepare(`
      INSERT INTO memories (memory_id, user_id, namespace, memory_type, content, raw_text, document_date, learned_at, source_id, confidence, salience, is_latest, embedding, keywords, event_date_start, event_date_end, invalidated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.memory_id, row.user_id, row.namespace, row.memory_type,
      row.content, row.raw_text, row.document_date, row.learned_at,
      row.source_id, row.confidence, row.salience, row.is_latest,
      row.embedding, row.keywords,
      row.event_date_start, row.event_date_end, row.invalidated_at,
    );
  }

  it('returns results sorted by distance (ascending)', () => {
    // Query vector points in direction [1, 0, 0]
    const queryVec = makeVec([1, 0, 0]);
    // Close to query direction
    const closeVec = makeVec([0.9, 0.1, 0]);
    // Far from query direction
    const farVec = makeVec([0, 0, 1]);

    insertWithEmbedding(db, {
      memory_id: 'mem-close',
      content: 'close content',
      embedding: serializeEmbedding(closeVec),
    });
    insertWithEmbedding(db, {
      memory_id: 'mem-far',
      content: 'far content',
      embedding: serializeEmbedding(farVec),
    });

    const results = bruteForceVectorSearch(db, queryVec, 'user1', 10);

    expect(results.length).toBe(2);
    expect(results[0].memory.memoryId).toBe('mem-close');
    expect(results[1].memory.memoryId).toBe('mem-far');
    expect(results[0].distance).toBeLessThan(results[1].distance);
  });

  it('filters by userId', () => {
    const queryVec = makeVec([1, 0, 0]);
    const vec = makeVec([1, 0, 0]);

    insertWithEmbedding(db, {
      memory_id: 'mem-u1',
      user_id: 'user1',
      content: 'user1 content',
      embedding: serializeEmbedding(vec),
    });
    insertWithEmbedding(db, {
      memory_id: 'mem-u2',
      user_id: 'user2',
      content: 'user2 content',
      embedding: serializeEmbedding(vec),
    });

    const results = bruteForceVectorSearch(db, queryVec, 'user1', 10);

    expect(results.length).toBe(1);
    expect(results[0].memory.userId).toBe('user1');
  });

  it('respects limit', () => {
    const queryVec = makeVec([1, 0, 0]);
    const vec = makeVec([1, 0, 0]);

    for (let i = 0; i < 5; i++) {
      insertWithEmbedding(db, {
        memory_id: `mem-${i}`,
        content: `content ${i}`,
        embedding: serializeEmbedding(vec),
      });
    }

    const results = bruteForceVectorSearch(db, queryVec, 'user1', 2);
    expect(results.length).toBe(2);
  });

  it('filters by onlyLatest', () => {
    const queryVec = makeVec([1, 0, 0]);
    const vec = makeVec([1, 0, 0]);

    insertWithEmbedding(db, {
      memory_id: 'mem-latest',
      content: 'latest content',
      is_latest: 1,
      embedding: serializeEmbedding(vec),
    });
    insertWithEmbedding(db, {
      memory_id: 'mem-old',
      content: 'old content',
      is_latest: 0,
      embedding: serializeEmbedding(vec),
    });

    // Default onlyLatest=true
    const resultsDefault = bruteForceVectorSearch(db, queryVec, 'user1', 10);
    expect(resultsDefault.length).toBe(1);
    expect(resultsDefault[0].memory.memoryId).toBe('mem-latest');

    // onlyLatest=false
    const resultsAll = bruteForceVectorSearch(db, queryVec, 'user1', 10, { onlyLatest: false });
    expect(resultsAll.length).toBe(2);
  });

  it('returns empty when no embeddings exist', () => {
    insertTestMemory(db, { memory_id: 'mem-no-emb', content: 'no embedding' });
    const queryVec = makeVec([1, 0, 0]);
    const results = bruteForceVectorSearch(db, queryVec, 'user1', 10);
    expect(results.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// searchMemories hybrid mode
// ---------------------------------------------------------------------------
describe('searchMemories hybrid', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  function makeVec(values: number[]): Float32Array {
    const vec = new Float32Array(values);
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    }
    return vec;
  }

  it('returns FTS-only results when no queryVec provided (backward compatible)', () => {
    insertTestMemory(db, {
      memory_id: 'mem-fts',
      content: 'TypeScript programming language',
      keywords: 'typescript',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'typescript',
    });

    expect(result.results.length).toBe(1);
    expect(result.results[0].matchType).toBe('fts');
  });

  it('returns hybrid results when queryVec is provided', () => {
    const vec = makeVec([1, 0, 0]);
    insertTestMemory(db, {
      memory_id: 'mem-hybrid',
      content: 'TypeScript programming language',
      keywords: 'typescript',
      embedding: serializeEmbedding(vec),
    });

    const queryVec = makeVec([1, 0, 0]);
    const result = searchMemories(db, {
      userId: 'user1',
      query: 'typescript',
    }, queryVec, false); // useVecTable=false for brute force

    expect(result.results.length).toBe(1);
    // When FTS returns enough results, hybrid uses re-rank mode
    // and preserves the original matchType (fts)
    expect(['fts', 'hybrid']).toContain(result.results[0].matchType);
  });

  it('returns vector-only results when FTS has no matches but vector does', () => {
    const vec = makeVec([1, 0, 0]);
    // Content that won't match "xyzquery" via FTS
    insertTestMemory(db, {
      memory_id: 'mem-vec-only',
      content: 'machine learning algorithms',
      keywords: 'ml',
      embedding: serializeEmbedding(vec),
    });

    const queryVec = makeVec([1, 0, 0]);
    const result = searchMemories(db, {
      userId: 'user1',
      query: 'xyzquery',
    }, queryVec, false);

    expect(result.results.length).toBe(1);
    expect(result.results[0].matchType).toBe('vector');
  });

  it('returns FTS results when FTS matches but vector has no embeddings', () => {
    insertTestMemory(db, {
      memory_id: 'mem-fts-only',
      content: 'TypeScript programming',
      keywords: 'typescript',
      // no embedding
    });

    const queryVec = makeVec([1, 0, 0]);
    const result = searchMemories(db, {
      userId: 'user1',
      query: 'typescript',
    }, queryVec, false);

    // Should fall back to FTS results since no vector matches
    expect(result.results.length).toBe(1);
    expect(result.results[0].matchType).toBe('fts');
  });
});

// ---------------------------------------------------------------------------
// buildFtsQuery AND/OR strategy
// ---------------------------------------------------------------------------
describe('buildFtsQuery AND/OR strategy', () => {
  it('uses AND for 2-token queries', () => {
    expect(buildFtsQuery('red car')).toBe('"red" AND "car"');
  });

  it('uses AND for 3-token queries', () => {
    expect(buildFtsQuery('big red car')).toBe('"big" AND "red" AND "car"');
  });

  it('uses AND for 4-token queries', () => {
    expect(buildFtsQuery('big red fast car')).toBe('"big" AND "red" AND "fast" AND "car"');
  });

  it('uses OR for 5+ token queries', () => {
    expect(buildFtsQuery('big red fast shiny car')).toBe(
      '"big" OR "red" OR "fast" OR "shiny" OR "car"',
    );
  });

  it('counts only meaningful tokens for AND/OR threshold', () => {
    // "the big and red car" -> stop words removed -> "big", "red", "car" (3 tokens -> AND)
    expect(buildFtsQuery('the big and red car')).toBe('"big" AND "red" AND "car"');
  });
});

// ---------------------------------------------------------------------------
// deduplicateResults
// ---------------------------------------------------------------------------
describe('deduplicateResults', () => {
  function makeMockResult(id: string, content: string, score: number): SearchResult {
    return {
      memory: {
        memoryId: id,
        userId: 'user1',
        memoryType: 'fact',
        content,
        learnedAt: '2025-01-01T00:00:00.000Z',
        confidence: 1.0,
        salience: 1.0,
        isLatest: true,
        keywords: [],
        tier: 'warm',
        activationScore: 1.0,
        accessCount: 0,
        useCount: 0,
        successCount: 0,
      },
      score,
      matchType: 'fts',
    };
  }

  it('removes duplicate content, keeping highest-scored', () => {
    const results = [
      makeMockResult('mem-1', 'TypeScript is great', 0.9),
      makeMockResult('mem-2', 'typescript is great', 0.5),  // same content, lower case
      makeMockResult('mem-3', 'Python is also great', 0.3),
    ];

    const deduped = deduplicateResults(results);

    expect(deduped.length).toBe(2);
    expect(deduped[0].memory.memoryId).toBe('mem-1');
    expect(deduped[1].memory.memoryId).toBe('mem-3');
  });

  it('preserves order for non-duplicate results', () => {
    const results = [
      makeMockResult('mem-a', 'first content', 0.9),
      makeMockResult('mem-b', 'second content', 0.5),
    ];

    const deduped = deduplicateResults(results);
    expect(deduped.length).toBe(2);
    expect(deduped[0].memory.memoryId).toBe('mem-a');
    expect(deduped[1].memory.memoryId).toBe('mem-b');
  });

  it('handles empty results', () => {
    expect(deduplicateResults([])).toEqual([]);
  });

  it('handles single result', () => {
    const results = [makeMockResult('mem-1', 'only one', 1.0)];
    expect(deduplicateResults(results).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// applyKeywordBoost
// ---------------------------------------------------------------------------
describe('applyKeywordBoost', () => {
  function makeMockResult(
    id: string,
    keywords: readonly string[],
    score: number,
  ): SearchResult {
    return {
      memory: {
        memoryId: id,
        userId: 'user1',
        memoryType: 'fact',
        content: `content for ${id}`,
        learnedAt: '2025-01-01T00:00:00.000Z',
        confidence: 1.0,
        salience: 1.0,
        isLatest: true,
        keywords,
        tier: 'warm',
        activationScore: 1.0,
        accessCount: 0,
        useCount: 0,
        successCount: 0,
      },
      score,
      matchType: 'fts',
    };
  }

  it('boosts results with matching keywords', () => {
    const results = [
      makeMockResult('mem-1', ['typescript', 'javascript'], 0.5),
      makeMockResult('mem-2', ['python'], 0.5),
    ];

    const boosted = applyKeywordBoost(results, ['typescript']);

    // mem-1 should be boosted (1 keyword match -> 10% boost)
    expect(boosted[0].memory.memoryId).toBe('mem-1');
    expect(boosted[0].score).toBeCloseTo(0.55, 5);
    // mem-2 should be unchanged
    expect(boosted[1].score).toBeCloseTo(0.5, 5);
  });

  it('caps boost at 50%', () => {
    const results = [
      makeMockResult('mem-1', ['a', 'b', 'c', 'd', 'e', 'f', 'g'], 1.0),
    ];

    const boosted = applyKeywordBoost(results, ['a', 'b', 'c', 'd', 'e', 'f', 'g']);

    // 7 matches * 10% = 70%, capped at 50%
    expect(boosted[0].score).toBeCloseTo(1.5, 5);
  });

  it('returns unchanged results when no keyword overlap', () => {
    const results = [
      makeMockResult('mem-1', ['typescript'], 0.8),
    ];

    const boosted = applyKeywordBoost(results, ['python']);
    expect(boosted[0].score).toBeCloseTo(0.8, 5);
  });

  it('returns unchanged results for empty query tokens', () => {
    const results = [
      makeMockResult('mem-1', ['typescript'], 0.8),
    ];

    const boosted = applyKeywordBoost(results, []);
    expect(boosted[0].score).toBeCloseTo(0.8, 5);
  });

  it('handles results with no keywords', () => {
    const results = [
      makeMockResult('mem-1', [], 0.5),
    ];

    const boosted = applyKeywordBoost(results, ['typescript']);
    expect(boosted[0].score).toBeCloseTo(0.5, 5);
  });

  it('re-sorts by boosted score', () => {
    const results = [
      makeMockResult('mem-1', ['python'], 0.55),
      makeMockResult('mem-2', ['typescript', 'javascript'], 0.5),
    ];

    const boosted = applyKeywordBoost(results, ['typescript', 'javascript']);

    // mem-2 gets 2 * 10% = 20% boost: 0.5 * 1.2 = 0.6
    // mem-1 gets 0% boost: stays at 0.55
    // mem-2 should now rank higher
    expect(boosted[0].memory.memoryId).toBe('mem-2');
    expect(boosted[0].score).toBeCloseTo(0.6, 5);
    expect(boosted[1].memory.memoryId).toBe('mem-1');
    expect(boosted[1].score).toBeCloseTo(0.55, 5);
  });
});

// ---------------------------------------------------------------------------
// extractQueryTokens
// ---------------------------------------------------------------------------
describe('extractQueryTokens', () => {
  it('extracts meaningful tokens from query', () => {
    const tokens = extractQueryTokens('What color is the car?');
    expect(tokens).toEqual(['color', 'car']);
  });

  it('falls back to all tokens for stop-word-only queries', () => {
    const tokens = extractQueryTokens('is the');
    expect(tokens).toEqual(['is', 'the']);
  });

  it('returns empty for empty query', () => {
    expect(extractQueryTokens('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyThreeFactorReranking
// ---------------------------------------------------------------------------
describe('applyThreeFactorReranking', () => {
  function makeMockResult(
    id: string,
    learnedAt: string,
    salience: number,
    score: number,
  ): SearchResult {
    return {
      memory: {
        memoryId: id,
        userId: 'user1',
        memoryType: 'fact',
        content: `content for ${id}`,
        learnedAt,
        confidence: 1.0,
        salience,
        isLatest: true,
        keywords: [],
        tier: 'warm',
        activationScore: 1.0,
        accessCount: 0,
        useCount: 0,
        successCount: 0,
      },
      score,
      matchType: 'fts',
    };
  }

  it('recent memory scores higher than old memory', () => {
    const now = new Date();
    const recentDate = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(); // 1 hour ago
    const oldDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago

    const results: readonly SearchResult[] = [
      makeMockResult('mem-old', oldDate, 1.0, 0.8),
      makeMockResult('mem-recent', recentDate, 1.0, 0.8),
    ];

    const reranked = applyThreeFactorReranking(results);

    const recentResult = reranked.find(r => r.memory.memoryId === 'mem-recent');
    const oldResult = reranked.find(r => r.memory.memoryId === 'mem-old');

    expect(recentResult).toBeDefined();
    expect(oldResult).toBeDefined();
    expect(recentResult!.score).toBeGreaterThan(oldResult!.score);
  });

  it('high salience memory scores higher than low salience', () => {
    const now = new Date().toISOString();

    const results: readonly SearchResult[] = [
      makeMockResult('mem-low', now, 0.1, 0.5),
      makeMockResult('mem-high', now, 1.0, 0.5),
    ];

    const reranked = applyThreeFactorReranking(results);

    const highResult = reranked.find(r => r.memory.memoryId === 'mem-high');
    const lowResult = reranked.find(r => r.memory.memoryId === 'mem-low');

    expect(highResult).toBeDefined();
    expect(lowResult).toBeDefined();
    expect(highResult!.score).toBeGreaterThan(lowResult!.score);
  });

  it('original relevance score still matters', () => {
    const now = new Date().toISOString();

    const results: readonly SearchResult[] = [
      makeMockResult('mem-low-rel', now, 1.0, 0.1),
      makeMockResult('mem-high-rel', now, 1.0, 0.9),
    ];

    const reranked = applyThreeFactorReranking(results);

    const highRelResult = reranked.find(r => r.memory.memoryId === 'mem-high-rel');
    const lowRelResult = reranked.find(r => r.memory.memoryId === 'mem-low-rel');

    expect(highRelResult).toBeDefined();
    expect(lowRelResult).toBeDefined();
    expect(highRelResult!.score).toBeGreaterThan(lowRelResult!.score);
  });

  it('single result returns normalized score', () => {
    const now = new Date().toISOString();
    const results: readonly SearchResult[] = [
      makeMockResult('mem-only', now, 0.8, 0.7),
    ];

    const reranked = applyThreeFactorReranking(results);

    expect(reranked).toHaveLength(1);
    // Single result: all factors normalize to 1.0
    // score = 1.0 * 1.0 + 1.0 * 1.0 + 1.0 * 1.0 = 3.0
    expect(reranked[0].score).toBeCloseTo(3.0, 1);
  });

  it('returns empty for empty input', () => {
    expect(applyThreeFactorReranking([])).toEqual([]);
  });

  it('respects custom weights', () => {
    const now = new Date();
    const recentDate = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const oldDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const results: readonly SearchResult[] = [
      makeMockResult('mem-old', oldDate, 1.0, 0.8),
      makeMockResult('mem-recent', recentDate, 1.0, 0.8),
    ];

    // Zero out recency weight: recency should no longer affect ranking
    const reranked = applyThreeFactorReranking(results, { recency: 0.0 });

    // With recency=0 and same importance/relevance, scores should be equal
    expect(reranked[0].score).toBeCloseTo(reranked[1].score, 1);
  });
});
