import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteMemoryEngine } from '../src/engine.js';
import { ensureSchema } from '../src/schema.js';
import { createPreparedStatements, storeMemory } from '../src/store.js';
import { buildSearchSql } from '../src/search.js';
import { deriveMemoryState } from '../src/utils.js';
import type { MemoryInput, SearchQuery } from '@memrosetta/types';

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
// Phase 2c: quality() method
// ---------------------------------------------------------------------------

describe('quality()', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  it('returns all zeros for user with no memories', async () => {
    const q = await engine.quality('user-nonexistent');
    expect(q.total).toBe(0);
    expect(q.fresh).toBe(0);
    expect(q.invalidated).toBe(0);
    expect(q.superseded).toBe(0);
    expect(q.withRelations).toBe(0);
    expect(q.avgActivation).toBe(0);
  });

  it('counts fresh memories correctly', async () => {
    await engine.store(makeInput({ content: 'Memory A about coding' }));
    await engine.store(makeInput({ content: 'Memory B about design' }));

    const q = await engine.quality('user-1');
    expect(q.total).toBe(2);
    expect(q.fresh).toBe(2);
    expect(q.invalidated).toBe(0);
    expect(q.superseded).toBe(0);
  });

  it('counts invalidated memories correctly', async () => {
    const m1 = await engine.store(makeInput({ content: 'Valid memory' }));
    const m2 = await engine.store(makeInput({ content: 'Will be invalidated' }));

    await engine.invalidate(m2.memoryId);

    const q = await engine.quality('user-1');
    expect(q.total).toBe(2);
    expect(q.fresh).toBe(1);
    expect(q.invalidated).toBe(1);
  });

  it('counts superseded memories correctly', async () => {
    const m1 = await engine.store(
      makeInput({ content: 'Old rate pricing', keywords: ['rate'] }),
    );
    const m2 = await engine.store(
      makeInput({ content: 'New rate pricing', keywords: ['rate'] }),
    );

    await engine.relate(m2.memoryId, m1.memoryId, 'updates');

    const q = await engine.quality('user-1');
    expect(q.total).toBe(2);
    expect(q.superseded).toBe(1);
    // fresh = is_latest=1 AND invalidated_at IS NULL -> only m2
    expect(q.fresh).toBe(1);
  });

  it('counts memories with relations', async () => {
    const m1 = await engine.store(
      makeInput({ content: 'Base fact about TypeScript', keywords: ['base'] }),
    );
    const m2 = await engine.store(
      makeInput({ content: 'Extended detail about TypeScript', keywords: ['detail'] }),
    );
    const m3 = await engine.store(
      makeInput({ content: 'Standalone fact about Python', keywords: ['python'] }),
    );

    await engine.relate(m2.memoryId, m1.memoryId, 'extends');

    const q = await engine.quality('user-1');
    expect(q.withRelations).toBe(2); // m1 and m2 involved in relation
  });

  it('computes average activation for latest memories', async () => {
    await engine.store(makeInput({ content: 'Memory for activation check' }));

    const q = await engine.quality('user-1');
    // Default activation is 1.0
    expect(q.avgActivation).toBeCloseTo(1.0);
  });

  it('does not count other users', async () => {
    await engine.store(makeInput({ userId: 'user-1', content: 'User1 memory' }));
    await engine.store(makeInput({ userId: 'user-2', content: 'User2 memory' }));

    const q = await engine.quality('user-1');
    expect(q.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 3a: deriveMemoryState
// ---------------------------------------------------------------------------

describe('deriveMemoryState', () => {
  it('returns current for latest non-invalidated memory', () => {
    const state = deriveMemoryState({
      memoryId: 'test',
      userId: 'user-1',
      memoryType: 'fact',
      content: 'test',
      learnedAt: new Date().toISOString(),
      isLatest: true,
      tier: 'warm',
      activationScore: 1.0,
      accessCount: 0,
      useCount: 0,
      successCount: 0,
    });
    expect(state).toBe('current');
  });

  it('returns superseded for non-latest memory', () => {
    const state = deriveMemoryState({
      memoryId: 'test',
      userId: 'user-1',
      memoryType: 'fact',
      content: 'test',
      learnedAt: new Date().toISOString(),
      isLatest: false,
      tier: 'warm',
      activationScore: 1.0,
      accessCount: 0,
      useCount: 0,
      successCount: 0,
    });
    expect(state).toBe('superseded');
  });

  it('returns invalidated when invalidatedAt is set', () => {
    const state = deriveMemoryState({
      memoryId: 'test',
      userId: 'user-1',
      memoryType: 'fact',
      content: 'test',
      learnedAt: new Date().toISOString(),
      isLatest: true,
      invalidatedAt: new Date().toISOString(),
      tier: 'warm',
      activationScore: 1.0,
      accessCount: 0,
      useCount: 0,
      successCount: 0,
    });
    expect(state).toBe('invalidated');
  });

  it('invalidated takes precedence over superseded', () => {
    const state = deriveMemoryState({
      memoryId: 'test',
      userId: 'user-1',
      memoryType: 'fact',
      content: 'test',
      learnedAt: new Date().toISOString(),
      isLatest: false,
      invalidatedAt: new Date().toISOString(),
      tier: 'warm',
      activationScore: 1.0,
      accessCount: 0,
      useCount: 0,
      successCount: 0,
    });
    expect(state).toBe('invalidated');
  });
});

// ---------------------------------------------------------------------------
// Phase 3b: Search with states filter
// ---------------------------------------------------------------------------

describe('Search with states filter', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  it('states=["current"] returns only current memories (default behavior)', async () => {
    const m1 = await engine.store(
      makeInput({ content: 'Current programming fact', keywords: ['programming'] }),
    );
    const m2 = await engine.store(
      makeInput({ content: 'Old programming fact', keywords: ['programming'] }),
    );

    await engine.relate(m1.memoryId, m2.memoryId, 'updates');

    const response = await engine.search({
      userId: 'user-1',
      query: 'programming',
      filters: { states: ['current'] },
    });

    const ids = response.results.map(r => r.memory.memoryId);
    expect(ids).toContain(m1.memoryId);
    expect(ids).not.toContain(m2.memoryId);
  });

  it('states=["superseded"] returns only superseded memories', async () => {
    const m1 = await engine.store(
      makeInput({ content: 'Current development fact', keywords: ['development'] }),
    );
    const m2 = await engine.store(
      makeInput({ content: 'Old development fact', keywords: ['development'] }),
    );

    await engine.relate(m1.memoryId, m2.memoryId, 'updates');

    const response = await engine.search({
      userId: 'user-1',
      query: 'development',
      filters: { states: ['superseded'] },
    });

    const ids = response.results.map(r => r.memory.memoryId);
    expect(ids).toContain(m2.memoryId);
    expect(ids).not.toContain(m1.memoryId);
  });

  it('states=["invalidated"] returns only invalidated memories', async () => {
    const m1 = await engine.store(
      makeInput({ content: 'Valid engineering fact', keywords: ['engineering'] }),
    );
    const m2 = await engine.store(
      makeInput({ content: 'Invalid engineering fact', keywords: ['engineering'] }),
    );

    await engine.invalidate(m2.memoryId);

    const response = await engine.search({
      userId: 'user-1',
      query: 'engineering',
      filters: { states: ['invalidated'] },
    });

    const ids = response.results.map(r => r.memory.memoryId);
    expect(ids).toContain(m2.memoryId);
    expect(ids).not.toContain(m1.memoryId);
  });

  it('states=["current", "superseded"] includes both', async () => {
    const m1 = await engine.store(
      makeInput({ content: 'Current architecture fact', keywords: ['architecture'] }),
    );
    const m2 = await engine.store(
      makeInput({ content: 'Old architecture fact', keywords: ['architecture'] }),
    );

    await engine.relate(m1.memoryId, m2.memoryId, 'updates');

    const response = await engine.search({
      userId: 'user-1',
      query: 'architecture',
      filters: { states: ['current', 'superseded'] },
    });

    const ids = response.results.map(r => r.memory.memoryId);
    expect(ids).toContain(m1.memoryId);
    expect(ids).toContain(m2.memoryId);
  });

  it('states supersedes onlyLatest and excludeInvalidated', async () => {
    const m1 = await engine.store(
      makeInput({ content: 'Active system fact', keywords: ['system'] }),
    );
    const m2 = await engine.store(
      makeInput({ content: 'Obsolete system fact', keywords: ['system'] }),
    );

    await engine.invalidate(m2.memoryId);

    // states includes invalidated, even though excludeInvalidated would be true by default
    const response = await engine.search({
      userId: 'user-1',
      query: 'system',
      filters: { states: ['invalidated'], onlyLatest: true, excludeInvalidated: true },
    });

    const ids = response.results.map(r => r.memory.memoryId);
    expect(ids).toContain(m2.memoryId);
  });
});

// ---------------------------------------------------------------------------
// Phase 3b: buildSearchSql states filter (unit)
// ---------------------------------------------------------------------------

describe('buildSearchSql states filter', () => {
  it('generates state conditions when states is set', () => {
    const query: SearchQuery = {
      userId: 'user1',
      query: 'test',
      filters: { states: ['current', 'superseded'] },
    };
    const { sql } = buildSearchSql(query);

    expect(sql).toContain('m.is_latest = 1 AND m.invalidated_at IS NULL');
    expect(sql).toContain('m.is_latest = 0');
    // Should NOT contain the legacy onlyLatest clause outside states
    expect(sql).not.toMatch(/AND m\.is_latest = 1[^)]/);
  });

  it('falls back to legacy behavior when states is not set', () => {
    const query: SearchQuery = {
      userId: 'user1',
      query: 'test',
      filters: { onlyLatest: true },
    };
    const { sql } = buildSearchSql(query);

    // Legacy behavior
    expect(sql).toContain('m.is_latest = 1');
    expect(sql).toContain('m.invalidated_at IS NULL');
  });

  it('generates invalidated state condition', () => {
    const query: SearchQuery = {
      userId: 'user1',
      query: 'test',
      filters: { states: ['invalidated'] },
    };
    const { sql } = buildSearchSql(query);

    expect(sql).toContain('m.invalidated_at IS NOT NULL');
  });
});

// ---------------------------------------------------------------------------
// Phase 3c: Auto-supersede on 'updates' relation (already implemented, verify)
// ---------------------------------------------------------------------------

describe('Auto-supersede on updates relation', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  it('relate(updates) sets dst memory isLatest=false', async () => {
    const old = await engine.store(
      makeInput({ content: 'Old pricing rate info', keywords: ['pricing'] }),
    );
    const updated = await engine.store(
      makeInput({ content: 'New pricing rate info', keywords: ['pricing'] }),
    );

    expect(old.isLatest).toBe(true);

    await engine.relate(updated.memoryId, old.memoryId, 'updates');

    const oldAfter = await engine.getById(old.memoryId);
    expect(oldAfter!.isLatest).toBe(false);

    const updatedAfter = await engine.getById(updated.memoryId);
    expect(updatedAfter!.isLatest).toBe(true);
  });

  it('relate(extends) does NOT change isLatest', async () => {
    const base = await engine.store(
      makeInput({ content: 'Base coding fact', keywords: ['coding'] }),
    );
    const extension = await engine.store(
      makeInput({ content: 'Extended coding detail', keywords: ['detail'] }),
    );

    await engine.relate(extension.memoryId, base.memoryId, 'extends');

    const baseAfter = await engine.getById(base.memoryId);
    expect(baseAfter!.isLatest).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 4a: Auto-create extends relations on store
// ---------------------------------------------------------------------------

describe('Auto-relate on store (keyword overlap)', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  it('auto-creates extends relation for 2+ shared keywords', async () => {
    const m1 = await engine.store(
      makeInput({
        content: 'React hooks use state management patterns',
        keywords: ['react', 'hooks', 'state', 'patterns'],
      }),
    );
    const m2 = await engine.store(
      makeInput({
        content: 'Custom React hooks for state patterns',
        keywords: ['react', 'hooks', 'custom'],
      }),
    );

    const relations = await engine.getRelations(m2.memoryId);
    const extends_ = relations.filter(
      r => r.relationType === 'extends' && r.srcMemoryId === m2.memoryId && r.dstMemoryId === m1.memoryId,
    );

    expect(extends_.length).toBe(1);
    expect(extends_[0].reason).toContain('shared keywords');
  });

  it('does not auto-create relation for fewer than 2 shared keywords', async () => {
    const m1 = await engine.store(
      makeInput({
        content: 'TypeScript language features',
        keywords: ['typescript', 'language'],
      }),
    );
    const m2 = await engine.store(
      makeInput({
        content: 'JavaScript language features',
        keywords: ['javascript', 'language'],
      }),
    );

    const relations = await engine.getRelations(m2.memoryId);
    const autoExtends = relations.filter(
      r => r.relationType === 'extends' && r.reason?.includes('shared keywords'),
    );

    expect(autoExtends.length).toBe(0);
  });

  it('does not auto-create relation when no keywords', async () => {
    await engine.store(
      makeInput({
        content: 'Memory without keywords A',
        keywords: undefined,
      }),
    );
    const m2 = await engine.store(
      makeInput({
        content: 'Memory without keywords B',
        keywords: undefined,
      }),
    );

    const relations = await engine.getRelations(m2.memoryId);
    const autoExtends = relations.filter(
      r => r.relationType === 'extends' && r.reason?.includes('shared keywords'),
    );

    expect(autoExtends.length).toBe(0);
  });

  it('does not create duplicate relation if one already exists', async () => {
    const m1 = await engine.store(
      makeInput({
        content: 'Vue.js component lifecycle hooks patterns',
        keywords: ['vue', 'component', 'lifecycle', 'hooks'],
      }),
    );
    const m2 = await engine.store(
      makeInput({
        content: 'Vue.js component lifecycle management hooks',
        keywords: ['vue', 'component', 'lifecycle', 'management'],
      }),
    );

    // autoRelate should have created one extends relation
    const relations = await engine.getRelations(m2.memoryId);
    const extends_ = relations.filter(
      r => r.relationType === 'extends',
    );

    expect(extends_.length).toBe(1);
  });

  it('skips autoRelate for different users', async () => {
    await engine.store(
      makeInput({
        userId: 'user-1',
        content: 'Database query optimization techniques indexes',
        keywords: ['database', 'query', 'optimization', 'indexes'],
      }),
    );
    const m2 = await engine.store(
      makeInput({
        userId: 'user-2',
        content: 'Database query optimization performance indexes',
        keywords: ['database', 'query', 'optimization', 'indexes'],
      }),
    );

    const relations = await engine.getRelations(m2.memoryId);
    const autoExtends = relations.filter(
      r => r.relationType === 'extends' && r.reason?.includes('shared keywords'),
    );

    expect(autoExtends.length).toBe(0);
  });

  it('checks beyond the most recent 10 memories', async () => {
    const base = await engine.store(
      makeInput({
        content: 'Hermes GitHub repository link and issue tracker',
        keywords: ['hermes', 'github', 'repo'],
      }),
    );

    for (let i = 0; i < 15; i++) {
      await engine.store(
        makeInput({
          content: `Filler memory ${i}`,
          keywords: [`filler-${i}`],
        }),
      );
    }

    const related = await engine.store(
      makeInput({
        content: 'Hermes GitHub repo discussion and docs',
        keywords: ['hermes', 'github', 'docs'],
      }),
    );

    const relations = await engine.getRelations(related.memoryId);
    expect(
      relations.some(
        (relation) => relation.relationType === 'extends' && relation.dstMemoryId === base.memoryId,
      ),
    ).toBe(true);
  });

  // v0.11: cosine-similarity autoRelate branch removed with the HF
  // embedder. Keyword overlap (>=2 shared keywords) is now the only
  // trigger for automatic `extends` relations.
});
