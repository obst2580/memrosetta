import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteMemoryEngine } from '../src/engine.js';
import type { MemoryInput } from '@memrosetta/types';

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

// ---------------------------------------------------------------------------
// Phase 4: Hierarchical Compression & Adaptive Forgetting
// ---------------------------------------------------------------------------

describe('Phase 4: Memory tier fields', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  it('newly stored memory has default tier=warm, activationScore=1.0, accessCount=0', async () => {
    const memory = await engine.store(makeInput());

    expect(memory.tier).toBe('warm');
    expect(memory.activationScore).toBe(1.0);
    expect(memory.accessCount).toBe(0);
    expect(memory.lastAccessedAt).toBeUndefined();
    expect(memory.compressedFrom).toBeUndefined();
  });

  it('getById returns tier and activation fields', async () => {
    const stored = await engine.store(makeInput());
    const retrieved = await engine.getById(stored.memoryId);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.tier).toBe('warm');
    expect(retrieved!.activationScore).toBe(1.0);
    expect(retrieved!.accessCount).toBe(0);
  });

  it('storeBatch returns memories with tier fields', async () => {
    const inputs = [
      makeInput({ content: 'Memory A about TypeScript' }),
      makeInput({ content: 'Memory B about Python' }),
    ];

    const results = await engine.storeBatch(inputs);

    for (const memory of results) {
      expect(memory.tier).toBe('warm');
      expect(memory.activationScore).toBe(1.0);
      expect(memory.accessCount).toBe(0);
    }
  });
});

describe('Phase 4: setTier', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  it('promotes memory to hot tier', async () => {
    const memory = await engine.store(makeInput());
    expect(memory.tier).toBe('warm');

    await engine.setTier(memory.memoryId, 'hot');

    const updated = await engine.getById(memory.memoryId);
    expect(updated!.tier).toBe('hot');
  });

  it('demotes memory to cold tier', async () => {
    const memory = await engine.store(makeInput());
    await engine.setTier(memory.memoryId, 'cold');

    const updated = await engine.getById(memory.memoryId);
    expect(updated!.tier).toBe('cold');
  });

  it('does not error on non-existent memoryId', async () => {
    await expect(
      engine.setTier('mem-nonexistent', 'hot'),
    ).resolves.not.toThrow();
  });
});

describe('Phase 4: workingMemory', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  it('returns empty array for user with no memories', async () => {
    const result = await engine.workingMemory('user-nonexistent');
    expect(result).toHaveLength(0);
  });

  it('returns hot memories first', async () => {
    const m1 = await engine.store(
      makeInput({ content: 'Warm memory about coding' }),
    );
    const m2 = await engine.store(
      makeInput({ content: 'Hot memory about coding' }),
    );

    await engine.setTier(m2.memoryId, 'hot');

    const result = await engine.workingMemory('user-1');

    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].memoryId).toBe(m2.memoryId);
  });

  it('respects token limit', async () => {
    // Each memory is ~11 tokens (content length / 4)
    // Create enough to exceed a small limit
    for (let i = 0; i < 10; i++) {
      await engine.store(
        makeInput({ content: `Memory number ${i} about software development practices` }),
      );
    }

    const result = await engine.workingMemory('user-1', 50);

    // Should not return all 10 memories with a 50-token limit
    expect(result.length).toBeLessThan(10);
    expect(result.length).toBeGreaterThan(0);
  });

  it('excludes invalidated memories', async () => {
    const m1 = await engine.store(
      makeInput({ content: 'Valid programming memory' }),
    );
    const m2 = await engine.store(
      makeInput({ content: 'Invalidated programming memory' }),
    );

    await engine.invalidate(m2.memoryId);

    const result = await engine.workingMemory('user-1');
    const ids = result.map(r => r.memoryId);

    expect(ids).toContain(m1.memoryId);
    expect(ids).not.toContain(m2.memoryId);
  });

  it('excludes non-latest memories', async () => {
    const m1 = await engine.store(
      makeInput({ content: 'Old rate pricing fact', keywords: ['rate'] }),
    );
    const m2 = await engine.store(
      makeInput({ content: 'New rate pricing fact', keywords: ['rate'] }),
    );

    await engine.relate(m2.memoryId, m1.memoryId, 'updates');

    const result = await engine.workingMemory('user-1');
    const ids = result.map(r => r.memoryId);

    expect(ids).not.toContain(m1.memoryId);
    expect(ids).toContain(m2.memoryId);
  });

  it('only returns memories for specified user', async () => {
    await engine.store(makeInput({ userId: 'user-1', content: 'User 1 data' }));
    await engine.store(makeInput({ userId: 'user-2', content: 'User 2 data' }));

    const result = await engine.workingMemory('user-1');

    for (const memory of result) {
      expect(memory.userId).toBe('user-1');
    }
  });

  it('default maxTokens is 3000', async () => {
    // Create a lot of memories
    for (let i = 0; i < 50; i++) {
      await engine.store(
        makeInput({ content: `Memory ${i} with enough content to take some tokens` }),
      );
    }

    const result = await engine.workingMemory('user-1');
    const totalTokens = result.reduce(
      (sum, m) => sum + Math.ceil(m.content.length / 4),
      0,
    );

    expect(totalTokens).toBeLessThanOrEqual(3000);
  });
});

