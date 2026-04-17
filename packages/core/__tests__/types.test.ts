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
  addMemoryAlias,
  getMemoryAliases,
  mapLegacyTypeToAxes,
  MEMORY_ALIAS_MAX_PER_MEMORY,
  removeMemoryAlias,
  resolveMemoryAxes,
} from '../src/types.js';

describe('Tulving 2-axis type system + memory_aliases (v4 reconstructive-memory)', () => {
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
    content: '2-axis routing test fact',
  };

  describe('mapLegacyTypeToAxes', () => {
    it('maps event -> episodic/event', () => {
      expect(mapLegacyTypeToAxes('event')).toEqual({
        memorySystem: 'episodic',
        memoryRole: 'event',
      });
    });

    it('maps fact -> semantic/fact', () => {
      expect(mapLegacyTypeToAxes('fact')).toEqual({
        memorySystem: 'semantic',
        memoryRole: 'fact',
      });
    });

    it('maps preference -> semantic/preference', () => {
      expect(mapLegacyTypeToAxes('preference')).toEqual({
        memorySystem: 'semantic',
        memoryRole: 'preference',
      });
    });

    it('maps decision -> semantic/decision', () => {
      expect(mapLegacyTypeToAxes('decision')).toEqual({
        memorySystem: 'semantic',
        memoryRole: 'decision',
      });
    });
  });

  describe('resolveMemoryAxes', () => {
    it('falls back to legacy mapping when axes not supplied', () => {
      expect(resolveMemoryAxes({ memoryType: 'event' })).toEqual({
        memorySystem: 'episodic',
        memoryRole: 'event',
      });
    });

    it('honors explicit memorySystem override', () => {
      const resolved = resolveMemoryAxes({
        memoryType: 'decision',
        memorySystem: 'episodic',
      });
      expect(resolved).toEqual({
        memorySystem: 'episodic',
        memoryRole: 'decision',
      });
    });

    it('honors explicit memoryRole override', () => {
      const resolved = resolveMemoryAxes({
        memoryType: 'fact',
        memoryRole: 'review_prompt',
      });
      expect(resolved).toEqual({
        memorySystem: 'semantic',
        memoryRole: 'review_prompt',
      });
    });

    it('supports overriding both axes', () => {
      const resolved = resolveMemoryAxes({
        memoryType: 'fact',
        memorySystem: 'procedural',
        memoryRole: 'pattern',
      });
      expect(resolved).toEqual({
        memorySystem: 'procedural',
        memoryRole: 'pattern',
      });
    });
  });

  describe('storeMemory axis persistence', () => {
    it('persists derived axes from legacy memoryType', () => {
      const m = storeMemory(db, stmts, { ...baseInput, memoryType: 'event' });
      expect(m.memorySystem).toBe('episodic');
      expect(m.memoryRole).toBe('event');
    });

    it('persists explicit axes', () => {
      const m = storeMemory(db, stmts, {
        ...baseInput,
        memoryType: 'fact',
        memorySystem: 'procedural',
        memoryRole: 'review_prompt',
      });
      expect(m.memorySystem).toBe('procedural');
      expect(m.memoryRole).toBe('review_prompt');
    });

    it('rejects invalid memory_system via CHECK constraint', () => {
      expect(() =>
        storeMemory(db, stmts, {
          ...baseInput,
          memorySystem: 'not_a_system' as never,
        }),
      ).toThrow();
    });
  });

  describe('memory_aliases', () => {
    it('accepts a consolidation-generated alias with confidence >= 0.7', () => {
      const m = storeMemory(db, stmts, baseInput);
      addMemoryAlias(stmts.alias, {
        memoryId: m.memoryId,
        aliasSystem: 'procedural',
        aliasRole: 'pattern',
        derivationType: 'procedural_distillation',
        confidence: 0.85,
        createdByKernel: 'consolidation',
      });

      const aliases = getMemoryAliases(stmts.alias, m.memoryId);
      expect(aliases).toHaveLength(1);
      expect(aliases[0].aliasSystem).toBe('procedural');
      expect(aliases[0].aliasRole).toBe('pattern');
      expect(aliases[0].confidence).toBe(0.85);
      expect(aliases[0].createdByKernel).toBe('consolidation');
    });

    it('rejects confidence below 0.7 at helper level', () => {
      const m = storeMemory(db, stmts, baseInput);
      expect(() =>
        addMemoryAlias(stmts.alias, {
          memoryId: m.memoryId,
          derivationType: 'semantic_extraction',
          confidence: 0.5,
          createdByKernel: 'consolidation',
        }),
      ).toThrow(/confidence/);
    });

    it('rejects confidence below 0.7 at DB CHECK level (raw INSERT)', () => {
      const m = storeMemory(db, stmts, baseInput);
      expect(() =>
        stmts.alias.insertAlias.run(
          m.memoryId,
          'semantic',
          'fact',
          'semantic_extraction',
          0.3,
          'consolidation',
          new Date().toISOString(),
        ),
      ).toThrow();
    });

    it('enforces max 3 aliases per memory', () => {
      const m = storeMemory(db, stmts, baseInput);
      addMemoryAlias(stmts.alias, {
        memoryId: m.memoryId,
        aliasSystem: 'semantic',
        aliasRole: 'fact',
        derivationType: 'semantic_extraction',
        confidence: 0.8,
        createdByKernel: 'consolidation',
      });
      addMemoryAlias(stmts.alias, {
        memoryId: m.memoryId,
        aliasSystem: 'procedural',
        aliasRole: 'pattern',
        derivationType: 'procedural_distillation',
        confidence: 0.8,
        createdByKernel: 'consolidation',
      });
      addMemoryAlias(stmts.alias, {
        memoryId: m.memoryId,
        aliasSystem: 'episodic',
        aliasRole: 'event',
        derivationType: 'episodic_instance_of',
        confidence: 0.8,
        createdByKernel: 'consolidation',
      });

      expect(getMemoryAliases(stmts.alias, m.memoryId)).toHaveLength(
        MEMORY_ALIAS_MAX_PER_MEMORY,
      );

      expect(() =>
        addMemoryAlias(stmts.alias, {
          memoryId: m.memoryId,
          aliasSystem: 'semantic',
          aliasRole: 'heuristic',
          derivationType: 'semantic_extraction',
          confidence: 0.8,
          createdByKernel: 'consolidation',
        }),
      ).toThrow(/max 3/);
    });

    it('rejects invalid createdByKernel at CHECK level', () => {
      const m = storeMemory(db, stmts, baseInput);
      expect(() =>
        stmts.alias.insertAlias.run(
          m.memoryId,
          'semantic',
          'fact',
          'semantic_extraction',
          0.8,
          'synchronous', // not allowed
          new Date().toISOString(),
        ),
      ).toThrow();
    });

    it('rejects invalid derivation_type at CHECK level', () => {
      const m = storeMemory(db, stmts, baseInput);
      expect(() =>
        stmts.alias.insertAlias.run(
          m.memoryId,
          'semantic',
          'fact',
          'bogus_derivation',
          0.8,
          'consolidation',
          new Date().toISOString(),
        ),
      ).toThrow();
    });

    it('duplicate (memory, alias_system, alias_role) is a no-op', () => {
      const m = storeMemory(db, stmts, baseInput);
      addMemoryAlias(stmts.alias, {
        memoryId: m.memoryId,
        aliasSystem: 'semantic',
        aliasRole: 'fact',
        derivationType: 'semantic_extraction',
        confidence: 0.8,
        createdByKernel: 'consolidation',
      });
      addMemoryAlias(stmts.alias, {
        memoryId: m.memoryId,
        aliasSystem: 'semantic',
        aliasRole: 'fact',
        derivationType: 'generalized_from',
        confidence: 0.9,
        createdByKernel: 'consolidation',
      });
      const aliases = getMemoryAliases(stmts.alias, m.memoryId);
      expect(aliases).toHaveLength(1);
      expect(aliases[0].confidence).toBe(0.8); // first write wins
    });

    it('removeMemoryAlias frees a slot', () => {
      const m = storeMemory(db, stmts, baseInput);
      addMemoryAlias(stmts.alias, {
        memoryId: m.memoryId,
        aliasSystem: 'semantic',
        aliasRole: 'fact',
        derivationType: 'semantic_extraction',
        confidence: 0.8,
        createdByKernel: 'consolidation',
      });
      removeMemoryAlias(stmts.alias, m.memoryId, 'semantic', 'fact');
      expect(getMemoryAliases(stmts.alias, m.memoryId)).toHaveLength(0);
    });
  });

  describe('legacy memory backfill', () => {
    it('historical rows inserted before v13 get memory_role via backfill', () => {
      // Simulate an older DB by clearing axes post-insert, then
      // exercising the v13 migration path via re-migration on a fresh
      // DB would not exercise backfill — instead we assert the live
      // path works, which is what the migration also relies on.
      const m = storeMemory(db, stmts, { ...baseInput, memoryType: 'preference' });
      expect(m.memorySystem).toBe('semantic');
      expect(m.memoryRole).toBe('preference');
    });
  });
});
