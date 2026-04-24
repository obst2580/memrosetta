import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteMemoryEngine } from '../src/engine.js';
import type { MemoryInput, MemoryRelation } from '@memrosetta/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides?: Partial<MemoryInput>): MemoryInput {
  return {
    userId: 'user-1',
    memoryType: 'fact',
    content: 'TypeScript is a typed superset of JavaScript',
    keywords: ['typescript', 'javascript'],
    ...overrides,
  };
}

// v0.11: MockEmbedder and its Embedder/ContradictionDetector imports
// were removed together with the HF integration.

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SqliteMemoryEngine', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  describe('lifecycle', () => {
    it('initialize creates tables and allows operations', async () => {
      const count = await engine.count('user-1');
      expect(count).toBe(0);
    });

    it('operations throw after close', async () => {
      await engine.close();
      await expect(engine.store(makeInput())).rejects.toThrow(
        'Engine not initialized',
      );
    });

    it('double initialize does not error', async () => {
      // Create a fresh engine and initialize twice
      const eng2 = new SqliteMemoryEngine({ dbPath: ':memory:' });
      await eng2.initialize();
      await expect(eng2.initialize()).resolves.not.toThrow();
      await eng2.close();
    });

    it('double close does not error', async () => {
      await engine.close();
      await expect(engine.close()).resolves.not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Store + GetById roundtrip
  // -----------------------------------------------------------------------

  describe('store + getById', () => {
    it('store returns Memory with all fields', async () => {
      const input = makeInput({
        namespace: 'test-ns',
        rawText: 'raw input text',
        documentDate: '2025-01-01T00:00:00Z',
        sourceId: 'src-001',
        confidence: 0.9,
        salience: 0.8,
      });

      const memory = await engine.store(input);

      expect(memory.memoryId).toMatch(/^mem-/);
      expect(memory.userId).toBe('user-1');
      expect(memory.memoryType).toBe('fact');
      expect(memory.content).toBe(input.content);
      expect(memory.namespace).toBe('test-ns');
      expect(memory.rawText).toBe('raw input text');
      expect(memory.documentDate).toBe('2025-01-01T00:00:00Z');
      expect(memory.sourceId).toBe('src-001');
      expect(memory.confidence).toBe(0.9);
      expect(memory.salience).toBe(0.8);
      expect(memory.isLatest).toBe(true);
      expect(memory.learnedAt).toBeDefined();
      expect(memory.keywords).toEqual(['typescript', 'javascript']);
    });

    it('getById returns the same memory', async () => {
      const stored = await engine.store(makeInput());
      const retrieved = await engine.getById(stored.memoryId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.memoryId).toBe(stored.memoryId);
      expect(retrieved!.content).toBe(stored.content);
      expect(retrieved!.userId).toBe(stored.userId);
    });

    it('getById with non-existent ID returns null', async () => {
      const result = await engine.getById('mem-nonexistent');
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // StoreBatch
  // -----------------------------------------------------------------------

  describe('storeBatch', () => {
    it('stores multiple memories atomically', async () => {
      const inputs = [
        makeInput({ content: 'Memory A' }),
        makeInput({ content: 'Memory B' }),
        makeInput({ content: 'Memory C' }),
      ];

      const results = await engine.storeBatch(inputs);

      expect(results).toHaveLength(3);
      expect(results[0].content).toBe('Memory A');
      expect(results[1].content).toBe('Memory B');
      expect(results[2].content).toBe('Memory C');
    });

    it('empty batch returns empty array', async () => {
      const results = await engine.storeBatch([]);
      expect(results).toHaveLength(0);
    });

    it('all IDs are unique', async () => {
      const inputs = Array.from({ length: 10 }, (_, i) =>
        makeInput({ content: `Memory ${i}` }),
      );

      const results = await engine.storeBatch(inputs);
      const ids = new Set(results.map((r) => r.memoryId));

      expect(ids.size).toBe(10);
    });

    it('count reflects batch size', async () => {
      const inputs = Array.from({ length: 5 }, (_, i) =>
        makeInput({ content: `Memory ${i}` }),
      );

      await engine.storeBatch(inputs);
      const count = await engine.count('user-1');

      expect(count).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  describe('search', () => {
    it('basic keyword search returns matches', async () => {
      await engine.store(
        makeInput({ content: 'Python is a programming language' }),
      );
      await engine.store(
        makeInput({ content: 'TypeScript compiles to JavaScript' }),
      );

      const response = await engine.search({
        userId: 'user-1',
        query: 'TypeScript',
      });

      expect(response.results.length).toBeGreaterThan(0);
      expect(response.results[0].memory.content).toContain('TypeScript');
    });

    it('search with no matches returns empty', async () => {
      await engine.store(
        makeInput({ content: 'Python is a programming language' }),
      );

      const response = await engine.search({
        userId: 'user-1',
        query: 'xyznonexistent',
      });

      expect(response.results).toHaveLength(0);
      expect(response.totalCount).toBe(0);
    });

    it('search respects userId filter', async () => {
      await engine.store(
        makeInput({ userId: 'user-1', content: 'User 1 favorite color blue' }),
      );
      await engine.store(
        makeInput({ userId: 'user-2', content: 'User 2 favorite color red' }),
      );

      const response = await engine.search({
        userId: 'user-2',
        query: 'favorite color',
      });

      expect(response.results.length).toBeGreaterThan(0);
      for (const result of response.results) {
        expect(result.memory.userId).toBe('user-2');
      }
    });

    it('BM25 ranking works (more relevant first)', async () => {
      // Store memories with varying relevance to "database optimization"
      await engine.store(
        makeInput({
          content:
            'Database optimization techniques include indexing and query tuning for database performance',
          keywords: ['database', 'optimization'],
        }),
      );
      await engine.store(
        makeInput({
          content: 'The weather is nice today for outdoor activities',
          keywords: ['weather'],
        }),
      );

      const response = await engine.search({
        userId: 'user-1',
        query: 'database optimization',
      });

      expect(response.results.length).toBeGreaterThan(0);
      expect(response.results[0].memory.content).toContain('Database');
    });
  });

  describe('search with source hydration', () => {
    it('includes source attestations only when requested', async () => {
      await engine.store(
        makeInput({
          content: 'Source monitoring is exposed in retrieval',
          keywords: ['source'],
          sources: [{ sourceKind: 'mcp', sourceRef: 'memrosetta_store' }],
        }),
      );

      const withoutSources = await engine.search({
        userId: 'user-1',
        query: 'source monitoring',
      });
      const withSources = await engine.search({
        userId: 'user-1',
        query: 'source monitoring',
        includeSource: true,
      });

      expect(withoutSources.results[0]).not.toHaveProperty('sources');
      expect(withSources.results[0].sources).toEqual([
        expect.objectContaining({
          sourceKind: 'mcp',
          sourceRef: 'memrosetta_store',
        }),
      ]);
    });
  });

  // -----------------------------------------------------------------------
  // Relate
  // -----------------------------------------------------------------------

  describe('relate', () => {
    it('creates relation between memories', async () => {
      const m1 = await engine.store(makeInput({ content: 'Fact version 1', keywords: undefined }));
      const m2 = await engine.store(makeInput({ content: 'Fact version 2', keywords: undefined }));

      const relation = await engine.relate(
        m2.memoryId,
        m1.memoryId,
        'extends',
        'Added more detail',
      );

      expect(relation.srcMemoryId).toBe(m2.memoryId);
      expect(relation.dstMemoryId).toBe(m1.memoryId);
      expect(relation.relationType).toBe('extends');
      expect(relation.reason).toBe('Added more detail');
      expect(relation.createdAt).toBeDefined();
    });

    it("'updates' relation sets dst isLatest=false", async () => {
      const m1 = await engine.store(makeInput({ content: 'Old fact' }));
      const m2 = await engine.store(makeInput({ content: 'New fact' }));

      await engine.relate(m2.memoryId, m1.memoryId, 'updates');

      const updated = await engine.getById(m1.memoryId);
      expect(updated!.isLatest).toBe(false);
    });

    it('getById after update reflects isLatest change', async () => {
      const m1 = await engine.store(
        makeInput({ content: 'Hourly rate is 50000 KRW' }),
      );
      const m2 = await engine.store(
        makeInput({
          content: 'Hourly rate is 40000 KRW for long-term clients',
        }),
      );

      // Before update
      const before = await engine.getById(m1.memoryId);
      expect(before!.isLatest).toBe(true);

      // Create update relation
      await engine.relate(m2.memoryId, m1.memoryId, 'updates');

      // After update
      const after = await engine.getById(m1.memoryId);
      expect(after!.isLatest).toBe(false);

      const newer = await engine.getById(m2.memoryId);
      expect(newer!.isLatest).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Count
  // -----------------------------------------------------------------------

  describe('count', () => {
    it('returns 0 for empty user', async () => {
      const count = await engine.count('user-nonexistent');
      expect(count).toBe(0);
    });

    it('returns correct count after stores', async () => {
      await engine.store(makeInput());
      await engine.store(makeInput());
      await engine.store(makeInput());

      const count = await engine.count('user-1');
      expect(count).toBe(3);
    });

    it('only counts specified user', async () => {
      await engine.store(makeInput({ userId: 'user-1' }));
      await engine.store(makeInput({ userId: 'user-1' }));
      await engine.store(makeInput({ userId: 'user-2' }));

      expect(await engine.count('user-1')).toBe(2);
      expect(await engine.count('user-2')).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Clear
  // -----------------------------------------------------------------------

  describe('clear', () => {
    it('clears all memories for user', async () => {
      await engine.store(makeInput());
      await engine.store(makeInput());

      await engine.clear('user-1');
      const count = await engine.count('user-1');

      expect(count).toBe(0);
    });

    it('count returns 0 after clear', async () => {
      await engine.storeBatch([
        makeInput({ content: 'A' }),
        makeInput({ content: 'B' }),
      ]);

      expect(await engine.count('user-1')).toBe(2);

      await engine.clear('user-1');
      expect(await engine.count('user-1')).toBe(0);
    });

    it("doesn't affect other users", async () => {
      await engine.store(makeInput({ userId: 'user-1', content: 'A' }));
      await engine.store(makeInput({ userId: 'user-2', content: 'B' }));

      await engine.clear('user-1');

      expect(await engine.count('user-1')).toBe(0);
      expect(await engine.count('user-2')).toBe(1);
    });

    it('search returns empty after clear', async () => {
      await engine.store(
        makeInput({ content: 'Searchable content about databases' }),
      );

      // Verify search works before clear
      const before = await engine.search({
        userId: 'user-1',
        query: 'databases',
      });
      expect(before.results.length).toBeGreaterThan(0);

      await engine.clear('user-1');

      const after = await engine.search({
        userId: 'user-1',
        query: 'databases',
      });
      expect(after.results).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Full workflow
  // -----------------------------------------------------------------------

  describe('full workflow', () => {
    it('store -> search -> relate -> search again (updated ranking)', async () => {
      // 1. Store initial memories
      const m1 = await engine.store(
        makeInput({
          content: 'Hourly rate is 50000 KRW',
          keywords: ['rate', 'pricing'],
        }),
      );
      const m2 = await engine.store(
        makeInput({
          content: 'Prefers working on SaaS projects',
          keywords: ['saas', 'preference'],
        }),
      );

      // 2. Search for rate info
      const firstSearch = await engine.search({
        userId: 'user-1',
        query: 'rate pricing',
      });
      expect(firstSearch.results.length).toBeGreaterThan(0);
      const foundMemory = firstSearch.results.find(
        (r) => r.memory.memoryId === m1.memoryId,
      );
      expect(foundMemory).toBeDefined();

      // 3. Store an update and create relation
      const m3 = await engine.store(
        makeInput({
          content: 'Hourly rate is 40000 KRW for long-term clients',
          keywords: ['rate', 'pricing', 'discount'],
        }),
      );
      await engine.relate(m3.memoryId, m1.memoryId, 'updates');

      // 4. Search again - with onlyLatest=true (default), old memory should be excluded
      const secondSearch = await engine.search({
        userId: 'user-1',
        query: 'rate pricing',
      });

      const memoryIds = secondSearch.results.map((r) => r.memory.memoryId);
      // m1 should NOT appear (isLatest = false)
      expect(memoryIds).not.toContain(m1.memoryId);
      // m3 should appear (isLatest = true)
      expect(memoryIds).toContain(m3.memoryId);

      // 5. Verify m2 is unaffected
      const found2 = await engine.getById(m2.memoryId);
      expect(found2!.isLatest).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// SqliteMemoryEngine with MockEmbedder (hybrid mode)
// ---------------------------------------------------------------------------
describe('SqliteMemoryEngine time model', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  describe('store with event dates', () => {
    it('stores memory with eventDateStart and eventDateEnd', async () => {
      const memory = await engine.store(
        makeInput({
          content: 'Conference in Seoul',
          eventDateStart: '2026-04-01T09:00:00Z',
          eventDateEnd: '2026-04-03T18:00:00Z',
        }),
      );

      expect(memory.memoryId).toMatch(/^mem-/);
      expect(memory.eventDateStart).toBe('2026-04-01T09:00:00Z');
      expect(memory.eventDateEnd).toBe('2026-04-03T18:00:00Z');
    });

    it('stores memory with only eventDateStart', async () => {
      const memory = await engine.store(
        makeInput({
          content: 'Project kickoff',
          eventDateStart: '2026-05-01T00:00:00Z',
        }),
      );

      expect(memory.eventDateStart).toBe('2026-05-01T00:00:00Z');
      expect(memory.eventDateEnd).toBeUndefined();
    });

    it('eventDateStart/End are undefined when not provided', async () => {
      const memory = await engine.store(makeInput());

      expect(memory.eventDateStart).toBeUndefined();
      expect(memory.eventDateEnd).toBeUndefined();
    });

    it('getById returns event dates', async () => {
      const stored = await engine.store(
        makeInput({
          content: 'Sprint review meeting',
          eventDateStart: '2026-03-20T14:00:00Z',
          eventDateEnd: '2026-03-20T15:00:00Z',
        }),
      );

      const retrieved = await engine.getById(stored.memoryId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.eventDateStart).toBe('2026-03-20T14:00:00Z');
      expect(retrieved!.eventDateEnd).toBe('2026-03-20T15:00:00Z');
    });
  });

  describe('search with eventDateRange filter', () => {
    it('filters by eventDateRange.start', async () => {
      await engine.store(
        makeInput({
          content: 'Early event conference',
          eventDateStart: '2026-01-15T00:00:00Z',
          keywords: ['conference'],
        }),
      );
      await engine.store(
        makeInput({
          content: 'Late event conference',
          eventDateStart: '2026-06-15T00:00:00Z',
          keywords: ['conference'],
        }),
      );

      const response = await engine.search({
        userId: 'user-1',
        query: 'conference',
        filters: {
          eventDateRange: { start: '2026-03-01T00:00:00Z' },
          excludeInvalidated: false,
        },
      });

      expect(response.results.length).toBe(1);
      expect(response.results[0].memory.eventDateStart).toBe(
        '2026-06-15T00:00:00Z',
      );
    });

    it('filters by eventDateRange.end', async () => {
      await engine.store(
        makeInput({
          content: 'Short workshop event',
          eventDateEnd: '2026-02-01T00:00:00Z',
          keywords: ['workshop'],
        }),
      );
      await engine.store(
        makeInput({
          content: 'Long workshop event',
          eventDateEnd: '2026-12-01T00:00:00Z',
          keywords: ['workshop'],
        }),
      );

      const response = await engine.search({
        userId: 'user-1',
        query: 'workshop',
        filters: {
          eventDateRange: { end: '2026-06-01T00:00:00Z' },
          excludeInvalidated: false,
        },
      });

      expect(response.results.length).toBe(1);
      expect(response.results[0].memory.eventDateEnd).toBe(
        '2026-02-01T00:00:00Z',
      );
    });
  });

  describe('excludeInvalidated filter', () => {
    it('excludes invalidated memories by default', async () => {
      const m1 = await engine.store(
        makeInput({
          content: 'Valid programming fact',
          keywords: ['programming'],
        }),
      );
      const m2 = await engine.store(
        makeInput({
          content: 'Outdated programming fact',
          keywords: ['programming'],
        }),
      );

      await engine.invalidate(m2.memoryId);

      const response = await engine.search({
        userId: 'user-1',
        query: 'programming',
      });

      const ids = response.results.map((r) => r.memory.memoryId);
      expect(ids).toContain(m1.memoryId);
      expect(ids).not.toContain(m2.memoryId);
    });

    it('includes invalidated memories when excludeInvalidated=false', async () => {
      const m1 = await engine.store(
        makeInput({
          content: 'Valid coding fact',
          keywords: ['coding'],
        }),
      );
      const m2 = await engine.store(
        makeInput({
          content: 'Outdated coding fact',
          keywords: ['coding'],
        }),
      );

      await engine.invalidate(m2.memoryId);

      const response = await engine.search({
        userId: 'user-1',
        query: 'coding',
        filters: { excludeInvalidated: false },
      });

      const ids = response.results.map((r) => r.memory.memoryId);
      expect(ids).toContain(m1.memoryId);
      expect(ids).toContain(m2.memoryId);
    });
  });

  describe('invalidate', () => {
    it('sets invalidatedAt timestamp', async () => {
      const memory = await engine.store(
        makeInput({ content: 'Soon to be invalidated' }),
      );

      const before = await engine.getById(memory.memoryId);
      expect(before!.invalidatedAt).toBeUndefined();

      await engine.invalidate(memory.memoryId);

      const after = await engine.getById(memory.memoryId);
      expect(after!.invalidatedAt).toBeDefined();
      // Check it is a valid ISO timestamp
      expect(new Date(after!.invalidatedAt!).toISOString()).toBe(
        after!.invalidatedAt,
      );
    });

    it('invalidated memory excluded from default search', async () => {
      const m = await engine.store(
        makeInput({
          content: 'Temporary database fact',
          keywords: ['database'],
        }),
      );

      // Before invalidation: found
      const before = await engine.search({
        userId: 'user-1',
        query: 'database',
      });
      expect(before.results.some((r) => r.memory.memoryId === m.memoryId)).toBe(
        true,
      );

      await engine.invalidate(m.memoryId);

      // After invalidation: not found (default excludeInvalidated=true)
      const after = await engine.search({
        userId: 'user-1',
        query: 'database',
      });
      expect(after.results.some((r) => r.memory.memoryId === m.memoryId)).toBe(
        false,
      );
    });

    it('invalidate on non-existent memory does not throw', async () => {
      await expect(
        engine.invalidate('mem-nonexistent'),
      ).resolves.not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// storeBatch with contradiction detection
// ---------------------------------------------------------------------------
describe('SqliteMemoryEngine feedback', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  it('increments use_count and success_count when helpful=true', async () => {
    const m = await engine.store(makeInput());
    expect(m.useCount).toBe(0);
    expect(m.successCount).toBe(0);

    await engine.feedback(m.memoryId, true);
    const after = await engine.getById(m.memoryId);
    expect(after!.useCount).toBe(1);
    expect(after!.successCount).toBe(1);
  });

  it('increments only use_count when helpful=false', async () => {
    const m = await engine.store(makeInput());

    await engine.feedback(m.memoryId, false);
    const after = await engine.getById(m.memoryId);
    expect(after!.useCount).toBe(1);
    expect(after!.successCount).toBe(0);
  });

  it('increases salience after helpful feedback', async () => {
    const m = await engine.store(makeInput({ salience: 0.5 }));
    const originalSalience = m.salience;

    await engine.feedback(m.memoryId, true);
    const after = await engine.getById(m.memoryId);
    // helpful=true with 100% success rate -> salience = 0.5 + 0.5 * 1.0 = 1.0
    expect(after!.salience).toBeGreaterThanOrEqual(originalSalience);
    expect(after!.salience).toBe(1.0);
  });

  it('decreases salience after not-helpful feedback', async () => {
    const m = await engine.store(makeInput({ salience: 1.0 }));

    await engine.feedback(m.memoryId, false);
    const after = await engine.getById(m.memoryId);
    // helpful=false with 0% success rate -> salience = 0.5 + 0.5 * 0.0 = 0.5
    expect(after!.salience).toBe(0.5);
  });

  it('accumulates multiple feedback calls correctly', async () => {
    const m = await engine.store(makeInput());

    await engine.feedback(m.memoryId, true);
    await engine.feedback(m.memoryId, true);
    await engine.feedback(m.memoryId, false);

    const after = await engine.getById(m.memoryId);
    expect(after!.useCount).toBe(3);
    expect(after!.successCount).toBe(2);
    // successRate = 2/3 -> salience = 0.5 + 0.5 * (2/3) ~ 0.833
    expect(after!.salience).toBeCloseTo(0.5 + 0.5 * (2 / 3), 5);
  });

  it('does not crash on non-existent memory', async () => {
    // Should not throw
    await engine.feedback('nonexistent-id', true);
    await engine.feedback('nonexistent-id', false);
  });
});
