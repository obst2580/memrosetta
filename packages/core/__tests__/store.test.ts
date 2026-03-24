import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { MemoryInput } from '@memrosetta/types';
import { ensureSchema } from '../src/schema.js';
import {
  createPreparedStatements,
  storeMemory,
  storeBatchInTransaction,
} from '../src/store.js';
import type { PreparedStatements } from '../src/store.js';
import type { MemoryRow } from '../src/mapper.js';

describe('store', () => {
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
    content: 'TypeScript is a typed superset of JavaScript',
  };

  describe('storeMemory', () => {
    it('creates a memory with correct fields', () => {
      const input: MemoryInput = {
        ...baseInput,
        namespace: 'tech',
        rawText: 'I learned that TypeScript is typed JS',
        documentDate: '2025-06-01T00:00:00.000Z',
        sourceId: 'conv-123',
        confidence: 0.9,
        salience: 0.8,
        keywords: ['typescript', 'javascript'],
      };

      const memory = storeMemory(db, stmts, input);

      expect(memory.userId).toBe('user-1');
      expect(memory.namespace).toBe('tech');
      expect(memory.memoryType).toBe('fact');
      expect(memory.content).toBe('TypeScript is a typed superset of JavaScript');
      expect(memory.rawText).toBe('I learned that TypeScript is typed JS');
      expect(memory.documentDate).toBe('2025-06-01T00:00:00.000Z');
      expect(memory.sourceId).toBe('conv-123');
      expect(memory.confidence).toBe(0.9);
      expect(memory.salience).toBe(0.8);
      expect(memory.keywords).toEqual(['typescript', 'javascript']);
    });

    it('generates unique memoryId starting with mem-', () => {
      const m1 = storeMemory(db, stmts, baseInput);
      const m2 = storeMemory(db, stmts, baseInput);

      expect(m1.memoryId).toMatch(/^mem-/);
      expect(m2.memoryId).toMatch(/^mem-/);
      expect(m1.memoryId).not.toBe(m2.memoryId);
    });

    it('sets learnedAt to current timestamp', () => {
      const before = new Date().toISOString();
      const memory = storeMemory(db, stmts, baseInput);
      const after = new Date().toISOString();

      expect(memory.learnedAt).toBeDefined();
      expect(memory.learnedAt >= before).toBe(true);
      expect(memory.learnedAt <= after).toBe(true);
    });

    it('defaults: confidence=1.0, salience=1.0, isLatest=true', () => {
      const memory = storeMemory(db, stmts, baseInput);

      expect(memory.confidence).toBe(1.0);
      expect(memory.salience).toBe(1.0);
      expect(memory.isLatest).toBe(true);
    });

    it('handles optional fields (namespace, rawText, documentDate, sourceId, keywords)', () => {
      const memory = storeMemory(db, stmts, baseInput);

      expect(memory.namespace).toBeUndefined();
      expect(memory.rawText).toBeUndefined();
      expect(memory.documentDate).toBeUndefined();
      expect(memory.sourceId).toBeUndefined();
      expect(memory.keywords).toEqual([]);
    });

    it('converts keywords array to space-separated string in DB', () => {
      const input: MemoryInput = {
        ...baseInput,
        keywords: ['react', 'hooks', 'state'],
      };

      const memory = storeMemory(db, stmts, input);

      const row = db
        .prepare('SELECT keywords FROM memories WHERE memory_id = ?')
        .get(memory.memoryId) as { keywords: string };

      expect(row.keywords).toBe('react hooks state');
    });
  });

  describe('storeBatchInTransaction', () => {
    it('stores multiple memories atomically', () => {
      const inputs: readonly MemoryInput[] = [
        { ...baseInput, content: 'Memory 1' },
        { ...baseInput, content: 'Memory 2' },
        { ...baseInput, content: 'Memory 3' },
      ];

      const results = storeBatchInTransaction(db, stmts, inputs);

      expect(results).toHaveLength(3);
      expect(results[0].content).toBe('Memory 1');
      expect(results[1].content).toBe('Memory 2');
      expect(results[2].content).toBe('Memory 3');

      const countRow = stmts.countByUser.get('user-1') as { count: number };
      expect(countRow.count).toBe(3);
    });

    it('with empty array returns empty array', () => {
      const results = storeBatchInTransaction(db, stmts, []);

      expect(results).toEqual([]);
    });

    it('all memories have unique IDs', () => {
      const inputs: readonly MemoryInput[] = [
        { ...baseInput, content: 'A' },
        { ...baseInput, content: 'B' },
        { ...baseInput, content: 'C' },
      ];

      const results = storeBatchInTransaction(db, stmts, inputs);
      const ids = results.map(m => m.memoryId);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(3);
    });
  });

  describe('getById', () => {
    it('returns stored memory', () => {
      const stored = storeMemory(db, stmts, baseInput);

      const row = stmts.getByMemoryId.get(stored.memoryId) as MemoryRow | undefined;

      expect(row).toBeDefined();
      expect(row!.memory_id).toBe(stored.memoryId);
      expect(row!.content).toBe(baseInput.content);
    });

    it('returns undefined for non-existent ID', () => {
      const row = stmts.getByMemoryId.get('mem-nonexistent') as MemoryRow | undefined;

      expect(row).toBeUndefined();
    });
  });

  describe('countByUser', () => {
    it('returns correct count', () => {
      storeMemory(db, stmts, baseInput);
      storeMemory(db, stmts, baseInput);
      storeMemory(db, stmts, { ...baseInput, userId: 'user-2' });

      const row1 = stmts.countByUser.get('user-1') as { count: number };
      const row2 = stmts.countByUser.get('user-2') as { count: number };

      expect(row1.count).toBe(2);
      expect(row2.count).toBe(1);
    });

    it('returns 0 for unknown user', () => {
      const row = stmts.countByUser.get('user-unknown') as { count: number };

      expect(row.count).toBe(0);
    });
  });
});
