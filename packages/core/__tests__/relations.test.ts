import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { MemoryInput } from '@memrosetta/types';
import { ensureSchema } from '../src/schema.js';
import { createPreparedStatements, storeMemory } from '../src/store.js';
import type { PreparedStatements } from '../src/store.js';
import { createRelationStatements, createRelation } from '../src/relations.js';
import type { RelationStatements } from '../src/relations.js';
import type { MemoryRow } from '../src/mapper.js';

describe('relations', () => {
  let db: Database.Database;
  let storeStmts: PreparedStatements;
  let relStmts: RelationStatements;

  const baseInput: MemoryInput = {
    userId: 'user-1',
    memoryType: 'fact',
    content: 'Original fact',
  };

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureSchema(db);
    storeStmts = createPreparedStatements(db);
    relStmts = createRelationStatements(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('createRelation', () => {
    it('creates a relation between two existing memories', () => {
      const m1 = storeMemory(db, storeStmts, { ...baseInput, content: 'Fact A' });
      const m2 = storeMemory(db, storeStmts, { ...baseInput, content: 'Fact B extends A' });

      const relation = createRelation(db, relStmts, m2.memoryId, m1.memoryId, 'extends');

      expect(relation.srcMemoryId).toBe(m2.memoryId);
      expect(relation.dstMemoryId).toBe(m1.memoryId);
      expect(relation.relationType).toBe('extends');
      expect(relation.createdAt).toBeDefined();
    });

    it('with updates sets destination isLatest to false', () => {
      const original = storeMemory(db, storeStmts, { ...baseInput, content: 'Hourly rate 50000' });
      const updated = storeMemory(db, storeStmts, { ...baseInput, content: 'Hourly rate 40000 for long-term' });

      createRelation(db, relStmts, updated.memoryId, original.memoryId, 'updates');

      const row = storeStmts.getByMemoryId.get(original.memoryId) as MemoryRow;
      expect(row.is_latest).toBe(0);

      const updatedRow = storeStmts.getByMemoryId.get(updated.memoryId) as MemoryRow;
      expect(updatedRow.is_latest).toBe(1);
    });

    it('with extends does NOT change isLatest', () => {
      const m1 = storeMemory(db, storeStmts, { ...baseInput, content: 'Likes TypeScript' });
      const m2 = storeMemory(db, storeStmts, { ...baseInput, content: 'Especially for SaaS projects' });

      createRelation(db, relStmts, m2.memoryId, m1.memoryId, 'extends');

      const row = storeStmts.getByMemoryId.get(m1.memoryId) as MemoryRow;
      expect(row.is_latest).toBe(1);
    });

    it('with derives does NOT change isLatest', () => {
      const m1 = storeMemory(db, storeStmts, { ...baseInput, content: 'SaaS + long-term' });
      const m2 = storeMemory(db, storeStmts, { ...baseInput, content: 'Lower initial cost, higher total revenue' });

      createRelation(db, relStmts, m2.memoryId, m1.memoryId, 'derives');

      const row = storeStmts.getByMemoryId.get(m1.memoryId) as MemoryRow;
      expect(row.is_latest).toBe(1);
    });

    it('throws error for non-existent source memory', () => {
      const m1 = storeMemory(db, storeStmts, baseInput);

      expect(() => {
        createRelation(db, relStmts, 'mem-nonexistent', m1.memoryId, 'extends');
      }).toThrow('Memory not found: mem-nonexistent');
    });

    it('throws error for non-existent destination memory', () => {
      const m1 = storeMemory(db, storeStmts, baseInput);

      expect(() => {
        createRelation(db, relStmts, m1.memoryId, 'mem-nonexistent', 'extends');
      }).toThrow('Memory not found: mem-nonexistent');
    });

    it('stores reason if provided', () => {
      const m1 = storeMemory(db, storeStmts, { ...baseInput, content: 'Original' });
      const m2 = storeMemory(db, storeStmts, { ...baseInput, content: 'Updated' });

      const relation = createRelation(
        db, relStmts, m2.memoryId, m1.memoryId, 'updates',
        'Client changed pricing for long-term contracts',
      );

      expect(relation.reason).toBe('Client changed pricing for long-term contracts');

      const row = db
        .prepare('SELECT reason FROM memory_relations WHERE src_memory_id = ? AND dst_memory_id = ?')
        .get(m2.memoryId, m1.memoryId) as { reason: string };
      expect(row.reason).toBe('Client changed pricing for long-term contracts');
    });

    it('duplicate relation throws error (PK violation)', () => {
      const m1 = storeMemory(db, storeStmts, { ...baseInput, content: 'A' });
      const m2 = storeMemory(db, storeStmts, { ...baseInput, content: 'B' });

      createRelation(db, relStmts, m2.memoryId, m1.memoryId, 'extends');

      expect(() => {
        createRelation(db, relStmts, m2.memoryId, m1.memoryId, 'extends');
      }).toThrow();
    });
  });
});
