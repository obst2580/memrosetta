import type Database from 'better-sqlite3';
import type { MemoryRelation, RelationType } from '@memrosetta/types';
import { nowIso } from './utils.js';

export interface RelationStatements {
  readonly insertRelation: Database.Statement;
  readonly updateIsLatest: Database.Statement;
  readonly checkMemoryExists: Database.Statement;
  readonly getRelationsByMemory: Database.Statement;
}

export function createRelationStatements(db: Database.Database): RelationStatements {
  return {
    insertRelation: db.prepare(`
      INSERT INTO memory_relations (src_memory_id, dst_memory_id, relation_type, created_at, reason)
      VALUES (?, ?, ?, ?, ?)
    `),
    updateIsLatest: db.prepare(
      'UPDATE memories SET is_latest = ? WHERE memory_id = ?'
    ),
    checkMemoryExists: db.prepare(
      'SELECT memory_id FROM memories WHERE memory_id = ?'
    ),
    getRelationsByMemory: db.prepare(
      'SELECT * FROM memory_relations WHERE src_memory_id = ? OR dst_memory_id = ?'
    ),
  };
}

export function createRelation(
  db: Database.Database,
  stmts: RelationStatements,
  srcMemoryId: string,
  dstMemoryId: string,
  relationType: RelationType,
  reason?: string,
): MemoryRelation {
  // Verify both memories exist
  const srcExists = stmts.checkMemoryExists.get(srcMemoryId);
  if (!srcExists) {
    throw new Error(`Source memory not found: ${srcMemoryId}`);
  }
  const dstExists = stmts.checkMemoryExists.get(dstMemoryId);
  if (!dstExists) {
    throw new Error(`Destination memory not found: ${dstMemoryId}`);
  }

  const createdAt = nowIso();

  stmts.insertRelation.run(
    srcMemoryId,
    dstMemoryId,
    relationType,
    createdAt,
    reason ?? null,
  );

  // For 'updates' relations, mark the destination as no longer latest
  if (relationType === 'updates') {
    stmts.updateIsLatest.run(0, dstMemoryId);
  }

  return {
    srcMemoryId,
    dstMemoryId,
    relationType,
    createdAt,
    reason,
  };
}

interface RelationRow {
  readonly src_memory_id: string;
  readonly dst_memory_id: string;
  readonly relation_type: string;
  readonly created_at: string;
  readonly reason: string | null;
}

export function getRelationsByMemory(
  stmts: RelationStatements,
  memoryId: string,
): readonly MemoryRelation[] {
  const rows = stmts.getRelationsByMemory.all(memoryId, memoryId) as readonly RelationRow[];
  return rows.map((row) => ({
    srcMemoryId: row.src_memory_id,
    dstMemoryId: row.dst_memory_id,
    relationType: row.relation_type as RelationType,
    createdAt: row.created_at,
    reason: row.reason ?? undefined,
  }));
}
