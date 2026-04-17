import type Database from 'better-sqlite3';
import type {
  MemoryAlias,
  MemoryAliasDerivation,
  MemoryRole,
  MemorySystem,
  MemoryType,
} from '@memrosetta/types';
import { nowIso } from './utils.js';

/**
 * Tulving 2-axis type system helpers (v4 §5).
 *
 * resolveMemoryAxes derives {memorySystem, memoryRole} from the write
 * input. Explicit caller values win; otherwise we fall back to the
 * legacy memory_type mapping so existing callers keep working without
 * code changes.
 *
 * Alias CRUD enforces the Codex-reviewed governance:
 *   - primary is single-valued (enforced by memories table shape)
 *   - aliases are background-only (synchronous write path is blocked)
 *   - confidence must be >= 0.7 (enforced by CHECK + helper)
 *   - maximum 3 aliases per memory
 */

export interface ResolvedAxes {
  readonly memorySystem: MemorySystem;
  readonly memoryRole: MemoryRole;
}

/**
 * Legacy memory_type -> Tulving axes.
 *   event                       -> episodic  / event
 *   fact | preference           -> semantic  / <type>
 *   decision                    -> semantic  / decision   (default)
 *
 * Explicit inputs override both axes independently, so a caller can
 * store a decision as episodic when it actually is a timestamped event.
 */
export function mapLegacyTypeToAxes(memoryType: MemoryType): ResolvedAxes {
  switch (memoryType) {
    case 'event':
      return { memorySystem: 'episodic', memoryRole: 'event' };
    case 'fact':
    case 'preference':
    case 'decision':
      return { memorySystem: 'semantic', memoryRole: memoryType };
    default:
      return { memorySystem: 'semantic', memoryRole: memoryType };
  }
}

export function resolveMemoryAxes(input: {
  readonly memoryType: MemoryType;
  readonly memorySystem?: MemorySystem;
  readonly memoryRole?: MemoryRole;
}): ResolvedAxes {
  const legacy = mapLegacyTypeToAxes(input.memoryType);
  return {
    memorySystem: input.memorySystem ?? legacy.memorySystem,
    memoryRole: input.memoryRole ?? legacy.memoryRole,
  };
}

export const MEMORY_ALIAS_MAX_PER_MEMORY = 3;
export const MEMORY_ALIAS_MIN_CONFIDENCE = 0.7;

interface MemoryAliasRow {
  readonly memory_id: string;
  readonly alias_system: string | null;
  readonly alias_role: string | null;
  readonly derivation_type: string;
  readonly confidence: number;
  readonly created_by_kernel: string;
  readonly created_at: string;
}

export interface MemoryAliasStatements {
  readonly insertAlias: Database.Statement;
  readonly countForMemory: Database.Statement;
  readonly listForMemory: Database.Statement;
  readonly deleteForMemory: Database.Statement;
}

export function createMemoryAliasStatements(
  db: Database.Database,
): MemoryAliasStatements {
  return {
    insertAlias: db.prepare(`
      INSERT INTO memory_aliases
        (memory_id, alias_system, alias_role, derivation_type, confidence, created_by_kernel, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id, alias_system, alias_role) DO NOTHING
    `),
    countForMemory: db.prepare(
      'SELECT COUNT(*) as count FROM memory_aliases WHERE memory_id = ?',
    ),
    listForMemory: db.prepare(
      `SELECT memory_id, alias_system, alias_role, derivation_type,
              confidence, created_by_kernel, created_at
       FROM memory_aliases
       WHERE memory_id = ?
       ORDER BY created_at ASC`,
    ),
    deleteForMemory: db.prepare(
      'DELETE FROM memory_aliases WHERE memory_id = ? AND alias_system = ? AND alias_role = ?',
    ),
  };
}

export interface AddMemoryAliasInput {
  readonly memoryId: string;
  readonly aliasSystem?: MemorySystem;
  readonly aliasRole?: MemoryRole;
  readonly derivationType: MemoryAliasDerivation;
  readonly confidence: number;
  /**
   * Synchronous write path sets this to 'consolidation' by default.
   * Explicit 'manual' is supported for admin/repair flows only.
   */
  readonly createdByKernel: 'consolidation' | 'manual';
}

export function addMemoryAlias(
  stmts: MemoryAliasStatements,
  input: AddMemoryAliasInput,
): void {
  // Governance rule #1 (Codex Step 1/2 reviews): synchronous store path
  // is forbidden from creating aliases. Only consolidation/manual may.
  // We double-check here even though CHECK already forbids anything else.
  if (
    input.createdByKernel !== 'consolidation' &&
    input.createdByKernel !== 'manual'
  ) {
    throw new Error(
      `addMemoryAlias: createdByKernel must be 'consolidation' or 'manual', got ${String(input.createdByKernel)}`,
    );
  }

  // Governance rule #2: confidence threshold. The SQL CHECK catches
  // direct-SQL violations; this mirror catches application-level bugs
  // with a more descriptive error.
  if (input.confidence < MEMORY_ALIAS_MIN_CONFIDENCE || input.confidence > 1) {
    throw new Error(
      `addMemoryAlias: confidence must be in [${MEMORY_ALIAS_MIN_CONFIDENCE}, 1], got ${input.confidence}`,
    );
  }

  // Governance rule #3: cap aliases per memory.
  const { count } = stmts.countForMemory.get(input.memoryId) as {
    count: number;
  };
  if (count >= MEMORY_ALIAS_MAX_PER_MEMORY) {
    throw new Error(
      `addMemoryAlias: memory ${input.memoryId} already has ${count} aliases ` +
        `(max ${MEMORY_ALIAS_MAX_PER_MEMORY})`,
    );
  }

  stmts.insertAlias.run(
    input.memoryId,
    input.aliasSystem ?? null,
    input.aliasRole ?? null,
    input.derivationType,
    input.confidence,
    input.createdByKernel,
    nowIso(),
  );
}

export function getMemoryAliases(
  stmts: MemoryAliasStatements,
  memoryId: string,
): readonly MemoryAlias[] {
  const rows = stmts.listForMemory.all(memoryId) as readonly MemoryAliasRow[];
  return rows.map((r) => ({
    memoryId: r.memory_id,
    aliasSystem: (r.alias_system as MemorySystem | null) ?? undefined,
    aliasRole: r.alias_role ?? undefined,
    derivationType: r.derivation_type as MemoryAliasDerivation,
    confidence: r.confidence,
    createdByKernel: r.created_by_kernel as 'consolidation' | 'manual',
    createdAt: r.created_at,
  }));
}

export function removeMemoryAlias(
  stmts: MemoryAliasStatements,
  memoryId: string,
  aliasSystem: MemorySystem | undefined,
  aliasRole: MemoryRole | undefined,
): void {
  stmts.deleteForMemory.run(memoryId, aliasSystem ?? null, aliasRole ?? null);
}
