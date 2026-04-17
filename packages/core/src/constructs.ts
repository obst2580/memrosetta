import type Database from 'better-sqlite3';
import type {
  ConstructExemplarLink,
  ConstructSlot,
  ExemplarRole,
  MemoryConstruct,
  MemoryConstructInput,
  AbstractionLevelValue,
} from '@memrosetta/types';
import { nowIso } from './utils.js';

/**
 * Layer B construct helpers (v4 §7).
 *
 * Runtime usage of these helpers is Layer B flag-gated at the engine
 * level. The helpers themselves are always available so tests and
 * manual admin tooling can populate constructs deterministically.
 */

interface ConstructRow {
  readonly memory_id: string;
  readonly canonical_form: string;
  readonly slots_json: string | null;
  readonly constraints_json: string | null;
  readonly anti_patterns_json: string | null;
  readonly success_signals_json: string | null;
  readonly applicability_json: string | null;
  readonly abstraction_level: number;
  readonly construct_confidence: number | null;
  readonly reuse_count: number;
  readonly reuse_success_count: number;
  readonly last_reindex_at: string | null;
}

interface ExemplarRow {
  readonly construct_memory_id: string;
  readonly exemplar_memory_id: string;
  readonly exemplar_role: string;
  readonly support_score: number | null;
  readonly created_at: string;
}

export interface ConstructStatements {
  readonly upsertConstruct: Database.Statement;
  readonly getConstruct: Database.Statement;
  readonly listConstructsByAbstraction: Database.Statement;
  readonly touchConstruct: Database.Statement;
  readonly bumpReuse: Database.Statement;
  readonly linkExemplar: Database.Statement;
  readonly listExemplars: Database.Statement;
  readonly listConstructsByExemplar: Database.Statement;
}

export function createConstructStatements(
  db: Database.Database,
): ConstructStatements {
  return {
    upsertConstruct: db.prepare(`
      INSERT INTO memory_constructs
        (memory_id, canonical_form, slots_json, constraints_json,
         anti_patterns_json, success_signals_json, applicability_json,
         abstraction_level, construct_confidence, reuse_count, reuse_success_count,
         last_reindex_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
      ON CONFLICT(memory_id) DO UPDATE SET
        canonical_form       = excluded.canonical_form,
        slots_json           = excluded.slots_json,
        constraints_json     = excluded.constraints_json,
        anti_patterns_json   = excluded.anti_patterns_json,
        success_signals_json = excluded.success_signals_json,
        applicability_json   = excluded.applicability_json,
        abstraction_level    = excluded.abstraction_level,
        construct_confidence = excluded.construct_confidence,
        last_reindex_at      = excluded.last_reindex_at
    `),
    getConstruct: db.prepare('SELECT * FROM memory_constructs WHERE memory_id = ?'),
    listConstructsByAbstraction: db.prepare(
      `SELECT * FROM memory_constructs
       WHERE abstraction_level = ?
       ORDER BY reuse_count DESC, last_reindex_at DESC`,
    ),
    touchConstruct: db.prepare(
      'UPDATE memory_constructs SET last_reindex_at = ? WHERE memory_id = ?',
    ),
    bumpReuse: db.prepare(
      `UPDATE memory_constructs
       SET reuse_count = reuse_count + 1,
           reuse_success_count = reuse_success_count + ?
       WHERE memory_id = ?`,
    ),
    linkExemplar: db.prepare(`
      INSERT INTO construct_exemplars
        (construct_memory_id, exemplar_memory_id, exemplar_role, support_score, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(construct_memory_id, exemplar_memory_id, exemplar_role) DO UPDATE SET
        support_score = COALESCE(excluded.support_score, construct_exemplars.support_score)
    `),
    listExemplars: db.prepare(
      `SELECT * FROM construct_exemplars
       WHERE construct_memory_id = ?
       ORDER BY created_at ASC`,
    ),
    listConstructsByExemplar: db.prepare(
      `SELECT c.*
       FROM memory_constructs c
       JOIN construct_exemplars e ON e.construct_memory_id = c.memory_id
       WHERE e.exemplar_memory_id = ?`,
    ),
  };
}