describe('Phase 4: Search access tracking', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  it('search increments access_count for returned memories', async () => {
    const memory = await engine.store(
      makeInput({
        content: 'TypeScript programming language features',
        keywords: ['typescript'],
      }),
    );

    expect(memory.accessCount).toBe(0);

    // Search that should return this memory
    await engine.search({ userId: 'user-1', query: 'TypeScript' });

    const updated = await engine.getById(memory.memoryId);
    expect(updated!.accessCount).toBe(1);
  });

  it('multiple searches increment access_count cumulatively', async () => {
    const memory = await engine.store(
      makeInput({
        content: 'Python data science libraries',
        keywords: ['python', 'data'],
      }),
    );

    await engine.search({ userId: 'user-1', query: 'Python' });
    await engine.search({ userId: 'user-1', query: 'data science' });

    const updated = await engine.getById(memory.memoryId);
    expect(updated!.accessCount).toBe(2);
  });

  it('search sets last_accessed_at', async () => {
    const memory = await engine.store(
      makeInput({
        content: 'Rust system programming language',
        keywords: ['rust', 'system'],
      }),
    );

    expect(memory.lastAccessedAt).toBeUndefined();

    await engine.search({ userId: 'user-1', query: 'Rust' });

    const updated = await engine.getById(memory.memoryId);
    expect(updated!.lastAccessedAt).toBeDefined();
    // Verify it's a valid ISO timestamp
    expect(new Date(updated!.lastAccessedAt!).toISOString()).toBe(
      updated!.lastAccessedAt,
    );
  });
});

