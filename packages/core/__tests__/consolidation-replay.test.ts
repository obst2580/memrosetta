import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteMemoryEngine } from '../src/engine.js';
import { recordCoAccess } from '../src/coaccess.js';
import type { MemoryInput } from '@memrosetta/types';

function makeInput(overrides: Partial<MemoryInput> = {}): MemoryInput {
  return {
    userId: 'u1',
    memoryType: 'fact',
    content: 'baseline memory',
    keywords: ['baseline'],
    ...overrides,
  };
}

function bindPairToRecentEpisode(
  db: Database.Database,
  memoryAId: string,
  memoryBId: string,
  userId = 'u1',
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO episodes (episode_id, user_id, started_at)
    VALUES (?, ?, ?)
  `).run('ep-replay', userId, now);
  db.prepare(`
    INSERT INTO memory_episodic_bindings (memory_id, episode_id, binding_strength)
    VALUES (?, ?, 1.0)
  `).run(memoryAId, 'ep-replay');
  db.prepare(`
    INSERT INTO memory_episodic_bindings (memory_id, episode_id, binding_strength)
    VALUES (?, ?, 1.0)
  `).run(memoryBId, 'ep-replay');
}

describe('replay-based relation discovery', () => {
  let engine: SqliteMemoryEngine;

  afterEach(async () => {
    await engine.close();
  });

  describe('with Layer B consolidation enabled', () => {
    beforeEach(async () => {
      engine = new SqliteMemoryEngine({
        dbPath: ':memory:',
        layerB: { enableConsolidation: true },
      });
      await engine.initialize();
    });

    it('creates deterministic relations from replayed co-access pairs', async () => {
      const tool = await engine.store(
        makeInput({
          content: 'SQLite durable local database engine',
          keywords: ['sqlite'],
        }),
      );
      const usage = await engine.store(
        makeInput({
          content: 'MemRosetta uses SQLite for durable queue storage',
          keywords: ['memrosetta'],
        }),
      );
      const db = engine.rawDatabase()!;
      bindPairToRecentEpisode(db, tool.memoryId, usage.memoryId);
      recordCoAccess(db, [tool.memoryId, usage.memoryId]);
      recordCoAccess(db, [tool.memoryId, usage.memoryId]);

      const result = await engine.runConsolidation('u1');
      const relations = await engine.getRelations(usage.memoryId);

      expect(result.done).toBeGreaterThanOrEqual(1);
      expect(relations).toContainEqual(
        expect.objectContaining({
          srcMemoryId: usage.memoryId,
          dstMemoryId: tool.memoryId,
          relationType: 'uses',
          reason: expect.stringContaining('consolidation_replay;'),
        }),
      );
    });

    it('skips replay pairs that already have an explicit relation', async () => {
      const tool = await engine.store(makeInput({ content: 'SQLite database', keywords: ['sqlite'] }));
      const usage = await engine.store(
        makeInput({ content: 'MemRosetta uses SQLite', keywords: ['memrosetta'] }),
      );
      await engine.relate(usage.memoryId, tool.memoryId, 'uses', 'manual');
      const db = engine.rawDatabase()!;
      bindPairToRecentEpisode(db, tool.memoryId, usage.memoryId);
      recordCoAccess(db, [tool.memoryId, usage.memoryId]);
      recordCoAccess(db, [tool.memoryId, usage.memoryId]);

      await engine.runConsolidation('u1');
      const relations = await engine.getRelations(usage.memoryId);

      expect(relations.filter((r) => r.relationType === 'uses')).toHaveLength(1);
      expect(relations[0].reason).toBe('manual');
    });

    it('skips replay pairs below the co-access threshold', async () => {
      const tool = await engine.store(makeInput({ content: 'SQLite database', keywords: ['sqlite'] }));
      const usage = await engine.store(
        makeInput({ content: 'MemRosetta uses SQLite', keywords: ['memrosetta'] }),
      );
      const db = engine.rawDatabase()!;
      bindPairToRecentEpisode(db, tool.memoryId, usage.memoryId);
      recordCoAccess(db, [tool.memoryId, usage.memoryId]);

      await engine.runConsolidation('u1');
      const relations = await engine.getRelations(usage.memoryId);

      expect(relations).toHaveLength(0);
    });

    it('splits relation discovery work after 100 pairs', async () => {
      const source = await engine.store(
        makeInput({
          content: 'MemRosetta uses SQLite for replay graph discovery',
          keywords: ['source'],
        }),
      );
      const targets = [];
      for (let i = 0; i < 101; i++) {
        targets.push(
          await engine.store(
            makeInput({
              content: `target memory ${i}`,
              keywords: [`target-${i}`],
            }),
          ),
        );
      }

      const db = engine.rawDatabase()!;
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO episodes (episode_id, user_id, started_at)
        VALUES (?, ?, ?)
      `).run('ep-many', 'u1', now);
      db.prepare(`
        INSERT INTO memory_episodic_bindings (memory_id, episode_id, binding_strength)
        VALUES (?, ?, 1.0)
      `).run(source.memoryId, 'ep-many');

      for (const target of targets) {
        db.prepare(`
          INSERT INTO memory_episodic_bindings (memory_id, episode_id, binding_strength)
          VALUES (?, ?, 1.0)
        `).run(target.memoryId, 'ep-many');
        recordCoAccess(db, [source.memoryId, target.memoryId]);
        recordCoAccess(db, [source.memoryId, target.memoryId]);
      }

      engine.consolidation.clear();
      await engine.runConsolidation('u1', { limit: 1 });

      expect(engine.consolidation.pending('maintenance')).toHaveLength(1);
      expect(await engine.getRelations(source.memoryId)).toHaveLength(100);
    });

    it('reports recent orphan metrics', async () => {
      const orphanA = await engine.store(makeInput({ content: 'orphan A', keywords: ['a'] }));
      await engine.store(makeInput({ content: 'orphan B', keywords: ['b'] }));
      const related = await engine.store(makeInput({ content: 'related', keywords: ['c'] }));
      await engine.relate(related.memoryId, orphanA.memoryId, 'extends');

      const result = await engine.runConsolidation('u1');

      expect(result.orphanRecent).toBe(1);
      expect(result.orphanRatio).toBeCloseTo(1 / 3);
    });
  });

  it('does not enqueue relation discovery when Layer B consolidation is disabled', async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();

    const result = await engine.runConsolidation('u1');

    expect(result.processed).toBe(0);
    expect(engine.consolidation.pending('maintenance')).toHaveLength(0);
  });
});
