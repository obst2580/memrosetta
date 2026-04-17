import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type {
  BlockerRecord,
  GoalInput,
  MemoryInput,
  SuccessCriterion,
} from '@memrosetta/types';
import { ensureSchema } from '../src/schema.js';
import {
  createPreparedStatements,
  storeMemory,
} from '../src/store.js';
import type { PreparedStatements } from '../src/store.js';
import {
  insertGoal,
  closeGoal,
  reopenGoal,
  blockGoal,
  setGoalOutcome,
  getGoalById,
  getActiveGoalsForUser,
  getGoalsByParent,
  linkMemoryToGoal,
  getLinksByGoal,
  getLinksByMemory,
} from '../src/goals.js';

describe('goals + goal_memory_links (v4 reconstructive-memory)', () => {
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

  const baseMemory: MemoryInput = {
    userId: 'user-1',
    memoryType: 'fact',
    content: 'goal-linked memory test fact',
  };

  const baseGoal: GoalInput = {
    userId: 'user-1',
    goalText: 'ship reconstructive-memory v1.0',
    goalHorizon: 'long_running',
    goalType: 'build',
  };

  describe('schema', () => {
    it('creates goals + goal_memory_links tables', () => {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('goals','goal_memory_links')",
        )
        .all() as readonly { name: string }[];
      expect(tables.map((t) => t.name).sort()).toEqual([
        'goal_memory_links',
        'goals',
      ]);
    });

    it('advances schema_version to at least 11', () => {
      const row = db.prepare('SELECT version FROM schema_version').get() as {
        version: number;
      };
      expect(row.version).toBeGreaterThanOrEqual(11);
    });

    it('enforces goal_horizon CHECK constraint', () => {
      expect(() =>
        insertGoal(stmts.goal, { ...baseGoal, goalHorizon: 'forever' as never }),
      ).toThrow();
    });

    it('enforces priority range 1..5', () => {
      expect(() =>
        insertGoal(stmts.goal, { ...baseGoal, priority: 0 }),
      ).toThrow();
      expect(() =>
        insertGoal(stmts.goal, { ...baseGoal, priority: 6 }),
      ).toThrow();
    });
  });

  describe('insertGoal', () => {
    it('creates a goal with defaults (priority=3, state=active)', () => {
      const g = insertGoal(stmts.goal, baseGoal);
      expect(g.goalId).toBeDefined();
      expect(g.goalText).toBe(baseGoal.goalText);
      expect(g.priority).toBe(3);
      expect(g.state).toBe('active');
      expect(g.endedAt).toBeUndefined();
      expect(g.lastTouchedAt).toBe(g.startedAt);
    });

    it('round-trips structured constraints / success_criteria / blocked_by JSON', () => {
      const criteria: readonly SuccessCriterion[] = [
        { criterion: 'all tests pass', threshold: '100%', measurement: 'CI' },
        { criterion: 'no p95 regression', threshold: 50, measurement: 'ms' },
      ];
      const g = insertGoal(stmts.goal, {
        ...baseGoal,
        constraints: [
          { type: 'stack', value: 'typescript', strictness: 'hard' },
          { type: 'language', value: 'korean', strictness: 'soft' },
        ],
        successCriteriaText: 'all CI green + no p95 regression',
        successCriteria: criteria,
        failureSignals: ['memory leak', 'auth bypass'],
      });

      const fetched = getGoalById(stmts.goal, g.goalId)!;
      expect(fetched.constraints).toHaveLength(2);
      expect(fetched.constraints?.[0].strictness).toBe('hard');
      expect(fetched.successCriteria).toEqual(criteria);
      expect(fetched.failureSignals).toEqual(['memory leak', 'auth bypass']);
    });

    it('supports subgoal tree via parentGoalId', () => {
      const parent = insertGoal(stmts.goal, baseGoal);
      const child1 = insertGoal(stmts.goal, {
        ...baseGoal,
        goalText: 'Step 3: Goal-state',
        parentGoalId: parent.goalId,
      });
      const child2 = insertGoal(stmts.goal, {
        ...baseGoal,
        goalText: 'Step 4: Dual representation',
        parentGoalId: parent.goalId,
      });

      const children = getGoalsByParent(stmts.goal, parent.goalId);
      const ids = children.map((c) => c.goalId).sort();
      expect(ids).toEqual([child1.goalId, child2.goalId].sort());
    });

    it('rejects parentGoalId pointing at a non-existent goal (FK)', () => {
      expect(() =>
        insertGoal(stmts.goal, { ...baseGoal, parentGoalId: 'ghost-goal' }),
      ).toThrow();
    });
  });

  describe('closeGoal / reopenGoal / blockGoal', () => {
    it('closeGoal achieved sets ended_at + outcome_summary', () => {
      const g = insertGoal(stmts.goal, baseGoal);
      closeGoal(stmts.goal, g.goalId, {
        state: 'achieved',
        outcomeSummary: 'shipped on time',
      });
      const closed = getGoalById(stmts.goal, g.goalId)!;
      expect(closed.state).toBe('achieved');
      expect(closed.endedAt).toBeDefined();
      expect(closed.outcomeSummary).toBe('shipped on time');
    });

    it('closeGoal abandoned records abandon_reason', () => {
      const g = insertGoal(stmts.goal, baseGoal);
      closeGoal(stmts.goal, g.goalId, {
        state: 'abandoned',
        abandonReason: 'requirements changed',
      });
      const closed = getGoalById(stmts.goal, g.goalId)!;
      expect(closed.state).toBe('abandoned');
      expect(closed.abandonReason).toBe('requirements changed');
    });

    it('closeGoal paused does NOT set ended_at', () => {
      const g = insertGoal(stmts.goal, baseGoal);
      closeGoal(stmts.goal, g.goalId, { state: 'paused' });
      const paused = getGoalById(stmts.goal, g.goalId)!;
      expect(paused.state).toBe('paused');
      // rowToGoal normalizes SQL NULL to undefined
      expect(paused.endedAt).toBeUndefined();
    });

    it('reopenGoal clears ended_at, sets reopened_at, state active', () => {
      const g = insertGoal(stmts.goal, baseGoal);
      closeGoal(stmts.goal, g.goalId, { state: 'achieved' });
      reopenGoal(stmts.goal, g.goalId);
      const reopened = getGoalById(stmts.goal, g.goalId)!;
      expect(reopened.state).toBe('active');
      expect(reopened.endedAt).toBeUndefined();
      expect(reopened.reopenedAt).toBeDefined();
    });

    it('blockGoal sets state=blocked and stores blocker records', () => {
      const g = insertGoal(stmts.goal, baseGoal);
      const blockers: readonly BlockerRecord[] = [
        { blockerType: 'dependency', ref: 'schema-v12', since: '2026-04-17T11:00:00.000Z' },
      ];
      blockGoal(stmts.goal, g.goalId, blockers);
      const blocked = getGoalById(stmts.goal, g.goalId)!;
      expect(blocked.state).toBe('blocked');
      expect(blocked.blockedBy).toEqual(blockers);
    });

    it('setGoalOutcome updates outcome_summary and last_touched_at', () => {
      const g = insertGoal(stmts.goal, baseGoal);
      setGoalOutcome(stmts.goal, g.goalId, 'partial progress logged');
      const touched = getGoalById(stmts.goal, g.goalId)!;
      expect(touched.outcomeSummary).toBe('partial progress logged');
    });
  });

  describe('getActiveGoalsForUser', () => {
    it('returns active goals ordered by priority ASC then recency DESC', () => {
      insertGoal(stmts.goal, { ...baseGoal, goalText: 'low priority', priority: 5 });
      const mid = insertGoal(stmts.goal, { ...baseGoal, goalText: 'mid priority', priority: 3 });
      const hi = insertGoal(stmts.goal, { ...baseGoal, goalText: 'high priority', priority: 1 });
      closeGoal(stmts.goal, mid.goalId, { state: 'achieved' });

      const active = getActiveGoalsForUser(stmts.goal, 'user-1');
      expect(active).toHaveLength(2);
      expect(active[0].goalId).toBe(hi.goalId); // priority 1 first
    });

    it('isolates per user_id', () => {
      insertGoal(stmts.goal, { ...baseGoal, userId: 'user-1' });
      insertGoal(stmts.goal, { ...baseGoal, userId: 'user-2' });
      expect(getActiveGoalsForUser(stmts.goal, 'user-1')).toHaveLength(1);
      expect(getActiveGoalsForUser(stmts.goal, 'user-2')).toHaveLength(1);
    });
  });

  describe('linkMemoryToGoal', () => {
    it('links a memory to a goal with default role=step weight=1.0', () => {
      const g = insertGoal(stmts.goal, baseGoal);
      const m = storeMemory(db, stmts, baseMemory);
      linkMemoryToGoal(stmts.goal, { goalId: g.goalId, memoryId: m.memoryId });

      const links = getLinksByMemory(stmts.goal, m.memoryId);
      expect(links).toHaveLength(1);
      expect(links[0].linkRole).toBe('step');
      expect(links[0].linkWeight).toBe(1.0);
    });

    it('supports multiple roles for the same (goal, memory) pair', () => {
      const g = insertGoal(stmts.goal, baseGoal);
      const m = storeMemory(db, stmts, baseMemory);
      linkMemoryToGoal(stmts.goal, { goalId: g.goalId, memoryId: m.memoryId, linkRole: 'step' });
      linkMemoryToGoal(stmts.goal, { goalId: g.goalId, memoryId: m.memoryId, linkRole: 'evidence' });
      linkMemoryToGoal(stmts.goal, { goalId: g.goalId, memoryId: m.memoryId, linkRole: 'decision' });

      const links = getLinksByGoal(stmts.goal, g.goalId);
      expect(links.map((l) => l.linkRole).sort()).toEqual(['decision', 'evidence', 'step']);
    });

    it('duplicate (goal, memory, role) is a no-op', () => {
      const g = insertGoal(stmts.goal, baseGoal);
      const m = storeMemory(db, stmts, baseMemory);
      linkMemoryToGoal(stmts.goal, { goalId: g.goalId, memoryId: m.memoryId, linkWeight: 1.0 });
      linkMemoryToGoal(stmts.goal, { goalId: g.goalId, memoryId: m.memoryId, linkWeight: 2.0 });

      const links = getLinksByMemory(stmts.goal, m.memoryId);
      expect(links).toHaveLength(1);
      expect(links[0].linkWeight).toBe(1.0); // first write wins (idempotent)
    });

    it('rejects unknown goal_id (FK)', () => {
      const m = storeMemory(db, stmts, baseMemory);
      expect(() =>
        linkMemoryToGoal(stmts.goal, { goalId: 'ghost', memoryId: m.memoryId }),
      ).toThrow();
    });

    it('rejects unknown memory_id (FK)', () => {
      const g = insertGoal(stmts.goal, baseGoal);
      expect(() =>
        linkMemoryToGoal(stmts.goal, { goalId: g.goalId, memoryId: 'ghost-mem' }),
      ).toThrow();
    });

    it('linking touches the goal (last_touched_at advances)', async () => {
      const g = insertGoal(stmts.goal, baseGoal);
      const beforeTs = g.lastTouchedAt;
      const m = storeMemory(db, stmts, baseMemory);
      // brief delay so ISO timestamps differ
      await new Promise((r) => setTimeout(r, 20));
      linkMemoryToGoal(stmts.goal, { goalId: g.goalId, memoryId: m.memoryId });
      const after = getGoalById(stmts.goal, g.goalId)!;
      expect(after.lastTouchedAt > beforeTs).toBe(true);
    });
  });

  describe('storeMemory with goalId input', () => {
    it('auto-links memory to the provided goal', () => {
      const g = insertGoal(stmts.goal, baseGoal);
      const m = storeMemory(db, stmts, {
        ...baseMemory,
        goalId: g.goalId,
        goalLinkRole: 'decision',
        goalLinkWeight: 0.7,
      });

      const links = getLinksByMemory(stmts.goal, m.memoryId);
      expect(links).toHaveLength(1);
      expect(links[0].goalId).toBe(g.goalId);
      expect(links[0].linkRole).toBe('decision');
      expect(links[0].linkWeight).toBeCloseTo(0.7);
    });

    it('no-ops when goalId omitted', () => {
      const m = storeMemory(db, stmts, baseMemory);
      expect(getLinksByMemory(stmts.goal, m.memoryId)).toHaveLength(0);
    });

    it('atomic: invalid goalId rolls back the whole memory insert', () => {
      const before = db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number };
      expect(() =>
        storeMemory(db, stmts, { ...baseMemory, goalId: 'ghost-goal' }),
      ).toThrow();
      const after = db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number };
      expect(after.c).toBe(before.c);
    });
  });
});