describe('Phase 4: compress', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  it('returns zero when no cold memories exist', async () => {
    await engine.store(makeInput());

    const result = await engine.compress('user-1');
    expect(result.compressed).toBe(0);
    expect(result.removed).toBe(0);
  });

  it('compresses cold low-activation memories in same namespace', async () => {
    // Store memories, manually set to cold + low activation
    const m1 = await engine.store(
      makeInput({
        content: 'Old fact A about database',
        namespace: 'work',
      }),
    );
    const m2 = await engine.store(
      makeInput({
        content: 'Old fact B about database',
        namespace: 'work',
      }),
    );
    const m3 = await engine.store(
      makeInput({
        content: 'Old fact C about database',
        namespace: 'work',
      }),
    );

    // Manually set tier and activation via setTier + raw SQL
    await engine.setTier(m1.memoryId, 'cold');
    await engine.setTier(m2.memoryId, 'cold');
    await engine.setTier(m3.memoryId, 'cold');

    // Use internal DB access for setting activation_score low
    // We access via maintain which recomputes, but for direct test
    // let's use the engine's getById to verify then compress
    // Actually we need to set activation_score < 0.1 via raw DB
    // Use the public API: after setTier, the score is still 1.0
    // We need to lower it. Let's use maintain first to set realistic scores.
    // Actually for testing, let's use a workaround:
    // The engine is not exposed, so let's create a helper.
    // For now, directly test the scenario: store old memories, run maintain, then compress.

    // Better approach: Create engine with access to db for test
    const testEngine = engine as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } };

    testEngine.db.prepare(
      'UPDATE memories SET activation_score = 0.05 WHERE memory_id = ?',
    ).run(m1.memoryId);
    testEngine.db.prepare(
      'UPDATE memories SET activation_score = 0.05 WHERE memory_id = ?',
    ).run(m2.memoryId);
    testEngine.db.prepare(
      'UPDATE memories SET activation_score = 0.05 WHERE memory_id = ?',
    ).run(m3.memoryId);

    const result = await engine.compress('user-1');

    expect(result.compressed).toBe(1); // 1 summary created
    expect(result.removed).toBe(3); // 3 originals marked as not latest

    // Verify originals are no longer latest
    const orig1 = await engine.getById(m1.memoryId);
    expect(orig1!.isLatest).toBe(false);
  });

  it('does not compress single memory in a namespace group', async () => {
    const m1 = await engine.store(
      makeInput({
        content: 'Only one cold memory',
        namespace: 'solo',
      }),
    );

    await engine.setTier(m1.memoryId, 'cold');

    const testEngine = engine as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } };
    testEngine.db.prepare(
      'UPDATE memories SET activation_score = 0.05 WHERE memory_id = ?',
    ).run(m1.memoryId);

    const result = await engine.compress('user-1');

    expect(result.compressed).toBe(0);
    expect(result.removed).toBe(0);

    // Original should still be latest
    const orig = await engine.getById(m1.memoryId);
    expect(orig!.isLatest).toBe(true);
  });

  it('compressed memory has compressedFrom set', async () => {
    const m1 = await engine.store(
      makeInput({ content: 'Cold fact X', namespace: 'test' }),
    );
    const m2 = await engine.store(
      makeInput({ content: 'Cold fact Y', namespace: 'test' }),
    );

    await engine.setTier(m1.memoryId, 'cold');
    await engine.setTier(m2.memoryId, 'cold');

    const testEngine = engine as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } };
    testEngine.db.prepare(
      'UPDATE memories SET activation_score = 0.05 WHERE memory_id IN (?, ?)',
    ).run(m1.memoryId, m2.memoryId);

    await engine.compress('user-1');

    // Find the compressed memory (it will be the latest one with compressedFrom set)
    const wm = await engine.workingMemory('user-1', 10000);
    const compressed = wm.find(m => m.compressedFrom != null);

    expect(compressed).toBeDefined();
    expect(compressed!.compressedFrom).toBe(m1.memoryId);
    expect(compressed!.tier).toBe('cold');
  });

  it('does not affect memories from other users', async () => {
    const m1 = await engine.store(
      makeInput({ userId: 'user-1', content: 'User1 cold A', namespace: 'ns' }),
    );
    const m2 = await engine.store(
      makeInput({ userId: 'user-1', content: 'User1 cold B', namespace: 'ns' }),
    );
    const m3 = await engine.store(
      makeInput({ userId: 'user-2', content: 'User2 cold A', namespace: 'ns' }),
    );

    await engine.setTier(m1.memoryId, 'cold');
    await engine.setTier(m2.memoryId, 'cold');
    await engine.setTier(m3.memoryId, 'cold');

    const testEngine = engine as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } };
    testEngine.db.prepare(
      'UPDATE memories SET activation_score = 0.05 WHERE user_id = ?',
    ).run('user-1');
    testEngine.db.prepare(
      'UPDATE memories SET activation_score = 0.05 WHERE user_id = ?',
    ).run('user-2');

    await engine.compress('user-1');

    // User-2's memory should not be affected
    const user2Mem = await engine.getById(m3.memoryId);
    expect(user2Mem!.isLatest).toBe(true);
  });
});

