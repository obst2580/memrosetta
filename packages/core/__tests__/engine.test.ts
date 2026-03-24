import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteMemoryEngine } from '../src/engine.js';
import type { MemoryInput } from '@memrosetta/types';
import type { Embedder } from '@memrosetta/embeddings';

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

/**
 * Deterministic mock embedder for testing.
 * Produces normalized 384-dim vectors based on text content.
 */
class MockEmbedder implements Embedder {
  readonly dimension = 384;
  async initialize(): Promise<void> { /* no-op */ }
  async close(): Promise<void> { /* no-op */ }
  async embed(text: string): Promise<Float32Array> {
    const vec = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
      vec[i] = Math.sin(text.charCodeAt(i % text.length) + i) * 0.1;
    }
    // Normalize
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < 384; i++) vec[i] /= norm;
    }
    return vec;
  }
  async embedBatch(texts: readonly string[]): Promise<readonly Float32Array[]> {
    const results: Float32Array[] = [];
    for (const t of texts) {
      results.push(await this.embed(t));
    }
    return results;
  }
}

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

  // -----------------------------------------------------------------------
  // Relate
  // -----------------------------------------------------------------------

  describe('relate', () => {
    it('creates relation between memories', async () => {
      const m1 = await engine.store(makeInput({ content: 'Fact version 1' }));
      const m2 = await engine.store(makeInput({ content: 'Fact version 2' }));

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
describe('SqliteMemoryEngine with embedder', () => {
  let engine: SqliteMemoryEngine;
  const embedder = new MockEmbedder();

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({
      dbPath: ':memory:',
      embedder,
    });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  describe('store with embedder', () => {
    it('stores memory with embedding', async () => {
      const memory = await engine.store(
        makeInput({ content: 'TypeScript is great' }),
      );

      expect(memory.memoryId).toMatch(/^mem-/);
      expect(memory.content).toBe('TypeScript is great');
      // Embedding should be present in the retrieved memory
      expect(memory.embedding).toBeDefined();
      expect(memory.embedding!.length).toBe(384);
    });

    it('embedding values are normalized', async () => {
      const memory = await engine.store(
        makeInput({ content: 'test embedding normalization' }),
      );

      const emb = memory.embedding!;
      const norm = Math.sqrt(emb.reduce((s, v) => s + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 1);
    });
  });

  describe('storeBatch with embedder', () => {
    it('stores batch with embeddings', async () => {
      const inputs = [
        makeInput({ content: 'Memory A about TypeScript' }),
        makeInput({ content: 'Memory B about Python' }),
        makeInput({ content: 'Memory C about Rust' }),
      ];

      const results = await engine.storeBatch(inputs);

      expect(results).toHaveLength(3);
      for (const memory of results) {
        expect(memory.embedding).toBeDefined();
        expect(memory.embedding!.length).toBe(384);
      }
    });

    it('empty batch returns empty array', async () => {
      const results = await engine.storeBatch([]);
      expect(results).toHaveLength(0);
    });
  });

  describe('hybrid search', () => {
    it('returns results for keyword query', async () => {
      await engine.store(
        makeInput({
          content: 'TypeScript compiles to JavaScript',
          keywords: ['typescript', 'javascript'],
        }),
      );
      await engine.store(
        makeInput({
          content: 'Python is used for machine learning',
          keywords: ['python', 'ml'],
        }),
      );

      const response = await engine.search({
        userId: 'user-1',
        query: 'TypeScript',
      });

      expect(response.results.length).toBeGreaterThan(0);
      expect(response.results[0].memory.content).toContain('TypeScript');
    });

    it('returns results with queryTimeMs', async () => {
      await engine.store(
        makeInput({ content: 'database optimization techniques' }),
      );

      const response = await engine.search({
        userId: 'user-1',
        query: 'database optimization',
      });

      expect(response.queryTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('respects userId filter in hybrid mode', async () => {
      await engine.store(
        makeInput({ userId: 'user-1', content: 'User 1 prefers TypeScript' }),
      );
      await engine.store(
        makeInput({ userId: 'user-2', content: 'User 2 prefers Python' }),
      );

      const response = await engine.search({
        userId: 'user-1',
        query: 'prefers',
      });

      for (const result of response.results) {
        expect(result.memory.userId).toBe('user-1');
      }
    });
  });

  describe('getById after vector store', () => {
    it('returns memory with embedding', async () => {
      const stored = await engine.store(
        makeInput({ content: 'get by id test with vector' }),
      );

      const retrieved = await engine.getById(stored.memoryId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.embedding).toBeDefined();
      expect(retrieved!.embedding!.length).toBe(384);
    });
  });

  describe('clear with vector store', () => {
    it('clears memories and embeddings', async () => {
      await engine.store(
        makeInput({ content: 'memory to clear with vector' }),
      );

      expect(await engine.count('user-1')).toBe(1);

      await engine.clear('user-1');
      expect(await engine.count('user-1')).toBe(0);

      // Search should return empty
      const response = await engine.search({
        userId: 'user-1',
        query: 'memory clear',
      });
      expect(response.results).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// SqliteMemoryEngine without embedder (backward compatible)
// ---------------------------------------------------------------------------
describe('SqliteMemoryEngine without embedder (backward compatible)', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  it('stores without embedding', async () => {
    const memory = await engine.store(makeInput());

    expect(memory.memoryId).toMatch(/^mem-/);
    expect(memory.embedding).toBeUndefined();
  });

  it('search returns FTS-only results', async () => {
    await engine.store(
      makeInput({ content: 'backward compatible FTS search' }),
    );

    const response = await engine.search({
      userId: 'user-1',
      query: 'backward compatible',
    });

    expect(response.results.length).toBeGreaterThan(0);
    expect(response.results[0].matchType).toBe('fts');
  });

  it('storeBatch works without embedder', async () => {
    const inputs = [
      makeInput({ content: 'Batch A' }),
      makeInput({ content: 'Batch B' }),
    ];

    const results = await engine.storeBatch(inputs);
    expect(results).toHaveLength(2);
    for (const memory of results) {
      expect(memory.embedding).toBeUndefined();
    }
  });
});
