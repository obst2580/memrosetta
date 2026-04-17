import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { MemoryInput } from '@memrosetta/types';
import { ensureSchema } from '../src/schema.js';
import {
  createPreparedStatements,
  storeMemory,
  storeBatchInTransaction,
} from '../src/store.js';
import type { PreparedStatements } from '../src/store.js';
import {
  setMemoryGist,
  getCurrentGist,
  getGistVersions,
  getVerbatim,
} from '../src/gists.js';

describe('dual representation (verbatim + gist, v4 reconstructive-memory)', () => {
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

  const baseInput: MemoryInput = {
    userId: 'user-1',
    memoryType: 'fact',
    content: 'memrosetta uses sqlite as default storage for hybrid retrieval',
  };

  describe('schema', () => {
    it('creates memory_gists_versions table', () => {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_gists_versions'",
        )
        .all() as readonly { name: string }[];
      expect(tables).toHaveLength(1);
    });

    it('adds verbatim/gist columns to memories', () => {
      const cols = db.prepare('PRAGMA table_info(memories)').all() as readonly {
        name: string;
      }[];
      const names = new Set(cols.map((c) => c.name));
      expect(names.has('verbatim_content')).toBe(true);
      expect(names.has('gist_content')).toBe(true);
      expect(names.has('gist_confidence')).toBe(true);
      expect(names.has('gist_extracted_at')).toBe(true);
      expect(names.has('gist_extracted_model')).toBe(true);
    });

    it('advances schema_version to at least 12', () => {
      const row = db.prepare('SELECT version FROM schema_version').get() as {
        version: number;
      };
      expect(row.version).toBeGreaterThanOrEqual(12);
    });
  });

  describe('storeMemory verbatim defaults', () => {
    it('verbatim_content defaults to content when not supplied', () => {
      const m = storeMemory(db, stmts, baseInput);
      expect(m.verbatimContent).toBe(baseInput.content);
      expect(getVerbatim(stmts.gist, m.memoryId)).toBe(baseInput.content);
    });

    it('explicit verbatim overrides default', () => {
      const m = storeMemory(db, stmts, {
        ...baseInput,
        content: 'normalized: sqlite default storage',
        verbatim: 'raw: memrosetta uses sqlite as default storage!!!',
      });
      expect(m.verbatimContent).toBe('raw: memrosetta uses sqlite as default storage!!!');
      expect(m.content).toBe('normalized: sqlite default storage');
    });

    it('gist is null when not supplied', () => {
      const m = storeMemory(db, stmts, baseInput);
      expect(m.gistContent).toBeUndefined();
      expect(m.gistExtractedAt).toBeUndefined();
    });

    it('explicit gist is persisted with extraction metadata', () => {
      const m = storeMemory(db, stmts, {
        ...baseInput,
        gist: 'sqlite default',
        gistConfidence: 0.9,
        gistExtractedModel: 'rule-based-v1',
      });
      expect(m.gistContent).toBe('sqlite default');
      expect(m.gistConfidence).toBe(0.9);
      expect(m.gistExtractedModel).toBe('rule-based-v1');
      expect(m.gistExtractedAt).toBeDefined();
    });

    it('batch store preserves per-memory gist metadata', () => {
      const memories = storeBatchInTransaction(db, stmts, [
        { ...baseInput, content: 'a', gist: 'g-a' },
        { ...baseInput, content: 'b' }, // no gist
        { ...baseInput, content: 'c', gist: 'g-c', gistConfidence: 0.7 },
      ]);
      expect(memories[0].gistContent).toBe('g-a');
      expect(memories[1].gistContent).toBeUndefined();
      expect(memories[2].gistConfidence).toBe(0.7);
    });
  });

  describe('setMemoryGist + reconsolidation history', () => {
    it('updates current gist and leaves verbatim untouched', () => {
      const m = storeMemory(db, stmts, {
        ...baseInput,
        gist: 'initial gist',
      });

      setMemoryGist(db, stmts.gist, {
        memoryId: m.memoryId,
        gistContent: 'refined gist after replay',
        gistConfidence: 0.95,
        extractedModel: 'consolidation-v1',
        reason: 'refinement',
      });

      // Verbatim is immutable: the raw trace must not move.
      expect(getVerbatim(stmts.gist, m.memoryId)).toBe(baseInput.content);

      const current = getCurrentGist(stmts.gist, m.memoryId);
      expect(current?.gist_content).toBe('refined gist after replay');
      expect(current?.gist_confidence).toBe(0.95);
      expect(current?.gist_extracted_model).toBe('consolidation-v1');
    });

    it('archives the previous gist into memory_gists_versions', () => {
      const m = storeMemory(db, stmts, {
        ...baseInput,
        gist: 'v1 gist',
        gistExtractedModel: 'draft',
      });

      setMemoryGist(db, stmts.gist, {
        memoryId: m.memoryId,
        gistContent: 'v2 gist',
        extractedModel: 'refiner',
        reason: 'refinement',
      });
      setMemoryGist(db, stmts.gist, {
        memoryId: m.memoryId,
        gistContent: 'v3 gist',
        extractedModel: 'refiner',
        reason: 'contradiction_fix',
      });

      const versions = getGistVersions(stmts.gist, m.memoryId);
      // First archived entry = v1 gist (created when v2 was written)
      // Second archived entry = v2 gist (created when v3 was written)
      expect(versions).toHaveLength(2);
      expect(versions[0].gistContent).toBe('v1 gist');
      expect(versions[0].version).toBe(1);
      expect(versions[0].extractedModel).toBe('draft');
      expect(versions[1].gistContent).toBe('v2 gist');
      expect(versions[1].version).toBe(2);

      const current = getCurrentGist(stmts.gist, m.memoryId);
      expect(current?.gist_content).toBe('v3 gist');
    });

    it('does not archive when current gist is null (first-time set)', () => {
      const m = storeMemory(db, stmts, baseInput); // no initial gist

      setMemoryGist(db, stmts.gist, {
        memoryId: m.memoryId,
        gistContent: 'first gist ever',
      });

      const versions = getGistVersions(stmts.gist, m.memoryId);
      expect(versions).toHaveLength(0); // no previous gist to archive

      const current = getCurrentGist(stmts.gist, m.memoryId);
      expect(current?.gist_content).toBe('first gist ever');
    });

    it('records monotonically increasing version numbers', () => {
      const m = storeMemory(db, stmts, { ...baseInput, gist: 'g1' });
      for (let i = 2; i <= 5; i++) {
        setMemoryGist(db, stmts.gist, {
          memoryId: m.memoryId,
          gistContent: `g${i}`,
          reason: 'refinement',
        });
      }
      const versions = getGistVersions(stmts.gist, m.memoryId);
      expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4]);
      expect(versions.map((v) => v.gistContent)).toEqual(['g1', 'g2', 'g3', 'g4']);
    });
  });

  describe('verbatim immutability under invalidation', () => {
    it('verbatim persists even when memory is invalidated', () => {
      const m = storeMemory(db, stmts, baseInput);
      db.prepare(
        'UPDATE memories SET invalidated_at = ?, is_latest = 0 WHERE memory_id = ?',
      ).run(new Date().toISOString(), m.memoryId);

      expect(getVerbatim(stmts.gist, m.memoryId)).toBe(baseInput.content);
    });
  });
});