describe('Phase 4: maintain', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  it('returns maintenance result with counts', async () => {
    await engine.store(makeInput({ content: 'Memory for maintenance' }));

    const result = await engine.maintain('user-1');

    expect(result.activationUpdated).toBe(1);
    expect(typeof result.tiersUpdated).toBe('number');
    expect(typeof result.compressed).toBe('number');
    expect(typeof result.removed).toBe('number');
  });

  it('recomputes activation scores', async () => {
    const memory = await engine.store(makeInput());
    expect(memory.activationScore).toBe(1.0);

    await engine.maintain('user-1');

    const updated = await engine.getById(memory.memoryId);
    // After recomputation, activation may differ from the initial 1.0
    expect(updated!.activationScore).toBeGreaterThanOrEqual(0);
    expect(updated!.activationScore).toBeLessThanOrEqual(1);
  });

  it('does not affect other users', async () => {
    await engine.store(
      makeInput({ userId: 'user-1', content: 'User 1 memory' }),
    );
    const m2 = await engine.store(
      makeInput({ userId: 'user-2', content: 'User 2 memory' }),
    );

    const before = await engine.getById(m2.memoryId);
    await engine.maintain('user-1');
    const after = await engine.getById(m2.memoryId);

    // User-2 memory should be unchanged
    expect(after!.activationScore).toBe(before!.activationScore);
  });

  it('updates tiers for old memories', async () => {
    const memory = await engine.store(makeInput());

    // Manually backdate the learned_at to 60 days ago
    const testEngine = engine as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } };
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 60);
    testEngine.db.prepare(
      'UPDATE memories SET learned_at = ? WHERE memory_id = ?',
    ).run(oldDate.toISOString(), memory.memoryId);

    const result = await engine.maintain('user-1');

    expect(result.tiersUpdated).toBeGreaterThanOrEqual(1);

    const updated = await engine.getById(memory.memoryId);
    expect(updated!.tier).toBe('cold');
  });

  it('hot tier is preserved during maintain', async () => {
    const memory = await engine.store(makeInput());
    await engine.setTier(memory.memoryId, 'hot');

    await engine.maintain('user-1');

    const updated = await engine.getById(memory.memoryId);
    expect(updated!.tier).toBe('hot');
  });

  it('maintains with zero memories does not error', async () => {
    const result = await engine.maintain('user-nonexistent');
    expect(result.activationUpdated).toBe(0);
    expect(result.tiersUpdated).toBe(0);
    expect(result.compressed).toBe(0);
    expect(result.removed).toBe(0);
  });
});

describe('Phase 4: Activation weighting in search', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  it('low activation score reduces search score', async () => {
    const m1 = await engine.store(
      makeInput({
        content: 'High activation database query optimization',
        keywords: ['database', 'optimization'],
      }),
    );
    const m2 = await engine.store(
      makeInput({
        content: 'Low activation database query performance',
        keywords: ['database', 'performance'],
      }),
    );

    // Lower m2 activation
    const testEngine = engine as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } };
    testEngine.db.prepare(
      'UPDATE memories SET activation_score = 0.1 WHERE memory_id = ?',
    ).run(m2.memoryId);

    const response = await engine.search({
      userId: 'user-1',
      query: 'database',
    });

    expect(response.results.length).toBe(2);

    // Find scores for each memory
    const m1Result = response.results.find(r => r.memory.memoryId === m1.memoryId);
    const m2Result = response.results.find(r => r.memory.memoryId === m2.memoryId);

    expect(m1Result).toBeDefined();
    expect(m2Result).toBeDefined();
    // m1 (high activation) should have higher final score
    expect(m1Result!.score).toBeGreaterThan(m2Result!.score);
  });
});
