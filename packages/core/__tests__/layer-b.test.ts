import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { MemoryInput } from '@memrosetta/types';
import { ensureSchema } from '../src/schema.js';
import {
  createPreparedStatements,
  storeMemory,
} from '../src/store.js';
import type { PreparedStatements } from '../src/store.js';
import {
  createConstructStatements,
  upsertMemoryConstruct,
  getMemoryConstruct,
  listConstructsByAbstraction,
  linkConstructExemplar,
  getConstructExemplars,
  getConstructsForExemplar,
  recordConstructReuse,
} from '../src/constructs.js';
import type { ConstructStatements } from '../src/constructs.js';
import { computeNoveltyScore } from '../src/novelty.js';
import {
  classifyAsExemplar,
  applyPatternSeparationOutcomes,
} from '../src/pattern-separation.js';
import { ConsolidationQueue } from '../src/consolidation.js';

describe('Layer B scaffolding (v4 flag-gated components)', () => {
  let db: Database.Database;
  let stmts: PreparedStatements;
  let cons: ConstructStatements;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureSchema(db);
    stmts = createPreparedStatements(db);
    cons = createConstructStatements(db);
  });

  afterEach(() => {
    db.close();
  });

  const base: MemoryInput = {
    userId: 'user-1',
    memoryType: 'fact',
    content: 'Layer B smoke test memory',
  };

  describe('schema', () => {
    it('creates memory_constructs + construct_exemplars tables', () => {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('memory_constructs','construct_exemplars')",
        )
        .all() as readonly { name: string }[];
      expect(tables.map((t) => t.name).sort()).toEqual([
        'construct_exemplars',
        'memory_constructs',
      ]);
    });

    it('advances schema_version to at least 15', () => {
      const row = db.prepare('SELECT version FROM schema_version').get() as {
        version: number;
      };
      expect(row.version).toBeGreaterThanOrEqual(15);
    });

    it('enforces abstraction_level BETWEEN 1 AND 5', () => {
      const m = storeMemory(db, stmts, base);
      expect(() =>
        db.prepare(
          `INSERT INTO memory_constructs
             (memory_id, canonical_form, abstraction_level, last_reindex_at)
           VALUES (?, ?, ?, ?)`,
        ).run(m.memoryId, 'x', 6, new Date().toISOString()),
      ).toThrow();
    });

    it('enforces exemplar_role enum', () => {
      const m1 = storeMemory(db, stmts, base);
      const m2 = storeMemory(db, stmts, { ...base, content: 'other' });
      upsertMemoryConstruct(cons, { memoryId: m1.memoryId, canonicalForm: 'c1' });
      expect(() =>
        db.prepare(
          `INSERT INTO construct_exemplars
             (construct_memory_id, exemplar_memory_id, exemplar_role, created_at)
           VALUES (?, ?, ?, ?)`,
        ).run(m1.memoryId, m2.memoryId, 'neutral', new Date().toISOString()),
      ).toThrow();
    });
  });

  describe('memory_constructs CRUD', () => {
    it('upserts and retrieves a construct', () => {
      const m = storeMemory(db, stmts, base);
      const c = upsertMemoryConstruct(cons, {
        memoryId: m.memoryId,
        canonicalForm: 'code review prompt',
        slots: [
          {
            name: 'language',
            value: 'typescript',
            confidence: 0.9,
            evidenceMemoryIds: [m.memoryId],
          },
        ],
        antiPatterns: [{ description: 'asking the model to guess types' }],
        abstractionLevel: 4,
        constructConfidence: 0.85,
      });

      expect(c.canonicalForm).toBe('code review prompt');
      expect(c.abstractionLevel).toBe(4);
      expect(c.slots?.[0].name).toBe('language');
      expect(c.antiPatterns?.[0].description).toContain('guess types');

      const fetched = getMemoryConstruct(cons, m.memoryId);
      expect(fetched?.canonicalForm).toBe('code review prompt');
    });

    it('listConstructsByAbstraction filters by level', () => {
      const m1 = storeMemory(db, stmts, base);
      const m2 = storeMemory(db, stmts, { ...base, content: 'other' });
      upsertMemoryConstruct(cons, {
        memoryId: m1.memoryId,
        canonicalForm: 'abstract principle',
        abstractionLevel: 5,
      });
      upsertMemoryConstruct(cons, {
        memoryId: m2.memoryId,
        canonicalForm: 'concrete example',
        abstractionLevel: 1,
      });
      expect(listConstructsByAbstraction(cons, 5)).toHaveLength(1);
      expect(listConstructsByAbstraction(cons, 1)).toHaveLength(1);
      expect(listConstructsByAbstraction(cons, 3)).toHaveLength(0);
    });

    it('recordConstructReuse increments counters', () => {
      const m = storeMemory(db, stmts, base);
      upsertMemoryConstruct(cons, { memoryId: m.memoryId, canonicalForm: 'x' });
      recordConstructReuse(cons, m.memoryId, true);
      recordConstructReuse(cons, m.memoryId, false);
      const c = getMemoryConstruct(cons, m.memoryId)!;
      expect(c.reuseCount).toBe(2);
      expect(c.reuseSuccessCount).toBe(1);
    });
  });

  describe('construct_exemplars', () => {
    it('links an exemplar and retrieves both ways', () => {
      const c = storeMemory(db, stmts, { ...base, content: 'construct' });
      const ex = storeMemory(db, stmts, { ...base, content: 'exemplar' });
      upsertMemoryConstruct(cons, { memoryId: c.memoryId, canonicalForm: 'c' });

      linkConstructExemplar(cons, {
        constructMemoryId: c.memoryId,
        exemplarMemoryId: ex.memoryId,
        exemplarRole: 'positive',
        supportScore: 0.82,
      });

      const exemplars = getConstructExemplars(cons, c.memoryId);
      expect(exemplars).toHaveLength(1);
      expect(exemplars[0].exemplarRole).toBe('positive');
      expect(exemplars[0].supportScore).toBeCloseTo(0.82);

      const constructsByEx = getConstructsForExemplar(cons, ex.memoryId);
      expect(constructsByEx).toHaveLength(1);
      expect(constructsByEx[0].memoryId).toBe(c.memoryId);
    });

    it('duplicate role upsert updates support_score', () => {
      const c = storeMemory(db, stmts, { ...base, content: 'c' });
      const ex = storeMemory(db, stmts, { ...base, content: 'ex' });
      upsertMemoryConstruct(cons, { memoryId: c.memoryId, canonicalForm: 'x' });

      linkConstructExemplar(cons, {
        constructMemoryId: c.memoryId,
        exemplarMemoryId: ex.memoryId,
        exemplarRole: 'positive',
        supportScore: 0.5,
      });
      linkConstructExemplar(cons, {
        constructMemoryId: c.memoryId,
        exemplarMemoryId: ex.memoryId,
        exemplarRole: 'positive',
        supportScore: 0.9,
      });

      const exemplars = getConstructExemplars(cons, c.memoryId);
      expect(exemplars).toHaveLength(1);
      expect(exemplars[0].supportScore).toBeCloseTo(0.9);
    });
  });

  describe('computeNoveltyScore', () => {
    it('returns score=1 for a user with no prior memories', () => {
      const novelty = computeNoveltyScore(db, {
        userId: 'user-1',
        content: 'brand new concept never seen before',
      });
      expect(novelty.score).toBe(1);
      expect(novelty.neighborCount).toBe(0);
    });

    it('returns a lower score for near-duplicates', () => {
      storeMemory(db, stmts, {
        ...base,
        content: 'sqlite is the default storage engine for memrosetta',
      });
      const novelty = computeNoveltyScore(db, {
        userId: 'user-1',
        content: 'sqlite is the default storage engine for memrosetta',
      });
      expect(novelty.score).toBeLessThan(0.5);
      expect(novelty.neighborCount).toBeGreaterThan(0);
    });

    it('treats unrelated text as novel even with some corpus present', () => {
      storeMemory(db, stmts, {
        ...base,
        content: 'unrelated weather observation',
      });
      const novelty = computeNoveltyScore(db, {
        userId: 'user-1',
        content: 'quantum chromodynamics asymptotic freedom',
      });
      expect(novelty.score).toBeGreaterThan(0.5);
    });
  });

  describe('pattern separation', () => {
    it('classifies near-duplicates as positive exemplars', () => {
      storeMemory(db, stmts, {
        ...base,
        content: 'typescript review prompt emphasising types',
      });
      const c = storeMemory(db, stmts, { ...base, content: 'anchor construct' });
      upsertMemoryConstruct(cons, { memoryId: c.memoryId, canonicalForm: 'ts review' });

      const newMemory = storeMemory(db, stmts, {
        ...base,
        content: 'typescript review prompt emphasising types',
      });
      const outcomes = classifyAsExemplar({
        db,
        constructStmts: cons,
        userId: 'user-1',
        memoryId: newMemory.memoryId,
        content: 'typescript review prompt emphasising types',
        candidateConstructs: [c.memoryId],
        positiveThreshold: 0.4,
        edgeCaseThreshold: 0.75,
      });
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].role).toBe('positive');
    });

    it('classifies novel-enough variants as edge cases', () => {
      const c = storeMemory(db, stmts, { ...base, content: 'anchor' });
      upsertMemoryConstruct(cons, { memoryId: c.memoryId, canonicalForm: 'anchor' });
      const newMemory = storeMemory(db, stmts, {
        ...base,
        content: 'entirely different topic about astrophysics',
      });
      const outcomes = classifyAsExemplar({
        db,
        constructStmts: cons,
        userId: 'user-1',
        memoryId: newMemory.memoryId,
        content: 'entirely different topic about astrophysics',
        candidateConstructs: [c.memoryId],
        positiveThreshold: 0.4,
        edgeCaseThreshold: 0.7,
      });
      expect(outcomes[0].role).toBe('edge_case');
    });

    it('applyPatternSeparationOutcomes writes links', () => {
      const c = storeMemory(db, stmts, { ...base, content: 'c' });
      const ex = storeMemory(db, stmts, { ...base, content: 'ex' });
      upsertMemoryConstruct(cons, { memoryId: c.memoryId, canonicalForm: 'x' });

      applyPatternSeparationOutcomes(cons, ex.memoryId, [
        {
          constructMemoryId: c.memoryId,
          role: 'positive',
          noveltyScore: 0.2,
          explanation: 'close duplicate',
        },
      ]);

      expect(getConstructExemplars(cons, c.memoryId)).toHaveLength(1);
    });
  });

  describe('ConsolidationQueue', () => {
    it('enqueues abstraction jobs into the abstraction subqueue', () => {
      const q = new ConsolidationQueue(db);
      q.enqueue({ kind: 'gist_refinement', payload: { memoryId: 'm1' } });
      q.enqueue({ kind: 'novelty_rescoring', payload: {} });
      expect(q.pending('abstraction').length).toBe(1);
      expect(q.pending('maintenance').length).toBe(1);
      expect(q.size()).toBe(2);
    });

    it('runNext executes registered handler and marks completed', async () => {
      const q = new ConsolidationQueue(db);
      const calls: string[] = [];
      q.register('gist_refinement', async (_db, job) => {
        calls.push(job.id);
      });
      q.enqueue({ kind: 'gist_refinement', payload: { memoryId: 'm1' } });
      const done = await q.runNext(db, 'abstraction');
      expect(done?.status).toBe('done');
      expect(calls).toHaveLength(1);
    });

    it('runNext marks job failed when handler throws', async () => {
      const q = new ConsolidationQueue(db);
      q.register('gist_refinement', async () => {
        throw new Error('boom');
      });
      q.enqueue({ kind: 'gist_refinement', payload: {} });
      const failed = await q.runNext(db, 'abstraction', { maxAttempts: 1 });
      expect(failed?.status).toBe('failed');
      expect(failed?.lastError).toBe('boom');
    });

    it('runNext fails gracefully when no handler registered', async () => {
      const q = new ConsolidationQueue(db);
      q.enqueue({ kind: 'prototype_induction', payload: {} });
      const result = await q.runNext(db, 'abstraction');
      expect(result?.status).toBe('failed');
      expect(result?.lastError).toContain('no handler');
    });

    it('runNext returns null when no pending job in queue', async () => {
      const q = new ConsolidationQueue(db);
      expect(await q.runNext(db, 'abstraction')).toBeNull();
    });
  });
});
