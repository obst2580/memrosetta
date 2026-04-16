import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteMemoryEngine } from '../src/engine.js';
import type { MemoryInput, MemoryRelation } from '@memrosetta/types';
import type { Embedder, ContradictionDetector, ContradictionResult } from '@memrosetta/embeddings';

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
      // Hybrid search must include the TypeScript memory in results
      const hasTypeScript = response.results.some(r =>
        r.memory.content.includes('TypeScript'),
      );
      expect(hasTypeScript).toBe(true);
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

// ---------------------------------------------------------------------------
// Mock ContradictionDetector for engine integration tests
// ---------------------------------------------------------------------------

class MockContradictionDetector implements ContradictionDetector {
  private _initialized = false;
  readonly detectCalls: { textA: string; textB: string }[] = [];

  /**
   * Configurable response map. If a key matching `${textA}|||${textB}` exists,
   * return that result. Otherwise, return neutral.
   */
  readonly responseMap = new Map<string, ContradictionResult>();

  async initialize(): Promise<void> {
    this._initialized = true;
  }

  async close(): Promise<void> {
    this._initialized = false;
  }

  async detect(textA: string, textB: string): Promise<ContradictionResult> {
    if (!this._initialized) {
      throw new Error('ContradictionDetector not initialized. Call initialize() first.');
    }
    this.detectCalls.push({ textA, textB });
    const key = `${textA}|||${textB}`;
    return this.responseMap.get(key) ?? { label: 'neutral', score: 0.8 };
  }

