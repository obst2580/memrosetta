import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { MemoryInput, ReconstructRecallInput } from '@memrosetta/types';
import { ensureSchema } from '../src/schema.js';
import {
  createPreparedStatements,
  storeMemory,
} from '../src/store.js';
import type { PreparedStatements } from '../src/store.js';
import { insertEpisode } from '../src/episodes.js';
import {
  reconstructRecall,
  RecallHookRegistry,
} from '../src/recall.js';
import { patternComplete } from '../src/pattern-complete.js';

describe('reconstructRecall (v4 Layer A closed loop)', () => {
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

  async function seedEpisodeWithMemory(
    input: Omit<MemoryInput, 'memoryType'> & {
      memoryType?: MemoryInput['memoryType'];
      cueRepo?: string;
      cueLanguage?: string;
      cueTopic?: string;
    },
  ) {
    const ep = insertEpisode(stmts.episode, { userId: input.userId });
    const memory = storeMemory(db, stmts, {
      ...input,
      memoryType: input.memoryType ?? 'fact',
      episodeId: ep.episodeId,
      cues: [
        ...(input.cueRepo
          ? [{ featureType: 'repo' as const, featureValue: input.cueRepo, activation: 1.0 }]
          : []),
        ...(input.cueLanguage
          ? [{ featureType: 'language' as const, featureValue: input.cueLanguage, activation: 1.0 }]
          : []),
        ...(input.cueTopic
          ? [{ featureType: 'topic' as const, featureValue: input.cueTopic, activation: 1.0 }]
          : []),
      ],
    });
    return { episodeId: ep.episodeId, memory };
  }

  describe('closed loop: store → recall', () => {
    it('recalls the memory via cue overlap', async () => {
      await seedEpisodeWithMemory({
        userId: 'user-1',
        content: 'TypeScript review prompt: use zod for validation',
        memorySystem: 'procedural',
        memoryRole: 'review_prompt',
        cueRepo: 'memrosetta',
        cueLanguage: 'typescript',
        cueTopic: 'code-review',
      });

      const input: ReconstructRecallInput = {
        userId: 'user-1',
        query: 'need a code review prompt',
        context: {
          project: 'memrosetta',
          language: 'typescript',
        },
        cues: [{ featureType: 'topic', featureValue: 'code-review' }],
        intent: 'reuse',
      };

      const result = await reconstructRecall(db, stmts.hippocampal, input);
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence[0].verbatimContent).toContain('zod');
      expect(result.supportingEpisodes.length).toBeGreaterThan(0);
      expect(result.intent).toBe('reuse');
    });

    it('empty cues + empty query produces no_evidence warning', async () => {
      // Step 7 review fix: query is now converted into heuristic
      // cues, so a query with no non-stopword tokens is needed to
      // exercise the "no cues at all" branch.
      const result = await reconstructRecall(db, stmts.hippocampal, {
        userId: 'user-1',
        query: 'the and for',
        intent: 'browse',
      });
      expect(result.evidence).toHaveLength(0);
      expect(result.warnings.some((w) => w.kind === 'no_evidence')).toBe(true);
    });

    it('query tokens alone can drive recall (no explicit cues needed)', async () => {
      await seedEpisodeWithMemory({
        userId: 'user-1',
        content: 'reconstructive memory architecture',
        cueTopic: 'reconstructive',
      });
      const result = await reconstructRecall(db, stmts.hippocampal, {
        userId: 'user-1',
        query: 'reconstructive memory please',
        intent: 'browse',
      });
      expect(result.evidence.length).toBeGreaterThan(0);
    });

    it('cues provided but episodic layer empty emits episodic_layer_empty + hint', async () => {
      // Before fix: fell through as `no_episodes_matched`, which is
      // misleading because the layer isn't populated at all (write-
      // side gap, not a cue mismatch). Fix: distinguish empty layer
      // from real misses and surface an actionable hint.
      const result = await reconstructRecall(db, stmts.hippocampal, {
        userId: 'user-1',
        query: 'anything',
        cues: [{ featureType: 'repo', featureValue: 'nowhere' }],
        intent: 'browse',
      });
      expect(result.evidence).toHaveLength(0);
      const warn = result.warnings.find((w) => w.kind === 'episodic_layer_empty');
      expect(warn).toBeDefined();
      expect(warn?.hint).toContain('memrosetta maintain --build-episodes');
    });

    it('cues miss populated episodes emits no_episodes_matched (not empty)', async () => {
      // Populate the layer for a DIFFERENT cue, then recall with a
      // non-matching one. This proves the empty-layer detection is
      // scoped correctly — it shouldn't mask a real cue miss.
      await seedEpisodeWithMemory({
        userId: 'user-1',
        content: 'some fact',
        cueRepo: 'actual-repo',
      });
      const result = await reconstructRecall(db, stmts.hippocampal, {
        userId: 'user-1',
        query: 'unrelated',
        cues: [{ featureType: 'repo', featureValue: 'nonexistent' }],
        intent: 'browse',
      });
      // The layer is populated, so we should see either no_episodes_matched
      // or actual evidence — never episodic_layer_empty.
      expect(
        result.warnings.some((w) => w.kind === 'episodic_layer_empty'),
      ).toBe(false);
    });
  });

  describe('allowDegraded fallback (P2 opt-in)', () => {
    it('returns lexical search hits as evidence when layer is empty + browse + opt-in', async () => {
      // Seed a memory WITHOUT binding it to any episode so the
      // episodic layer stays empty but FTS still finds it.
      storeMemory(db, stmts, {
        userId: 'user-1',
        memoryType: 'fact',
        content: 'hermes github repo location',
        autoBindEpisode: false,
      });

      const result = await reconstructRecall(db, stmts.hippocampal, {
        userId: 'user-1',
        query: 'hermes',
        intent: 'browse',
        allowDegraded: true,
      });

      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(0.4);
      expect(result.artifact).toContain('[degraded');
      expect(
        result.warnings.some((w) => w.kind === 'degraded_search_fallback'),
      ).toBe(true);
      expect(
        result.warnings.some((w) => w.kind === 'episodic_layer_empty'),
      ).toBe(true);
    });

    it('does NOT fall back for strict verify intent even with allowDegraded', async () => {
      storeMemory(db, stmts, {
        userId: 'user-1',
        memoryType: 'fact',
        content: 'verification target',
        autoBindEpisode: false,
      });

      const result = await reconstructRecall(db, stmts.hippocampal, {
        userId: 'user-1',
        query: 'verification',
        intent: 'verify',
        allowDegraded: true,
      });

      expect(
        result.warnings.some((w) => w.kind === 'degraded_search_fallback'),
      ).toBe(false);
      expect(
        result.warnings.some((w) => w.kind === 'episodic_layer_empty'),
      ).toBe(true);
      expect(result.evidence).toHaveLength(0);
    });

    it('does NOT fall back without the opt-in flag', async () => {
      storeMemory(db, stmts, {
        userId: 'user-1',
        memoryType: 'fact',
        content: 'some content',
        autoBindEpisode: false,
      });

      const result = await reconstructRecall(db, stmts.hippocampal, {
        userId: 'user-1',
        query: 'some',
        intent: 'browse',
      });

      expect(
        result.warnings.some((w) => w.kind === 'degraded_search_fallback'),
      ).toBe(false);
      expect(result.evidence).toHaveLength(0);
    });
  });

  describe('intent routing', () => {
    it('reuse intent prefers procedural/semantic, skips episodic', async () => {
      await seedEpisodeWithMemory({
        userId: 'user-1',
        content: 'procedural prompt',
        memorySystem: 'procedural',
        memoryRole: 'review_prompt',
        cueTopic: 'review',
      });
      await seedEpisodeWithMemory({
        userId: 'user-1',
        content: 'episodic event occurrence',
        memoryType: 'event',
        cueTopic: 'review',
      });

      const result = await reconstructRecall(db, stmts.hippocampal, {
        userId: 'user-1',
        query: 'prompt please',
        cues: [{ featureType: 'topic', featureValue: 'review' }],
        intent: 'reuse',
      });
      // Episodic content should be filtered out for reuse intent
      expect(result.evidence.every((e) => e.system !== 'episodic')).toBe(true);
      const procedural = result.evidence.find((e) => e.system === 'procedural');
      expect(procedural).toBeDefined();
    });

    it('verify intent drops memories without verbatim and emits provenance_gap', async () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      // Insert a memory with null verbatim by bypassing storeMemory —
      // simulate a legacy row the backfill would have touched.
      storeMemory(db, stmts, {
        userId: 'user-1',
        memoryType: 'fact',
        content: 'has verbatim by default',
        episodeId: ep.episodeId,
        cues: [{ featureType: 'repo', featureValue: 'memrosetta', activation: 1 }],
      });
      db.prepare('UPDATE memories SET verbatim_content = NULL').run();

      const result = await reconstructRecall(db, stmts.hippocampal, {
        userId: 'user-1',
        query: 'verify fact',
        cues: [{ featureType: 'repo', featureValue: 'memrosetta' }],
        intent: 'verify',
      });

      expect(result.evidence).toHaveLength(0);
      expect(result.warnings.some((w) => w.kind === 'provenance_gap')).toBe(true);
    });

    it('browse intent includes all memory systems', async () => {
      await seedEpisodeWithMemory({
        userId: 'user-1',
        content: 'procedural a',
        memorySystem: 'procedural',
        memoryRole: 'pattern',
        cueTopic: 'broad',
      });
      await seedEpisodeWithMemory({
        userId: 'user-1',
        content: 'semantic b',
        memoryType: 'fact',
        cueTopic: 'broad',
      });
      await seedEpisodeWithMemory({
        userId: 'user-1',
        content: 'episodic c',
        memoryType: 'event',
        cueTopic: 'broad',
      });

      const result = await reconstructRecall(db, stmts.hippocampal, {
        userId: 'user-1',
        query: 'see all',
        cues: [{ featureType: 'topic', featureValue: 'broad' }],
        intent: 'browse',
      });

      const systems = new Set(result.evidence.map((e) => e.system));
      expect(systems.size).toBeGreaterThan(1);
    });
  });

  describe('state vector cue expansion', () => {
    it('state vector contributes cues even without explicit cues', async () => {
      await seedEpisodeWithMemory({
        userId: 'user-1',
        content: 'memrosetta typescript fact',
        memoryType: 'fact',
        cueRepo: 'memrosetta',
        cueLanguage: 'typescript',
      });

      const result = await reconstructRecall(db, stmts.hippocampal, {
        userId: 'user-1',
        query: 'anything',
        context: {
          repo: 'memrosetta',
          language: 'typescript',
        },
        intent: 'explain',
      });

      expect(result.evidence.length).toBeGreaterThan(0);
    });

    it('negative cue penalizes matching episode', async () => {
      // Two episodes with identical repo; the second also has an
      // anti-cue for task_mode=debug (stored as polarity=-1).
      const ep1 = insertEpisode(stmts.episode, { userId: 'user-1' });
      const ep2 = insertEpisode(stmts.episode, { userId: 'user-1' });

      storeMemory(db, stmts, {
        userId: 'user-1',
        memoryType: 'fact',
        content: 'clean episode',
        episodeId: ep1.episodeId,
        cues: [{ featureType: 'repo', featureValue: 'memrosetta', activation: 1 }],
      });
      storeMemory(db, stmts, {
        userId: 'user-1',
        memoryType: 'fact',
        content: 'episode with anti-cue',
        episodeId: ep2.episodeId,
        cues: [
          { featureType: 'repo', featureValue: 'memrosetta', activation: 1 },
          { featureType: 'task_mode', featureValue: 'debug', polarity: -1, activation: 1 },
        ],
      });

      const result = await reconstructRecall(db, stmts.hippocampal, {
        userId: 'user-1',
        query: 'find memrosetta fact in debug mode',
        cues: [
          { featureType: 'repo', featureValue: 'memrosetta' },
          { featureType: 'task_mode', featureValue: 'debug' },
        ],
        intent: 'browse',
      });

      // ep1 (clean) should outrank ep2 (has anti-cue)
      expect(result.evidence[0].episodeId).toBe(ep1.episodeId);
    });
  });

  describe('hooks', () => {
    it('fires all four hooks in order', async () => {
      await seedEpisodeWithMemory({
        userId: 'user-1',
        content: 'something to recall',
        cueTopic: 'hook-test',
      });

      const order: string[] = [];
      const hooks = new RecallHookRegistry();
      hooks.register('on_evidence_assembly', () => {
        order.push('on_evidence_assembly');
      });
      hooks.register('pre_synthesis', () => {
        order.push('pre_synthesis');
      });
      hooks.register('post_synthesis', () => {
        order.push('post_synthesis');
      });
      hooks.register('on_recall', () => {
        order.push('on_recall');
      });

      await reconstructRecall(
        db,
        stmts.hippocampal,
        {
          userId: 'user-1',
          query: 'recall',
          cues: [{ featureType: 'topic', featureValue: 'hook-test' }],
          intent: 'browse',
        },
        hooks,
      );

      expect(order).toEqual([
        'on_evidence_assembly',
        'pre_synthesis',
        'post_synthesis',
        'on_recall',
      ]);
    });
  });

  describe('patternComplete primitive', () => {
    it('returns completed features not in the original cue set', async () => {
      await seedEpisodeWithMemory({
        userId: 'user-1',
        content: 'rich episode',
        cueRepo: 'memrosetta',
        cueLanguage: 'typescript',
        cueTopic: 'reconstructive-memory',
      });

      const result = patternComplete(db, stmts.hippocampal, {
        userId: 'user-1',
        cues: [{ featureType: 'repo', featureValue: 'memrosetta' }],
        intent: 'browse',
      });

      // language and topic should appear as completed features
      const completedTypes = result.completedFeatures.map((f) => f.featureType);
      expect(completedTypes).toContain('language');
      expect(completedTypes).toContain('topic');
    });
  });
});
