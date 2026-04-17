import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ensureSchema } from '../src/schema.js';
import {
  createPreparedStatements,
} from '../src/store.js';
import type { PreparedStatements } from '../src/store.js';
import { insertEpisode } from '../src/episodes.js';
import {
  canonicalizeCue,
  createHippocampalStatements,
  getCuesForEpisode,
  getCuesForEpisodeFamily,
  registerCueAlias,
  reinforceEpisodicCue,
  scoreEpisodesByCues,
} from '../src/hippocampal.js';
import type { HippocampalStatements } from '../src/hippocampal.js';

describe('hippocampal indexing (v4 reconstructive-memory)', () => {
  let db: Database.Database;
  let stmts: PreparedStatements;
  let hippo: HippocampalStatements;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureSchema(db);
    stmts = createPreparedStatements(db);
    hippo = createHippocampalStatements(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('schema', () => {
    it('creates episodic_index + cue_aliases tables', () => {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('episodic_index','cue_aliases')",
        )
        .all() as readonly { name: string }[];
      expect(tables.map((t) => t.name).sort()).toEqual([
        'cue_aliases',
        'episodic_index',
      ]);
    });

    it('advances schema_version to at least 14', () => {
      const row = db.prepare('SELECT version FROM schema_version').get() as {
        version: number;
      };
      expect(row.version).toBeGreaterThanOrEqual(14);
    });

    it('enforces polarity ∈ {1, -1}', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      expect(() =>
        db.prepare(
          `INSERT INTO episodic_index (episode_id, feature_type, feature_value, polarity, binding_strength, last_activated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(ep.episodeId, 'topic', 'x', 0, 1.0, new Date().toISOString()),
      ).toThrow();
    });
  });

  describe('canonicalizeCue', () => {
    it('returns lowercased raw value when no alias registered', () => {
      expect(canonicalizeCue(hippo, 'project', 'MemRosetta')).toBe('memrosetta');
    });

    it('resolves registered alias to canonical form', () => {
      registerCueAlias(hippo, {
        canonicalForm: 'memrosetta',
        aliasForm: 'mr',
        featureFamily: 'project',
        source: 'manual',
        confidence: 1.0,
      });
      expect(canonicalizeCue(hippo, 'project', 'mr')).toBe('memrosetta');
      expect(canonicalizeCue(hippo, 'project', 'MR')).toBe('memrosetta');
    });

    it('different family does not cross-resolve', () => {
      registerCueAlias(hippo, {
        canonicalForm: 'memrosetta',
        aliasForm: 'mr',
        featureFamily: 'project',
      });
      // same alias_form but different family — no hit
      expect(canonicalizeCue(hippo, 'repo', 'mr')).toBe('mr');
    });
  });

  describe('reinforceEpisodicCue', () => {
    it('creates a new binding with alpha * activation strength', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      const cue = reinforceEpisodicCue(db, hippo, {
        episodeId: ep.episodeId,
        feature: { featureType: 'topic', featureValue: 'reconstructive-memory' },
        activation: 1.0,
      });
      // default alpha=0.5
      expect(cue.bindingStrength).toBeCloseTo(0.5, 5);
      expect(cue.polarity).toBe(1);
    });

    it('increases strength on repeat activation (bounded < 1)', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      reinforceEpisodicCue(db, hippo, {
        episodeId: ep.episodeId,
        feature: { featureType: 'topic', featureValue: 'x' },
        activation: 1.0,
      });
      const second = reinforceEpisodicCue(db, hippo, {
        episodeId: ep.episodeId,
        feature: { featureType: 'topic', featureValue: 'x' },
        activation: 1.0,
      });
      expect(second.bindingStrength).toBeGreaterThan(0.5);
      expect(second.bindingStrength).toBeLessThanOrEqual(1.0);
    });

    it('negative polarity stores as anti-cue independently', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      reinforceEpisodicCue(db, hippo, {
        episodeId: ep.episodeId,
        feature: { featureType: 'topic', featureValue: 'x', polarity: 1 },
        activation: 1.0,
      });
      reinforceEpisodicCue(db, hippo, {
        episodeId: ep.episodeId,
        feature: { featureType: 'topic', featureValue: 'x', polarity: -1 },
        activation: 1.0,
      });
      const cues = getCuesForEpisodeFamily(hippo, ep.episodeId, 'topic');
      expect(cues).toHaveLength(2);
      const polarities = cues.map((c) => c.polarity).sort();
      expect(polarities).toEqual([-1, 1]);
    });

    it('enforces family cap (topic max = 6)', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      for (let i = 0; i < 8; i++) {
        reinforceEpisodicCue(db, hippo, {
          episodeId: ep.episodeId,
          feature: { featureType: 'topic', featureValue: `topic-${i}` },
          // higher activation for later cues so they survive pruning
          activation: 0.2 + i * 0.1,
        });
      }
      const cues = getCuesForEpisodeFamily(hippo, ep.episodeId, 'topic');
      expect(cues.length).toBeLessThanOrEqual(6);
    });

    it('enforces family cap (who max = 2)', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      for (let i = 0; i < 5; i++) {
        reinforceEpisodicCue(db, hippo, {
          episodeId: ep.episodeId,
          feature: { featureType: 'who', featureValue: `user-${i}` },
          activation: 0.5,
        });
      }
      const cues = getCuesForEpisodeFamily(hippo, ep.episodeId, 'who');
      expect(cues.length).toBeLessThanOrEqual(2);
    });

    it('respects enforceCaps=false override', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      for (let i = 0; i < 5; i++) {
        reinforceEpisodicCue(db, hippo, {
          episodeId: ep.episodeId,
          feature: { featureType: 'who', featureValue: `user-${i}` },
          activation: 0.5,
          options: { enforceCaps: false },
        });
      }
      const cues = getCuesForEpisodeFamily(hippo, ep.episodeId, 'who');
      expect(cues.length).toBe(5);
    });

    it('successfulRecall beta contributes to strength', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      const cue = reinforceEpisodicCue(db, hippo, {
        episodeId: ep.episodeId,
        feature: { featureType: 'tool', featureValue: 'grep' },
        activation: 0.5,
        successfulRecall: 1.0,
      });
      // alpha * 0.5 + beta * 1.0 = 0.25 + 0.1 = 0.35
      expect(cue.bindingStrength).toBeCloseTo(0.35, 5);
    });
  });

  describe('scoreEpisodesByCues', () => {
    it('ranks episodes by positive cue overlap', () => {
      const ep1 = insertEpisode(stmts.episode, { userId: 'user-1' });
      const ep2 = insertEpisode(stmts.episode, { userId: 'user-1' });
      const ep3 = insertEpisode(stmts.episode, { userId: 'user-1' });

      for (const ep of [ep1, ep2]) {
        reinforceEpisodicCue(db, hippo, {
          episodeId: ep.episodeId,
          feature: { featureType: 'repo', featureValue: 'memrosetta' },
          activation: 1.0,
        });
      }
      reinforceEpisodicCue(db, hippo, {
        episodeId: ep2.episodeId,
        feature: { featureType: 'language', featureValue: 'typescript' },
        activation: 1.0,
      });
      // ep3 has no matching cues

      const scored = scoreEpisodesByCues(hippo, [
        { featureType: 'repo', featureValue: 'memrosetta' },
        { featureType: 'language', featureValue: 'typescript' },
      ]);

      expect(scored[0].episodeId).toBe(ep2.episodeId);
      const ep3Score = scored.find((s) => s.episodeId === ep3.episodeId);
      expect(ep3Score).toBeUndefined();
    });

    it('applies negative penalty from stored anti-cues', () => {
      const ep1 = insertEpisode(stmts.episode, { userId: 'user-1' });
      const ep2 = insertEpisode(stmts.episode, { userId: 'user-1' });

      reinforceEpisodicCue(db, hippo, {
        episodeId: ep1.episodeId,
        feature: { featureType: 'repo', featureValue: 'memrosetta' },
        activation: 1.0,
      });
      reinforceEpisodicCue(db, hippo, {
        episodeId: ep1.episodeId,
        feature: { featureType: 'task_mode', featureValue: 'debug', polarity: -1 },
        activation: 1.0,
      });
      reinforceEpisodicCue(db, hippo, {
        episodeId: ep2.episodeId,
        feature: { featureType: 'repo', featureValue: 'memrosetta' },
        activation: 1.0,
      });
      // ep2 has no anti-cue for debug

      const scored = scoreEpisodesByCues(hippo, [
        { featureType: 'repo', featureValue: 'memrosetta' },
        { featureType: 'task_mode', featureValue: 'debug' },
      ]);

      // ep2 should rank higher because ep1's anti-cue drags it down
      expect(scored[0].episodeId).toBe(ep2.episodeId);
      const ep1Score = scored.find((s) => s.episodeId === ep1.episodeId)!;
      expect(ep1Score.negativePenalty).toBeGreaterThan(0);
    });

    it('returns empty when no cues match', () => {
      insertEpisode(stmts.episode, { userId: 'user-1' });
      const scored = scoreEpisodesByCues(hippo, [
        { featureType: 'repo', featureValue: 'nonexistent' },
      ]);
      expect(scored).toHaveLength(0);
    });
  });

  describe('getCuesForEpisode', () => {
    it('returns cues ordered by strength desc', () => {
      const ep = insertEpisode(stmts.episode, { userId: 'user-1' });
      reinforceEpisodicCue(db, hippo, {
        episodeId: ep.episodeId,
        feature: { featureType: 'topic', featureValue: 'weak' },
        activation: 0.3,
      });
      reinforceEpisodicCue(db, hippo, {
        episodeId: ep.episodeId,
        feature: { featureType: 'topic', featureValue: 'strong' },
        activation: 1.0,
      });
      const cues = getCuesForEpisode(hippo, ep.episodeId);
      expect(cues[0].featureValue).toBe('strong');
      expect(cues[1].featureValue).toBe('weak');
    });
  });
});