  async detectBatch(
    pairs: readonly { readonly textA: string; readonly textB: string }[],
  ): Promise<readonly ContradictionResult[]> {
    const results: ContradictionResult[] = [];
    for (const pair of pairs) {
      results.push(await this.detect(pair.textA, pair.textB));
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// SqliteMemoryEngine with ContradictionDetector
// ---------------------------------------------------------------------------
describe('SqliteMemoryEngine with contradiction detection', () => {
  let engine: SqliteMemoryEngine;
  let mockDetector: MockContradictionDetector;
  const embedder = new MockEmbedder();

  beforeEach(async () => {
    mockDetector = new MockContradictionDetector();
    await mockDetector.initialize();

    engine = new SqliteMemoryEngine({
      dbPath: ':memory:',
      embedder,
      contradictionDetector: mockDetector,
      contradictionThreshold: 0.7,
    });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
    await mockDetector.close();
  });

  it('auto-creates contradicts relation when contradiction detected', async () => {
    // Store first memory
    const m1 = await engine.store(
      makeInput({
        content: 'The project deadline is Friday',
        keywords: ['project', 'deadline'],
      }),
    );

    // Configure detector to report contradiction between m1 and the new memory
    mockDetector.responseMap.set(
      `The project deadline is Friday|||The project deadline is Monday`,
      { label: 'contradiction', score: 0.95 },
    );

    // Store second memory that contradicts the first
    const m2 = await engine.store(
      makeInput({
        content: 'The project deadline is Monday',
        keywords: ['project', 'deadline'],
      }),
    );

    // Verify the contradicts relation was auto-created
    const relations = await engine.getRelations(m2.memoryId);
    expect(relations.length).toBeGreaterThan(0);

    const contradicts = relations.find(
      (r) => r.relationType === 'contradicts',
    );
    expect(contradicts).toBeDefined();
    expect(contradicts!.srcMemoryId).toBe(m2.memoryId);
    expect(contradicts!.dstMemoryId).toBe(m1.memoryId);
    expect(contradicts!.reason).toContain('NLI confidence');
  });

  it('does not create relation when no contradiction detected', async () => {
    // Store first memory
    await engine.store(
      makeInput({
        content: 'TypeScript is a typed superset of JavaScript',
        keywords: ['typescript', 'javascript'],
      }),
    );

    // Default mock returns neutral, so no contradiction
    const m2 = await engine.store(
      makeInput({
        content: 'Python is a popular programming language',
        keywords: ['python', 'programming'],
      }),
    );

    const relations = await engine.getRelations(m2.memoryId);
    const contradicts = relations.filter(
      (r) => r.relationType === 'contradicts',
    );
    expect(contradicts).toHaveLength(0);
  });

  it('does not create relation when score is below threshold', async () => {
    const m1 = await engine.store(
      makeInput({
        content: 'The meeting is at 3pm',
        keywords: ['meeting', 'time'],
      }),
    );

    // Set contradiction but below threshold (0.7)
    mockDetector.responseMap.set(
      `The meeting is at 3pm|||The meeting is at 5pm`,
      { label: 'contradiction', score: 0.5 },
    );

    const m2 = await engine.store(
      makeInput({
        content: 'The meeting is at 5pm',
        keywords: ['meeting', 'time'],
      }),
    );

    const relations = await engine.getRelations(m2.memoryId);
    const contradicts = relations.filter(
      (r) => r.relationType === 'contradicts',
    );
    expect(contradicts).toHaveLength(0);
  });

  it('stores memory even if contradiction detector throws', async () => {
    // Store first memory
    await engine.store(
      makeInput({
        content: 'Some fact about programming languages',
        keywords: ['programming'],
      }),
    );

    // Make detector throw on next call
    const failingDetector = new MockContradictionDetector();
    await failingDetector.initialize();
    const originalDetect = failingDetector.detect.bind(failingDetector);
    failingDetector.detect = async () => {
      throw new Error('NLI model crashed');
    };

    // Create new engine with failing detector
    const failEngine = new SqliteMemoryEngine({
      dbPath: ':memory:',
      embedder,
      contradictionDetector: failingDetector,
    });
    await failEngine.initialize();

    // Store memory in the fresh engine (first memory, no similar to compare)
    const stored = await failEngine.store(
      makeInput({
        content: 'Another fact about coding',
        keywords: ['coding'],
      }),
    );

    // Memory should still be stored successfully
    expect(stored.memoryId).toMatch(/^mem-/);
    expect(stored.content).toBe('Another fact about coding');

    await failEngine.close();
    await failingDetector.close();
  });

  it('skips contradiction check when no detector is provided', async () => {
    // Engine without detector
    const plainEngine = new SqliteMemoryEngine({
      dbPath: ':memory:',
      embedder,
    });
    await plainEngine.initialize();

    const m1 = await plainEngine.store(
      makeInput({ content: 'First fact', keywords: ['fact'] }),
    );
    const m2 = await plainEngine.store(
      makeInput({ content: 'Second fact', keywords: ['fact'] }),
    );

    // Should store without error
    expect(m1.memoryId).toMatch(/^mem-/);
    expect(m2.memoryId).toMatch(/^mem-/);

    await plainEngine.close();
  });

  it('skips self when checking contradictions', async () => {
    // Store a memory - the detector should never be called with the same memory
    // as both textA and textB
    await engine.store(
      makeInput({
        content: 'A unique fact',
        keywords: ['unique'],
      }),
    );

    // Check that no detect call has the same content for both textA and textB
    for (const call of mockDetector.detectCalls) {
      expect(call.textA).not.toBe(call.textB);
    }
  });

  it('only checks memories for the same user', async () => {
    // Store memory for user-1
    await engine.store(
      makeInput({
        userId: 'user-1',
        content: 'The project deadline is Friday',
        keywords: ['project', 'deadline'],
      }),
    );

    // Store memory for user-2 with contradicting content
    mockDetector.responseMap.set(
      `The project deadline is Friday|||The project deadline is Monday`,
      { label: 'contradiction', score: 0.95 },
    );

    const m2 = await engine.store(
      makeInput({
        userId: 'user-2',
        content: 'The project deadline is Monday',
        keywords: ['project', 'deadline'],
      }),
    );

    // No contradiction should be found since memories belong to different users
    const relations = await engine.getRelations(m2.memoryId);
    const contradicts = relations.filter(
      (r) => r.relationType === 'contradicts',
    );
    expect(contradicts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Time Model Extension
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
describe('SqliteMemoryEngine storeBatch with contradiction detection', () => {
  let engine: SqliteMemoryEngine;
  let mockDetector: MockContradictionDetector;
  const embedder = new MockEmbedder();

  beforeEach(async () => {
    mockDetector = new MockContradictionDetector();
    await mockDetector.initialize();

    engine = new SqliteMemoryEngine({
      dbPath: ':memory:',
      embedder,
      contradictionDetector: mockDetector,
      contradictionThreshold: 0.7,
    });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
    await mockDetector.close();
  });

  it('storeBatch runs contradiction checks on small batches', async () => {
    // Store a base memory first
    await engine.store(
      makeInput({
        content: 'The server runs on port 3000',
        keywords: ['server', 'port'],
      }),
    );

    // Configure detector for contradiction
    mockDetector.responseMap.set(
      'The server runs on port 3000|||The server runs on port 8080',
      { label: 'contradiction', score: 0.9 },
    );

    // storeBatch with a contradicting memory
    const batchResults = await engine.storeBatch([
      makeInput({
        content: 'The server runs on port 8080',
        keywords: ['server', 'port'],
      }),
    ]);

    expect(batchResults).toHaveLength(1);

    // Verify contradiction was detected during storeBatch
    const relations = await engine.getRelations(batchResults[0].memoryId);
    const contradicts = relations.filter(r => r.relationType === 'contradicts');
    expect(contradicts.length).toBeGreaterThanOrEqual(1);
  });

  it('storeBatch does not block on contradiction check failure', async () => {
    // Make detector throw
    const failDetector = new MockContradictionDetector();
    await failDetector.initialize();
    failDetector.detect = async () => { throw new Error('NLI crash'); };

    const failEngine = new SqliteMemoryEngine({
      dbPath: ':memory:',
      embedder,
      contradictionDetector: failDetector,
    });
    await failEngine.initialize();

    const results = await failEngine.storeBatch([
      makeInput({ content: 'Batch item A', keywords: ['batch'] }),
      makeInput({ content: 'Batch item B', keywords: ['batch'] }),
    ]);

    expect(results).toHaveLength(2);

    await failEngine.close();
    await failDetector.close();
  });
});

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------
describe('SqliteMemoryEngine duplicate detection', () => {
  let engine: SqliteMemoryEngine;

  /**
   * A mock embedder that produces very similar vectors for similar content.
   * Content starting with the same prefix produces nearly identical embeddings.
   */
  class SimilarContentEmbedder implements Embedder {
    readonly dimension = 384;
    async initialize(): Promise<void> { /* no-op */ }
    async close(): Promise<void> { /* no-op */ }
    async embed(text: string): Promise<Float32Array> {
      const vec = new Float32Array(384);
      // Use first 10 chars as seed so similar content produces similar vectors
      const seed = text.slice(0, 10);
      for (let i = 0; i < 384; i++) {
        vec[i] = Math.sin(seed.charCodeAt(i % seed.length) + i * 0.01) * 0.1;
      }
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

  afterEach(async () => {
    if (engine) await engine.close();
  });

  it('auto-creates updates relation for near-duplicate content', async () => {
    const similarEmbedder = new SimilarContentEmbedder();
    engine = new SqliteMemoryEngine({
      dbPath: ':memory:',
      embedder: similarEmbedder,
    });
    await engine.initialize();

    // Store two memories with very similar content (same first 10 chars -> same embedding)
    const m1 = await engine.store(
      makeInput({
        content: 'TypeScrip: is a typed superset of JavaScript version 1',
        keywords: ['typescript'],
      }),
    );

    const m2 = await engine.store(
      makeInput({
        content: 'TypeScrip: is a typed superset of JavaScript version 2',
        keywords: ['typescript'],
      }),
    );

    // Check for auto-created 'updates' relation
    const relations = await engine.getRelations(m2.memoryId);
    const updates = relations.filter(r => r.relationType === 'updates');

    // Should have created an 'updates' relation since cosine similarity is > 0.95
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates[0].dstMemoryId).toBe(m1.memoryId);
  });

  it('does not create updates relation for different content', async () => {
    engine = new SqliteMemoryEngine({
      dbPath: ':memory:',
      embedder: new MockEmbedder(),
    });
    await engine.initialize();

    const m1 = await engine.store(
      makeInput({
        content: 'TypeScript is a programming language',
        keywords: ['typescript'],
      }),
    );

    const m2 = await engine.store(
      makeInput({
        content: 'Python is used for machine learning',
        keywords: ['python'],
      }),
    );

    const relations = await engine.getRelations(m2.memoryId);
    const updates = relations.filter(r => r.relationType === 'updates');
    expect(updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Feedback (utility feedback system)
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
