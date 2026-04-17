import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { MemoryInput, StateVector } from '@memrosetta/types';
import { ensureSchema } from '../src/schema.js';
import {
  createPreparedStatements,
  storeMemory,
  storeBatchInTransaction,
} from '../src/store.js';
import type { PreparedStatements } from '../src/store.js';
import {
  insertEpisode,
  closeEpisode,
  getEpisodeById,
  getOpenEpisodeForUser,
  insertSegment,
  closeSegment,
  getSegmentById,
  getLatestOpenSegment,
  bindMemoryToEpisode,
  getBindingsByMemory,
  getBindingsByEpisode,
} from '../src/episodes.js';

describe('episodes + segments + bindings (v4 reconstructive-memory)', () => {
  let db: Database.Database;
  let stmts: PreparedStatements;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureSchema(db);
    stmts = createPreparedStatements(db);
  });

  afterEach(() => {
    db.close();
  });

  // Tests in this file exercise low-level binding primitives directly.
  // Since v0.12 `storeMemory` auto-binds to any open episode for the
  // user, we opt out here so bindings are only written by the test's
  // explicit `bindMemoryToEpisode` calls — otherwise helper test
  // fixtures would pre-bind and hide what we're asserting.
  const baseInput: MemoryInput = {
    userId: 'user-1',
    memoryType: 'fact',
    content: 'episodic memory test fact',
    autoBindEpisode: false,
  };

  describe('schema', () => {
    it('creates episodes, segments, and memory_episodic_bindings tables', () => {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('episodes','segments','memory_episodic_bindings')",
        )
        .all() as readonly { name: string }[];
      const names = new Set(tables.map((t) => t.name));
      expect(names.has('episodes')).toBe(true);
      expect(names.has('segments')).toBe(true);
      expect(names.has('memory_episodic_bindings')).toBe(true);
    });

    it('advances schema_version to at least 10', () => {
      const row = db.prepare('SELECT version FROM schema_version').get() as {
        version: number;
      };
      expect(row.version).toBeGreaterThanOrEqual(10);
    });
  });

  describe('insertEpisode / closeEpisode', () => {
    it('creates and retrieves an episode', () => {
      const ep = insertEpisode(stmts.episode, {
        userId: 'user-1',
        boundaryReason: 'session',
        dominantGoalId: 'goal-123',
        allGoalIds: ['goal-123', 'goal-456'],
      });

      expect(ep.episodeId).toBeDefined();
      expect(ep.userId).toBe('user-1');
      expect(ep.boundaryReason).toBe('session');
      expect(ep.dominantGoalId).toBe('goal-123');
      expect(ep.allGoalIds).toEqual(['goal-123', 'goal-456']);
      expect(ep.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(ep.endedAt).toBeUndefined();
    });

    it('stores and round-trips a context_snapshot StateVector', () => {
      const snap: StateVector = {
        activeGoals: [{ goalId: 'g1', dominant: true }],
        taskMode: 'implement',
        toolRegime: ['code_read', 'terminal'],
        project: 'memrosetta',
        repo: 'personal_project/memrosetta',
        branch: 'main',
        language: 'typescript',
      };
      const ep = insertEpisode(stmts.episode, {
        userId: 'user-1',
        contextSnapshot: snap,
      });
      const fetched = getEpisodeById(stmts.episode, ep.episodeId);
      expect(fetched?.contextSnapshot).toEqual(snap);
    });

    it('closeEpisode sets ended_at only on open episodes (idempotent)', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      closeEpisode(stmts.episode, ep.episodeId);
      const closed = getEpisodeById(stmts.episode, ep.episodeId);
      expect(closed?.endedAt).toBeDefined();

      // second close is a no-op because updateEpisodeEnd filters ended_at IS NULL
      const previousEnd = closed?.endedAt;
      closeEpisode(stmts.episode, ep.episodeId);
      const reclosed = getEpisodeById(stmts.episode, ep.episodeId);
      expect(reclosed?.endedAt).toBe(previousEnd);
    });

    it('getOpenEpisodeForUser returns the latest open episode', () => {
      const a = insertEpisode(stmts.episode, { userId: 'user-1', startedAt: '2026-04-17T08:00:00.000Z' });
      closeEpisode(stmts.episode, a.episodeId);
      const b = insertEpisode(stmts.episode, { userId: 'user-1', startedAt: '2026-04-17T09:00:00.000Z' });
      const c = insertEpisode(stmts.episode, { userId: 'user-1', startedAt: '2026-04-17T10:00:00.000Z' });

      const open = getOpenEpisodeForUser(stmts.episode, 'user-1');
      expect(open?.episodeId).toBe(c.episodeId);

      // another user's open episode is isolated
      insertEpisode(stmts.episode, { userId: 'user-2' });
      const stillC = getOpenEpisodeForUser(stmts.episode, 'user-1');
      expect(stillC?.episodeId).toBe(c.episodeId);
      expect(b.episodeId).not.toBe(c.episodeId);
    });
  });

  describe('insertSegment / closeSegment', () => {
    it('auto-assigns segment_position starting at 0', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      const s0 = insertSegment(stmts.episode, { episodeId: ep.episodeId, taskMode: 'design' });
      const s1 = insertSegment(stmts.episode, { episodeId: ep.episodeId, taskMode: 'implement' });
      const s2 = insertSegment(stmts.episode, { episodeId: ep.episodeId, taskMode: 'review' });

      expect(s0.segmentPosition).toBe(0);
      expect(s1.segmentPosition).toBe(1);
      expect(s2.segmentPosition).toBe(2);
    });

    it('stores fine-grained boundary reason and task_mode', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      const seg = insertSegment(stmts.episode, {
        episodeId: ep.episodeId,
        boundaryReason: 'task_mode',
        taskMode: 'debug',
        dominantGoalId: 'goal-xyz',
      });
      const fetched = getSegmentById(stmts.episode, seg.segmentId);
      expect(fetched?.boundaryReason).toBe('task_mode');
      expect(fetched?.taskMode).toBe('debug');
      expect(fetched?.dominantGoalId).toBe('goal-xyz');
    });

    it('round-trips state_vector_json', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      const sv: StateVector = {
        taskMode: 'explore',
        project: 'memrosetta',
        conversationTopic: 'v4 reconstructive memory',
      };
      const seg = insertSegment(stmts.episode, { episodeId: ep.episodeId, stateVector: sv });
      const fetched = getSegmentById(stmts.episode, seg.segmentId);
      expect(fetched?.stateVector).toEqual(sv);
    });

    it('getLatestOpenSegment returns the highest-position open segment', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      const s0 = insertSegment(stmts.episode, { episodeId: ep.episodeId });
      closeSegment(stmts.episode, s0.segmentId);
      const s1 = insertSegment(stmts.episode, { episodeId: ep.episodeId });

      const open = getLatestOpenSegment(stmts.episode, ep.episodeId);
      expect(open?.segmentId).toBe(s1.segmentId);
    });
  });

  describe('bindMemoryToEpisode', () => {
    it('binds a memory to an episode with optional segment', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      const seg = insertSegment(stmts.episode, { episodeId: ep.episodeId });
      const memory = storeMemory(db, stmts, baseInput);

      bindMemoryToEpisode(stmts.episode, {
        memoryId: memory.memoryId,
        episodeId: ep.episodeId,
        segmentId: seg.segmentId,
        segmentPosition: 0,
        bindingStrength: 1.5,
      });

      const bindings = getBindingsByMemory(stmts.episode, memory.memoryId);
      expect(bindings).toHaveLength(1);
      expect(bindings[0].episodeId).toBe(ep.episodeId);
      expect(bindings[0].segmentId).toBe(seg.segmentId);
      expect(bindings[0].bindingStrength).toBe(1.5);
    });

    it('duplicate (memory_id, episode_id) is a no-op', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      const memory = storeMemory(db, stmts, baseInput);

      bindMemoryToEpisode(stmts.episode, {
        memoryId: memory.memoryId,
        episodeId: ep.episodeId,
        bindingStrength: 1.0,
      });
      bindMemoryToEpisode(stmts.episode, {
        memoryId: memory.memoryId,
        episodeId: ep.episodeId,
        bindingStrength: 2.0, // second write dropped silently
      });

      const bindings = getBindingsByMemory(stmts.episode, memory.memoryId);
      expect(bindings).toHaveLength(1);
      expect(bindings[0].bindingStrength).toBe(1.0);
    });

    it('rejects bindings with unknown episode_id (FK)', () => {
      const memory = storeMemory(db, stmts, baseInput);
      expect(() => {
        bindMemoryToEpisode(stmts.episode, {
          memoryId: memory.memoryId,
          episodeId: 'nonexistent-episode',
        });
      }).toThrow();
    });

    it('default binding_strength is 1.0', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      const memory = storeMemory(db, stmts, baseInput);
      bindMemoryToEpisode(stmts.episode, {
        memoryId: memory.memoryId,
        episodeId: ep.episodeId,
      });
      const bindings = getBindingsByMemory(stmts.episode, memory.memoryId);
      expect(bindings[0].bindingStrength).toBe(1.0);
    });

    it('getBindingsByEpisode returns all memories for that episode', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      const m1 = storeMemory(db, stmts, { ...baseInput, content: 'a' });
      const m2 = storeMemory(db, stmts, { ...baseInput, content: 'b' });
      const m3 = storeMemory(db, stmts, { ...baseInput, content: 'c' });

      bindMemoryToEpisode(stmts.episode, { memoryId: m1.memoryId, episodeId: ep.episodeId });
      bindMemoryToEpisode(stmts.episode, { memoryId: m2.memoryId, episodeId: ep.episodeId });
      // m3 not bound

      const bindings = getBindingsByEpisode(stmts.episode, ep.episodeId);
      const ids = new Set(bindings.map((b) => b.memoryId));
      expect(ids.size).toBe(2);
      expect(ids.has(m1.memoryId)).toBe(true);
      expect(ids.has(m2.memoryId)).toBe(true);
      expect(ids.has(m3.memoryId)).toBe(false);
    });
  });

  describe('storeMemory with episodeId input', () => {
    it('auto-binds when episodeId is provided', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      const memory = storeMemory(db, stmts, {
        ...baseInput,
        episodeId: ep.episodeId,
        segmentPosition: 3,
        bindingStrength: 0.8,
      });

      const bindings = getBindingsByMemory(stmts.episode, memory.memoryId);
      expect(bindings).toHaveLength(1);
      expect(bindings[0].episodeId).toBe(ep.episodeId);
      expect(bindings[0].segmentPosition).toBe(3);
      expect(bindings[0].bindingStrength).toBeCloseTo(0.8);
    });

    it('no-ops when episodeId omitted', () => {
      const memory = storeMemory(db, stmts, baseInput);
      const bindings = getBindingsByMemory(stmts.episode, memory.memoryId);
      expect(bindings).toHaveLength(0);
    });

    it('batch store wires bindings per-memory', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      const memories = storeBatchInTransaction(db, stmts, [
        { ...baseInput, content: 'fact A', episodeId: ep.episodeId },
        { ...baseInput, content: 'fact B' },
        { ...baseInput, content: 'fact C', episodeId: ep.episodeId },
      ]);

      expect(getBindingsByMemory(stmts.episode, memories[0].memoryId)).toHaveLength(1);
      expect(getBindingsByMemory(stmts.episode, memories[1].memoryId)).toHaveLength(0);
      expect(getBindingsByMemory(stmts.episode, memories[2].memoryId)).toHaveLength(1);
    });
  });

  describe('storeMemory auto-bind to open episode (v0.12)', () => {
    // Without this auto-bind, long-running sessions that call store()
    // without threading an episodeId through every write would leak
    // orphan memories — the exact root cause behind the
    // `episodic_layer_empty` recall warning.
    const autoInput: MemoryInput = {
      userId: 'user-1',
      memoryType: 'fact',
      content: 'auto bind fixture',
    };

    it('binds to the open episode when no episodeId is provided', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      const memory = storeMemory(db, stmts, autoInput);

      const bindings = getBindingsByMemory(stmts.episode, memory.memoryId);
      expect(bindings).toHaveLength(1);
      expect(bindings[0].episodeId).toBe(ep.episodeId);
    });

    it('prefers explicit episodeId over the open episode', () => {
      insertEpisode(stmts.episode, { userId: 'user-1' }); // open decoy
      const explicit = insertEpisode(stmts.episode, { userId: 'user-1' });
      // The decoy is "older open"; explicit episode may not be the one
      // getOpenEpisodeForUser returns. Caller's episodeId must win.
      const memory = storeMemory(db, stmts, {
        ...autoInput,
        episodeId: explicit.episodeId,
      });

      const bindings = getBindingsByMemory(stmts.episode, memory.memoryId);
      expect(bindings).toHaveLength(1);
      expect(bindings[0].episodeId).toBe(explicit.episodeId);
    });

    it('autoBindEpisode: false disables the fallback', () => {
      insertEpisode(stmts.episode, { userId: 'user-1' });
      const memory = storeMemory(db, stmts, {
        ...autoInput,
        autoBindEpisode: false,
      });

      expect(getBindingsByMemory(stmts.episode, memory.memoryId)).toHaveLength(0);
    });

    it('no open episode → no binding (unchanged orphan behavior)', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      closeEpisode(stmts.episode, ep.episodeId);

      const memory = storeMemory(db, stmts, autoInput);
      expect(getBindingsByMemory(stmts.episode, memory.memoryId)).toHaveLength(0);
    });

    it("does not bind across users (user-2's open episode is irrelevant)", () => {
      insertEpisode(stmts.episode, { userId: 'user-2' });
      const memory = storeMemory(db, stmts, autoInput);
      expect(getBindingsByMemory(stmts.episode, memory.memoryId)).toHaveLength(0);
    });
  });
});
