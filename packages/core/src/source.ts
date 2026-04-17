import type Database from 'better-sqlite3';
import type { Memory, SourceAttestation, SourceKind } from '@memrosetta/types';
import { rowToMemory, type MemoryRow } from './mapper.js';
import { nowIso } from './utils.js';

interface SourceAttestationRow {
  readonly memory_id: string;
  readonly source_kind: string;
  readonly source_ref: string;
  readonly source_speaker: string | null;
  readonly confidence: number | null;
  readonly attested_at: string;
}

export interface SourceStatements {
  readonly insertAttestation: Database.Statement;
  readonly getByMemoryId: Database.Statement;
  readonly countByMemoryId: Database.Statement;
}

export function createSourceStatements(db: Database.Database): SourceStatements {
  return {
    // Targeted idempotency: only the actual uniqueness tuple triggers a no-op.
    // Malformed kinds (CHECK violations) or FK problems still surface as errors
    // instead of being silently dropped by a blanket INSERT OR IGNORE.
    insertAttestation: db.prepare(`
      INSERT INTO source_attestations
        (memory_id, source_kind, source_ref, source_speaker, confidence, attested_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id, source_kind, source_ref) DO NOTHING
    `),
    getByMemoryId: db.prepare(
      `SELECT memory_id, source_kind, source_ref, source_speaker, confidence, attested_at
       FROM source_attestations
       WHERE memory_id = ?
       ORDER BY attested_at ASC`,
    ),
    countByMemoryId: db.prepare(
      'SELECT COUNT(*) as count FROM source_attestations WHERE memory_id = ?',
    ),
  };
}

export function insertSourceAttestations(
  stmts: SourceStatements,
  memoryId: string,
  sources: readonly SourceAttestation[] | undefined,
): void {
  if (!sources || sources.length === 0) return;

  const defaultAttestedAt = nowIso();
  for (const src of sources) {
    stmts.insertAttestation.run(
      memoryId,
      src.sourceKind,
      src.sourceRef,
      src.sourceSpeaker ?? null,
      src.confidence ?? null,
      src.attestedAt ?? defaultAttestedAt,
    );
  }
}

export function getSourceAttestations(
  stmts: SourceStatements,
  memoryId: string,
): readonly SourceAttestation[] {
  const rows = stmts.getByMemoryId.all(memoryId) as readonly SourceAttestationRow[];
  return rows.map((row) => ({
    sourceKind: row.source_kind as SourceKind,
    sourceRef: row.source_ref,
    sourceSpeaker: row.source_speaker ?? undefined,
    confidence: row.confidence ?? undefined,
    attestedAt: row.attested_at,
  }));
}

export function countSourceAttestations(
  stmts: SourceStatements,
  memoryId: string,
): number {
  const row = stmts.countByMemoryId.get(memoryId) as { count: number };
  return row.count;
}

/**
 * Read-path helper: returns the memory joined with its structured
 * provenance. Step 1 persists source_attestations but neither
 * `getById` nor `search` surfaces them, so the reconstructive-memory
 * kernel would be write-only provenance without this hydration
 * helper. Returns null if the memory does not exist.
 *
 * Usage from Step 2+ code paths is preferred over calling
 * `getByMemoryId` + `getSourceAttestations` separately.
 */
export function getMemoryWithSources(
  db: Database.Database,
  sourceStmts: SourceStatements,
  memoryId: string,
): { readonly memory: Memory; readonly sources: readonly SourceAttestation[] } | null {
  const row = db
    .prepare('SELECT * FROM memories WHERE memory_id = ?')
    .get(memoryId) as MemoryRow | undefined;
  if (!row) return null;

  const sources = getSourceAttestations(sourceStmts, memoryId);
  return { memory: rowToMemory(row), sources };
}
