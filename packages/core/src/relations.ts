import type Database from 'better-sqlite3';
import type { MemoryRelation, RelationType } from '@memrosetta/types';
import { nowIso } from './utils.js';

export interface RelationStatements {
  readonly insertRelation: Database.Statement;
  readonly updateIsLatest: Database.Statement;
  readonly checkMemoryExists: Database.Statement;
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
