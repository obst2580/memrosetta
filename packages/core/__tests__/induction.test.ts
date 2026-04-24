import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteMemoryEngine } from '../src/engine.js';
import type { MemoryInput } from '@memrosetta/types';
import { findPrototypeCandidates } from '../src/induction.js';

function memory(overrides: Partial<MemoryInput>): MemoryInput {
  return {
    userId: 'u1',
    memoryType: 'preference',
    content: 'Prefer OAuth2 PKCE for auth',
    keywords: ['auth'],
    ...overrides,
  };
}

describe('prototype induction', () => {
  let engine: SqliteMemoryEngine;

  afterEach(async () => {
    await engine.close();
  });

  it('identifies keyword clusters with a dominant deterministic pattern', async () => {
    engine = new SqliteMemoryEngine({
      dbPath: ':memory:',
      layerB: { enableConsolidation: true },
    });
    await engine.initialize();

    for (let i = 0; i < 5; i += 1) {
      await engine.store(memory({ content: `Prefer OAuth2 PKCE for auth flow ${i}` }));
    }

    const candidates = findPrototypeCandidates(engine.rawDatabase()!, {
      userId: 'u1',
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(
      expect.objectContaining({
        keyword: 'auth',
        verb: 'prefer',
        object: 'oauth2 pkce',
      }),
    );
  });

  it('creates a prototype memory and derives relations from originals', async () => {
    engine = new SqliteMemoryEngine({
      dbPath: ':memory:',
      layerB: { enableConsolidation: true },
    });
    await engine.initialize();

    const originals = [];
    for (let i = 0; i < 5; i += 1) {
      originals.push(
        await engine.store(memory({ content: `Prefer OAuth2 PKCE for auth flow ${i}` })),
      );
    }

    engine.consolidation.clear();
    const result = await engine.runConsolidation('u1', { limit: 1 });
    const db = engine.rawDatabase()!;
    const prototypes = db
      .prepare("SELECT memory_id, content, salience FROM memories WHERE source_id = 'induction'")
      .all() as readonly { memory_id: string; content: string; salience: number }[];
    const relations = await engine.getRelations(prototypes[0].memory_id);

    expect(result.done).toBe(1);
    expect(prototypes).toHaveLength(1);
    expect(prototypes[0].content).toContain('Prototype: For auth');
    expect(prototypes[0].salience).toBe(0.7);
    expect(relations.filter((r) => r.relationType === 'derives')).toHaveLength(5);
    expect(relations).toContainEqual(
      expect.objectContaining({
        srcMemoryId: prototypes[0].memory_id,
        dstMemoryId: originals[0].memoryId,
        relationType: 'derives',
        reason: 'induction_prototype',
      }),
    );
  });

  it('skips duplicate prototype cluster signatures', async () => {
    engine = new SqliteMemoryEngine({
      dbPath: ':memory:',
      layerB: { enableConsolidation: true },
    });
    await engine.initialize();

    for (let i = 0; i < 5; i += 1) {
      await engine.store(memory({ content: `Prefer OAuth2 PKCE for auth flow ${i}` }));
    }

    engine.consolidation.clear();
    await engine.runConsolidation('u1', { limit: 1 });
    await engine.runConsolidation('u1', { limit: 1 });

    const row = engine
      .rawDatabase()!
      .prepare("SELECT COUNT(*) AS count FROM memories WHERE source_id = 'induction'")
      .get() as { count: number };
    expect(row.count).toBe(1);
  });

  it('does not enqueue prototype induction when Layer B consolidation is disabled', async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();

    for (let i = 0; i < 5; i += 1) {
      await engine.store(memory({ content: `Prefer OAuth2 PKCE for auth flow ${i}` }));
    }

    const result = await engine.runConsolidation('u1');

    expect(result.processed).toBe(0);
    expect(engine.consolidation.pending('abstraction')).toHaveLength(0);
  });
});
