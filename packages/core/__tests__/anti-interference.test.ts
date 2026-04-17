import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { MemoryInput, RecallEvidence } from '@memrosetta/types';
import { ensureSchema } from '../src/schema.js';
import {
  createPreparedStatements,
  storeMemory,
} from '../src/store.js';
import type { PreparedStatements } from '../src/store.js';
import { insertEpisode } from '../src/episodes.js';
import { insertGoal, linkMemoryToGoal } from '../src/goals.js';
import {
  upsertMemoryConstruct,
  createConstructStatements,
} from '../src/constructs.js';
import { applyAntiInterference } from '../src/anti-interference.js';
import { createEngine } from '../src/engine.js';

describe('Step 9 anti-interference + Layer B engine flags', () => {
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

  const base: MemoryInput = {
    userId: 'user-1',
    memoryType: 'fact',
    content: 'base content',
  };

  describe('diversityPenalty', () => {
    it('penalises duplicate-looking evidence', () => {
      const m1 = storeMemory(db, stmts, {
        ...base,
        content: 'sqlite is the default storage engine for memrosetta',
      });
      const m2 = storeMemory(db, stmts, {
        ...base,
        content: 'sqlite is the default storage engine for memrosetta',
      });
      const m3 = storeMemory(db, stmts, {
        ...base,
        content: 'completely different topic about astrophysics and quarks',
      });

      const evidence: RecallEvidence[] = [
        {
          memoryId: m1.memoryId,
          confidence: 1,
          bindingStrength: 1,
          gistContent: m1.content,
        },
        {
          memoryId: m2.memoryId,
          confidence: 1,
          bindingStrength: 1,
          gistContent: m2.content,
        },
        {
          memoryId: m3.memoryId,
          confidence: 1,
          bindingStrength: 1,
          gistContent: m3.content,
        },
      ];

      const scored = applyAntiInterference({
        db,
        evidence,
        intent: 'browse',
        diversityThreshold: 0.5,
        diversityWeight: 0.8,
      });

      // m3 (novel) should not be penalised; m2 duplicate should be.
      const m2score = scored.find((s) => s.evidence.memoryId === m2.memoryId)!;
      expect(m2score.diversityPenalty).toBeGreaterThan(0);
      const m3score = scored.find((s) => s.evidence.memoryId === m3.memoryId)!;
      expect(m3score.diversityPenalty).toBe(0);
    });
  });

  describe('goalCompatibility', () => {
    it('boosts memories whose linked goal matches an active goal type', () => {
      const buildGoal = insertGoal(stmts.goal, {
        userId: 'user-1',
        goalText: 'build memrosetta',
        goalType: 'build',
        goalHorizon: 'project',
      });
      const decideGoal = insertGoal(stmts.goal, {
        userId: 'user-1',
        goalText: 'pick database',
        goalType: 'decide',
        goalHorizon: 'session',
      });

      const mBuild = storeMemory(db, stmts, { ...base, content: 'build fact' });
      const mDecide = storeMemory(db, stmts, { ...base, content: 'decide fact' });
      linkMemoryToGoal(stmts.goal, {
        goalId: buildGoal.goalId,
        memoryId: mBuild.memoryId,
      });
      linkMemoryToGoal(stmts.goal, {
        goalId: decideGoal.goalId,
        memoryId: mDecide.memoryId,
      });

      const evidence: RecallEvidence[] = [
        {
          memoryId: mBuild.memoryId,
          confidence: 1,
          bindingStrength: 1,
          gistContent: 'build fact',
        },
        {
          memoryId: mDecide.memoryId,
          confidence: 1,
          bindingStrength: 1,
          gistContent: 'decide fact',
        },
      ];

      const scored = applyAntiInterference({
        db,
        evidence,
        intent: 'browse',
        stateVector: {
          activeGoals: [{ goalId: buildGoal.goalId, dominant: true }],
        },
      });

      const buildScore = scored.find((s) => s.evidence.memoryId === mBuild.memoryId)!;
      const decideScore = scored.find((s) => s.evidence.memoryId === mDecide.memoryId)!;
      expect(buildScore.goalCompatibility).toBeGreaterThan(0);
      expect(decideScore.goalCompatibility).toBeLessThanOrEqual(0);
    });
  });

  describe('abstractionLevelGate by intent', () => {
    it('dampens high-abstraction memories under "verify" intent', () => {
      const cons = createConstructStatements(db);
      const mLow = storeMemory(db, stmts, { ...base, content: 'concrete instance' });
      const mHigh = storeMemory(db, stmts, { ...base, content: 'abstract principle' });
      upsertMemoryConstruct(cons, {
        memoryId: mLow.memoryId,
        canonicalForm: 'low',
        abstractionLevel: 1,
      });
      upsertMemoryConstruct(cons, {
        memoryId: mHigh.memoryId,
        canonicalForm: 'high',
        abstractionLevel: 5,
      });

      const evidence: RecallEvidence[] = [
        {
          memoryId: mLow.memoryId,
          confidence: 1,
          bindingStrength: 1,
          verbatimContent: 'concrete instance',
        },
        {
          memoryId: mHigh.memoryId,
          confidence: 1,
          bindingStrength: 1,
          verbatimContent: 'abstract principle',
        },
      ];

      const scored = applyAntiInterference({
        db,
        evidence,
        intent: 'verify',
      });

      const low = scored.find((s) => s.evidence.memoryId === mLow.memoryId)!;
      const high = scored.find((s) => s.evidence.memoryId === mHigh.memoryId)!;
      expect(low.abstractionFit).toBe(1);
      expect(high.abstractionFit).toBeLessThan(1);
    });

    it('boosts mid-abstraction memories under "reuse" intent', () => {
      const cons = createConstructStatements(db);
      const mMid = storeMemory(db, stmts, { ...base, content: 'reusable pattern' });
      upsertMemoryConstruct(cons, {
        memoryId: mMid.memoryId,
        canonicalForm: 'mid',
        abstractionLevel: 3,
      });

      const evidence: RecallEvidence[] = [
        {
          memoryId: mMid.memoryId,
          confidence: 1,
          bindingStrength: 1,
          gistContent: 'reusable pattern',
        },
      ];

      const scored = applyAntiInterference({
        db,
        evidence,
        intent: 'reuse',
      });
      expect(scored[0].abstractionFit).toBe(1);
    });
  });

  describe('engine LayerB flags', () => {
    it('default OFF: salience unchanged, no consolidation jobs', async () => {
      const engine = createEngine({ dbPath: ':memory:' });
      await engine.initialize();
      const memory = await engine.store({
        ...base,
        content: 'flag-off test',
        salience: 1.0,
      });
      expect(memory.salience).toBe(1.0);
      expect(engine.consolidation.size()).toBe(0);
      await engine.close();
    });

    it('enableNoveltyScoring adjusts salience', async () => {
      const engine = createEngine({
        dbPath: ':memory:',
        layerB: { enableNoveltyScoring: true },
      });
      await engine.initialize();

      // First store: novel (score ~1), salience should stay high
      const first = await engine.store({
        ...base,
        content: 'wholly novel content for layer b test',
        salience: 1.0,
      });
      expect(first.salience).toBe(1.0); // row returned BEFORE salience update

      // Re-read from DB to see post-update salience
      const row = engine.rawDatabase()!
        .prepare('SELECT salience FROM memories WHERE memory_id = ?')
        .get(first.memoryId) as { salience: number };
      // score ~ 1.0 → multiplier ~ (0.5 + 1/2) = 1.0 → salience ≈ 1
      expect(row.salience).toBeGreaterThan(0.9);
      await engine.close();
    });

    it('enableConsolidation enqueues a gist_refinement job per store', async () => {
      const engine = createEngine({
        dbPath: ':memory:',
        layerB: { enableConsolidation: true },
      });
      await engine.initialize();
      await engine.store({ ...base, content: 'consolidation candidate' });
      expect(engine.consolidation.pending('abstraction').length).toBe(1);
      expect(engine.consolidation.pending('abstraction')[0].kind).toBe('gist_refinement');
      await engine.close();
    });

    it('enablePatternSeparation fills gist_confidence when absent', async () => {
      const engine = createEngine({
        dbPath: ':memory:',
        layerB: { enablePatternSeparation: true },
      });
      await engine.initialize();
      const memory = await engine.store({ ...base, content: 'pattern separation candidate' });
      const row = engine.rawDatabase()!
        .prepare('SELECT gist_confidence FROM memories WHERE memory_id = ?')
        .get(memory.memoryId) as { gist_confidence: number | null };
      expect(row.gist_confidence).not.toBeNull();
      expect(row.gist_confidence!).toBeGreaterThan(0);
      await engine.close();
    });

    it('all three flags cooperate', async () => {
      const engine = createEngine({
        dbPath: ':memory:',
        layerB: {
          enableNoveltyScoring: true,
          enablePatternSeparation: true,
          enableConsolidation: true,
        },
      });
      await engine.initialize();
      await engine.store({ ...base, content: 'cooperative test' });
      expect(engine.consolidation.size()).toBe(1);
      await engine.close();
    });
  });
});
