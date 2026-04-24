import type Database from 'better-sqlite3';
import type { RelationType } from '@memrosetta/types';
import {
  createRelation,
  createRelationStatements,
  inferDeterministicRelation,
} from './relations.js';

export interface RelationDiscoveryCursor {
  readonly coAccessCount: number;
  readonly memoryAId: string;
  readonly memoryBId: string;
}

export interface RelationDiscoveryOptions {
  readonly userId: string;
  readonly recentDays?: number;
  readonly coAccessThreshold?: number;
  readonly maxPairs?: number;
  readonly cursor?: RelationDiscoveryCursor;
}

export interface RelationDiscoveryResult {
  readonly scanned: number;
  readonly created: number;
  readonly skippedNoInference: number;
  readonly skippedExisting: number;
  readonly nextCursor?: RelationDiscoveryCursor;
}

interface CandidatePairRow {
  readonly memory_a_id: string;
  readonly memory_b_id: string;
  readonly co_access_count: number;
  readonly memory_a_content: string;
  readonly memory_b_content: string;
}

export function discoverReplayRelations(
  db: Database.Database,
  options: RelationDiscoveryOptions,
): RelationDiscoveryResult {
  const recentDays = clampInt(options.recentDays ?? 7, 1, 30);
  const coAccessThreshold = Math.max(
    1,
    Math.floor(options.coAccessThreshold ?? 2),
  );
  const maxPairs = clampInt(options.maxPairs ?? 100, 1, 100);
  const cutoff = new Date(
    Date.now() - recentDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows = loadCandidatePairs(db, {
    userId: options.userId,
    cutoff,
    coAccessThreshold,
    limit: maxPairs + 1,
    cursor: options.cursor,
  });
  const selected = rows.slice(0, maxPairs);
  const stmts = createRelationStatements(db);
  let created = 0;
  let skippedNoInference = 0;
  let skippedExisting = 0;

  for (const row of selected) {
    const candidate = inferPairRelation(row);
    if (!candidate) {
      skippedNoInference++;
      continue;
    }

    try {
      createRelation(
        db,
        stmts,
        candidate.srcMemoryId,
        candidate.dstMemoryId,
        candidate.relationType,
        `consolidation_replay; ${candidate.reason}; ` +
          `co_access_count=${row.co_access_count}`,
      );
      created++;
    } catch {
      skippedExisting++;
    }
  }

  const last = selected[selected.length - 1];
  return {
    scanned: selected.length,
    created,
    skippedNoInference,
    skippedExisting,
    nextCursor: rows.length > maxPairs && last ? rowToCursor(last) : undefined,
  };
}

function loadCandidatePairs(
  db: Database.Database,
  input: {
    readonly userId: string;
    readonly cutoff: string;
    readonly coAccessThreshold: number;
    readonly limit: number;
    readonly cursor?: RelationDiscoveryCursor;
  },
): readonly CandidatePairRow[] {
  const cursorClause = input.cursor
    ? `AND (
         c.co_access_count < ?
         OR (
           c.co_access_count = ?
           AND (
             c.memory_a_id > ?
             OR (c.memory_a_id = ? AND c.memory_b_id > ?)
           )
         )
       )`
    : '';
  const cursorParams = input.cursor
    ? [
        input.cursor.coAccessCount,
        input.cursor.coAccessCount,
        input.cursor.memoryAId,
        input.cursor.memoryAId,
        input.cursor.memoryBId,
      ]
    : [];

  return db
    .prepare(
      `SELECT
         c.memory_a_id,
         c.memory_b_id,
         c.co_access_count,
         ma.content AS memory_a_content,
         mb.content AS memory_b_content
       FROM memory_coaccess c
       JOIN memories ma ON ma.memory_id = c.memory_a_id
       JOIN memories mb ON mb.memory_id = c.memory_b_id
       WHERE ma.user_id = ?
         AND mb.user_id = ?
         AND ma.is_latest = 1
         AND mb.is_latest = 1
         AND ma.invalidated_at IS NULL
         AND mb.invalidated_at IS NULL
         AND c.co_access_count >= ?
         AND EXISTS (
           SELECT 1
           FROM memory_episodic_bindings ba
           JOIN memory_episodic_bindings bb ON bb.episode_id = ba.episode_id
           JOIN episodes e ON e.episode_id = ba.episode_id
           WHERE ba.memory_id = c.memory_a_id
             AND bb.memory_id = c.memory_b_id
             AND e.user_id = ?
             AND COALESCE(e.ended_at, e.started_at) >= ?
         )
         AND NOT EXISTS (
           SELECT 1
           FROM memory_relations r
           WHERE (r.src_memory_id = c.memory_a_id AND r.dst_memory_id = c.memory_b_id)
              OR (r.src_memory_id = c.memory_b_id AND r.dst_memory_id = c.memory_a_id)
         )
         ${cursorClause}
       ORDER BY c.co_access_count DESC, c.memory_a_id ASC, c.memory_b_id ASC
       LIMIT ?`,
    )
    .all(
      input.userId,
      input.userId,
      input.coAccessThreshold,
      input.userId,
      input.cutoff,
      ...cursorParams,
      input.limit,
    ) as readonly CandidatePairRow[];
}

function inferPairRelation(row: CandidatePairRow):
  | {
      readonly srcMemoryId: string;
      readonly dstMemoryId: string;
      readonly relationType: RelationType;
      readonly reason: string;
    }
  | null {
  const a = inferDeterministicRelation(row.memory_a_content);
  if (a) {
    return {
      srcMemoryId: row.memory_a_id,
      dstMemoryId: row.memory_b_id,
      relationType: a.relationType,
      reason: a.reason,
    };
  }

  const b = inferDeterministicRelation(row.memory_b_content);
  if (!b) return null;
  return {
    srcMemoryId: row.memory_b_id,
    dstMemoryId: row.memory_a_id,
    relationType: b.relationType,
    reason: b.reason,
  };
}

function rowToCursor(row: CandidatePairRow): RelationDiscoveryCursor {
  return {
    coAccessCount: row.co_access_count,
    memoryAId: row.memory_a_id,
    memoryBId: row.memory_b_id,
  };
}

function clampInt(value: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(max, n));
}
