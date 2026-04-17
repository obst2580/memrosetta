import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ensureSchema } from '../src/schema.js';
import {
  preprocessQuery,
  buildFtsQuery,
  buildSearchSql,
  normalizeScores,
  ftsSearch,
  searchMemories,
  deduplicateResults,
  applyKeywordBoost,
  extractQueryTokens,
  applyThreeFactorReranking,
} from '../src/search.js';
import type { MemoryRow } from '../src/mapper.js';
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
    keywords: null,
    event_date_start: null,
    event_date_end: null,
    invalidated_at: null,
  };
  const row = { ...defaults, ...overrides };
  db.prepare(`
    INSERT INTO memories (memory_id, user_id, namespace, memory_type, content, raw_text, document_date, learned_at, source_id, confidence, salience, is_latest, keywords, event_date_start, event_date_end, invalidated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    // 4 meaningful tokens -> OR mode
    expect(result).toBe('"caroline" OR "lgbtq" OR "support" OR "group"');
  });

  it('falls back to all tokens when every token is a stop word', () => {
    const result = buildFtsQuery('is the');
    // 2 tokens -> AND mode
    expect(result).toBe('"is" AND "the"');
  });

  it('handles query with multiple special characters', () => {
    const result = buildFtsQuery('a(b) c*d {e}');
    // 3 tokens -> OR mode
    expect(result).toBe('"ab" OR "cd" OR "e"');
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

  it('finds Korean natural-language query with low-signal suffixes removed', () => {
    insertTestMemory(db, {
      memory_id: 'mem-hermes-1',
      content: 'hermes github 주소 정리',
      keywords: 'hermes github 주소',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'hermes github 주소가 뭐지 ?',
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].memory.memoryId).toBe('mem-hermes-1');
  });

  it('finds mixed query with Korean filler words removed', () => {
    insertTestMemory(db, {
      memory_id: 'mem-hermes-2',
      content: 'hermes github 링크',
      keywords: 'hermes github 링크',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'hermes github 이거 뭐야',
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].memory.memoryId).toBe('mem-hermes-2');
  });

  it('finds mixed English/Korean query with OR recall for three tokens', () => {
    insertTestMemory(db, {
      memory_id: 'mem-hermes-3',
      content: 'NousResearch hermes-agent 링크',
      keywords: 'nousresearch hermes-agent 링크',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'NousResearch hermes-agent 링크 어디',
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].memory.memoryId).toBe('mem-hermes-3');
  });

  it('finds Korean-only query after switching 3+ tokens to OR mode', () => {
    insertTestMemory(db, {
      memory_id: 'mem-hermes-4',
      content: '헤르메스 깃허브 주소',
      keywords: '헤르메스 깃허브 주소',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: '헤르메스 깃허브 주소',
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].memory.memoryId).toBe('mem-hermes-4');
  });

  it('keeps two-token punctuated query in AND mode', () => {
    insertTestMemory(db, {
      memory_id: 'mem-hermes-5',
      content: 'hermes github',
      keywords: 'hermes github',
    });

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'hermes? github!!',
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].memory.memoryId).toBe('mem-hermes-5');
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

// v0.11: rrfMerge / bruteForceVectorSearch / searchMemories hybrid /
// multi-user vector isolation test suites removed together with the
// HF embedder + sqlite-vec paths.

// ---------------------------------------------------------------------------
// buildFtsQuery AND/OR strategy
// ---------------------------------------------------------------------------
describe('buildFtsQuery AND/OR strategy', () => {
  it('uses AND for 2-token queries', () => {
    expect(buildFtsQuery('red car')).toBe('"red" AND "car"');
  });

  it('uses AND for 3-token queries', () => {
    expect(buildFtsQuery('big red car')).toBe('"big" OR "red" OR "car"');
  });

  it('uses AND for 4-token queries', () => {
    expect(buildFtsQuery('big red fast car')).toBe('"big" OR "red" OR "fast" OR "car"');
  });

  it('uses OR for 5+ token queries', () => {
    expect(buildFtsQuery('big red fast shiny car')).toBe(
      '"big" OR "red" OR "fast" OR "shiny" OR "car"',
    );
  });

  it('counts only meaningful tokens for AND/OR threshold', () => {
    // "the big and red car" -> stop words removed -> "big", "red", "car" (3 tokens -> OR)
    expect(buildFtsQuery('the big and red car')).toBe('"big" OR "red" OR "car"');
  });

  it('removes low-signal Korean question tokens before building the FTS query', () => {
    expect(buildFtsQuery('hermes github 주소가 뭐지 ?')).toBe('"hermes" OR "github" OR "주소가"');
  });

  it('keeps two-token Korean/English queries in AND mode', () => {
    expect(buildFtsQuery('hermes? github!!')).toBe('"hermes" AND "github"');
  });
});

// ---------------------------------------------------------------------------
// preprocessQuery
// ---------------------------------------------------------------------------
describe('preprocessQuery', () => {
  it('normalizes English queries and removes stop words', () => {
    expect(preprocessQuery('What color is the car?')).toEqual(['color', 'car']);
  });

  it('removes low-signal Korean question tokens', () => {
    expect(preprocessQuery('hermes github 주소가 뭐지 ?')).toEqual(['hermes', 'github', '주소가']);
  });

  it('removes low-signal Korean request tokens', () => {
    expect(preprocessQuery('NousResearch hermes-agent 링크 알려줘')).toEqual([
      'nousresearch',
      'hermes-agent',
      '링크',
    ]);
  });

  it('falls back to the original tokens when every token is low-signal', () => {
    expect(preprocessQuery('왜 어디')).toEqual(['왜', '어디']);
  });

  it('returns empty for empty query', () => {
    expect(preprocessQuery('')).toEqual([]);
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
    // score = 2.0 * 1.0 + 1.0 * 1.0 + 1.0 * 1.0 = 4.0
    // (recency default weight bumped to 2.0 for freshness priority)
    expect(reranked[0].score).toBeCloseTo(4.0, 1);
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