function parseJson<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  return JSON.parse(raw) as T;
}

function rowToConstruct(row: ConstructRow): MemoryConstruct {
  return {
    memoryId: row.memory_id,
    canonicalForm: row.canonical_form,
    slots: parseJson<readonly ConstructSlot[]>(row.slots_json),
    constraints: parseJson(row.constraints_json),
    antiPatterns: parseJson(row.anti_patterns_json),
    successSignals: parseJson(row.success_signals_json),
    applicability: parseJson(row.applicability_json),
    abstractionLevel: row.abstraction_level as AbstractionLevelValue,
    constructConfidence: row.construct_confidence ?? undefined,
    reuseCount: row.reuse_count,
    reuseSuccessCount: row.reuse_success_count,
    lastReindexAt: row.last_reindex_at ?? undefined,
  };
}

function rowToExemplar(row: ExemplarRow): ConstructExemplarLink {
  return {
    constructMemoryId: row.construct_memory_id,
    exemplarMemoryId: row.exemplar_memory_id,
    exemplarRole: row.exemplar_role as ExemplarRole,
    supportScore: row.support_score ?? undefined,
    createdAt: row.created_at,
  };
}

export function upsertMemoryConstruct(
  stmts: ConstructStatements,
  input: MemoryConstructInput,
): MemoryConstruct {
  const now = nowIso();
  stmts.upsertConstruct.run(
    input.memoryId,
    input.canonicalForm,
    input.slots ? JSON.stringify(input.slots) : null,
    input.constraints ? JSON.stringify(input.constraints) : null,
    input.antiPatterns ? JSON.stringify(input.antiPatterns) : null,
    input.successSignals ? JSON.stringify(input.successSignals) : null,
    input.applicability ? JSON.stringify(input.applicability) : null,
    input.abstractionLevel ?? 3,
    input.constructConfidence ?? null,
    now,
  );
  const row = stmts.getConstruct.get(input.memoryId) as ConstructRow;
  return rowToConstruct(row);
}

export function getMemoryConstruct(
  stmts: ConstructStatements,
  memoryId: string,
): MemoryConstruct | null {
  const row = stmts.getConstruct.get(memoryId) as ConstructRow | undefined;
  return row ? rowToConstruct(row) : null;
}

export function listConstructsByAbstraction(
  stmts: ConstructStatements,
  level: AbstractionLevelValue,
): readonly MemoryConstruct[] {
  const rows = stmts.listConstructsByAbstraction.all(level) as readonly ConstructRow[];
  return rows.map(rowToConstruct);
}

export interface ConstructExemplarInput {
  readonly constructMemoryId: string;
  readonly exemplarMemoryId: string;
  readonly exemplarRole: ExemplarRole;
  readonly supportScore?: number;
}

export function linkConstructExemplar(
  stmts: ConstructStatements,
  input: ConstructExemplarInput,
): void {
  stmts.linkExemplar.run(
    input.constructMemoryId,
    input.exemplarMemoryId,
    input.exemplarRole,
    input.supportScore ?? null,
    nowIso(),
  );
}

export function getConstructExemplars(
  stmts: ConstructStatements,
  constructMemoryId: string,
): readonly ConstructExemplarLink[] {
  const rows = stmts.listExemplars.all(constructMemoryId) as readonly ExemplarRow[];
  return rows.map(rowToExemplar);
}

export function getConstructsForExemplar(
  stmts: ConstructStatements,
  exemplarMemoryId: string,
): readonly MemoryConstruct[] {
  const rows = stmts.listConstructsByExemplar.all(
    exemplarMemoryId,
  ) as readonly ConstructRow[];
  return rows.map(rowToConstruct);
}

export function recordConstructReuse(
  stmts: ConstructStatements,
  constructMemoryId: string,
  wasSuccessful: boolean,
): void {
  stmts.bumpReuse.run(wasSuccessful ? 1 : 0, constructMemoryId);
}
