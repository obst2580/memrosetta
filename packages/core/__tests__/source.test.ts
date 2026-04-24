import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { MemoryInput, SourceAttestation } from '@memrosetta/types';
import { ensureSchema } from '../src/schema.js';
import {
  createPreparedStatements,
  storeMemory,
  storeBatchInTransaction,
} from '../src/store.js';
import type { PreparedStatements } from '../src/store.js';
import {
  getSourceAttestations,
  countSourceAttestations,
  getMemoryWithSources,
} from '../src/source.js';

describe('source_attestations (v4 reconstructive-memory)', () => {
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
    content: 'memrosetta uses sqlite as default storage',
  };

  describe('schema', () => {
    it('creates source_attestations table at fresh install', () => {
      const row = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='source_attestations'",
        )
        .get();
      expect(row).toBeDefined();
    });

    it('advances schema_version to at least 9', () => {
      const row = db.prepare('SELECT version FROM schema_version').get() as {
        version: number;
      };
      expect(row.version).toBeGreaterThanOrEqual(9);
    });

    it('creates both expected indexes', () => {
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='source_attestations'",
        )
        .all() as readonly { name: string }[];
      const names = indexes.map((r) => r.name);
      expect(names).toContain('idx_source_attestations_memory');
      expect(names).toContain('idx_source_attestations_ref');
    });
  });

  describe('storeMemory with sources', () => {
    it('persists a single source attestation', () => {
      const sources: readonly SourceAttestation[] = [
        {
          sourceKind: 'chat',
          sourceRef: 'turn-001',
          sourceSpeaker: 'user',
          confidence: 0.95,
        },
      ];

      const memory = storeMemory(db, stmts, { ...baseInput, sources });

      const attested = getSourceAttestations(stmts.source, memory.memoryId);
      expect(attested).toHaveLength(1);
      expect(attested[0].sourceKind).toBe('chat');
      expect(attested[0].sourceRef).toBe('turn-001');
      expect(attested[0].sourceSpeaker).toBe('user');
      expect(attested[0].confidence).toBe(0.95);
      expect(attested[0].attestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('persists multiple attestations for one memory', () => {
      const sources: readonly SourceAttestation[] = [
        { sourceKind: 'chat', sourceRef: 'turn-001' },
        { sourceKind: 'document', sourceRef: 'doc://spec.md' },
        { sourceKind: 'tool_output', sourceRef: 'bash:ls-output', confidence: 0.8 },
      ];

      const memory = storeMemory(db, stmts, { ...baseInput, sources });

      expect(countSourceAttestations(stmts.source, memory.memoryId)).toBe(3);
      const attested = getSourceAttestations(stmts.source, memory.memoryId);
      const kinds = attested.map((a) => a.sourceKind);
      expect(kinds).toEqual(['chat', 'document', 'tool_output']);
    });

    it('no-ops when sources is undefined', () => {
      const memory = storeMemory(db, stmts, baseInput);
      expect(countSourceAttestations(stmts.source, memory.memoryId)).toBe(0);
    });

    it('no-ops when sources is empty array', () => {
      const memory = storeMemory(db, stmts, { ...baseInput, sources: [] });
      expect(countSourceAttestations(stmts.source, memory.memoryId)).toBe(0);
    });

    it('honors explicit attestedAt if provided', () => {
      const ts = '2026-04-17T00:00:00.000Z';
      const memory = storeMemory(db, stmts, {
        ...baseInput,
        sources: [{ sourceKind: 'observation', sourceRef: 'obs-1', attestedAt: ts }],
      });

      const attested = getSourceAttestations(stmts.source, memory.memoryId);
      expect(attested[0].attestedAt).toBe(ts);
    });

    it('ignores duplicate (memory_id, source_kind, source_ref) tuples', () => {
      const memory = storeMemory(db, stmts, {
        ...baseInput,
        sources: [
          { sourceKind: 'chat', sourceRef: 'turn-001' },
          { sourceKind: 'chat', sourceRef: 'turn-001', sourceSpeaker: 'user' },
        ],
      });

      // INSERT OR IGNORE drops the second insert — only the first row persists
      expect(countSourceAttestations(stmts.source, memory.memoryId)).toBe(1);
    });

    it('accepts well-known client source labels without a DB CHECK gate', () => {
      const memory = storeMemory(db, stmts, baseInput);

      expect(() =>
        stmts.source.insertAttestation.run(
          memory.memoryId,
          'mcp',
          'ref-1',
          null,
          null,
          new Date().toISOString(),
        ),
      ).not.toThrow();
    });
  });

  describe('batch store with sources', () => {
    it('each memory gets its own attestations', () => {
      const inputs: readonly MemoryInput[] = [
        {
          ...baseInput,
          content: 'fact A',
          sources: [{ sourceKind: 'chat', sourceRef: 'turn-A' }],
        },
        {
          ...baseInput,
          content: 'fact B',
          sources: [
            { sourceKind: 'chat', sourceRef: 'turn-B' },
            { sourceKind: 'document', sourceRef: 'doc-B' },
          ],
        },
        { ...baseInput, content: 'fact C' },
      ];

      const memories = storeBatchInTransaction(db, stmts, inputs);

      expect(countSourceAttestations(stmts.source, memories[0].memoryId)).toBe(1);
      expect(countSourceAttestations(stmts.source, memories[1].memoryId)).toBe(2);
      expect(countSourceAttestations(stmts.source, memories[2].memoryId)).toBe(0);
    });
  });

  describe('getMemoryWithSources (read-path hydration)', () => {
    it('returns memory + sources for an existing memory', () => {
      const memory = storeMemory(db, stmts, {
        ...baseInput,
        sources: [
          { sourceKind: 'chat', sourceRef: 'turn-1' },
          { sourceKind: 'document', sourceRef: 'doc://x' },
        ],
      });

      const result = getMemoryWithSources(db, stmts.source, memory.memoryId);
      expect(result).not.toBeNull();
      expect(result!.memory.memoryId).toBe(memory.memoryId);
      expect(result!.sources).toHaveLength(2);
    });

    it('returns null for unknown memory', () => {
      const result = getMemoryWithSources(db, stmts.source, 'does-not-exist');
      expect(result).toBeNull();
    });

    it('returns memory with empty sources when none attested', () => {
      const memory = storeMemory(db, stmts, baseInput);
      const result = getMemoryWithSources(db, stmts.source, memory.memoryId);
      expect(result).not.toBeNull();
      expect(result!.sources).toHaveLength(0);
    });
  });

  describe('audit trail preservation', () => {
    it('invalidating a memory does not delete its attestations', () => {
      const memory = storeMemory(db, stmts, {
        ...baseInput,
        sources: [{ sourceKind: 'chat', sourceRef: 'turn-001' }],
      });

      db.prepare(
        'UPDATE memories SET invalidated_at = ?, is_latest = 0 WHERE memory_id = ?',
      ).run(new Date().toISOString(), memory.memoryId);

      expect(countSourceAttestations(stmts.source, memory.memoryId)).toBe(1);
    });

    it('attestations are ordered by attested_at ascending', () => {
      const memory = storeMemory(db, stmts, {
        ...baseInput,
        sources: [
          { sourceKind: 'chat', sourceRef: 'late', attestedAt: '2026-04-17T12:00:00.000Z' },
          { sourceKind: 'chat', sourceRef: 'early', attestedAt: '2026-04-17T08:00:00.000Z' },
          { sourceKind: 'chat', sourceRef: 'mid', attestedAt: '2026-04-17T10:00:00.000Z' },
        ],
      });

      const attested = getSourceAttestations(stmts.source, memory.memoryId);
      expect(attested.map((a) => a.sourceRef)).toEqual(['early', 'mid', 'late']);
    });
  });
});
