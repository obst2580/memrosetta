import type Database from 'better-sqlite3';

export interface DuplicateMember {
  readonly memoryId: string;
  readonly userId: string;
  readonly namespace: string | null;
  readonly learnedAt: string;
  readonly useCount: number;
  readonly successCount: number;
}

export interface DuplicateGroup {
  readonly content: string;
  readonly memoryType: string;
  readonly members: readonly DuplicateMember[];
  readonly winner: DuplicateMember;
  readonly losers: readonly DuplicateMember[];
}

export interface DedupeResult {
  readonly canonicalUserId: string;
  readonly groups: readonly DuplicateGroup[];
  readonly invalidated: number;
  readonly relationsCreated: number;
}

interface DuplicateGroupRow {
  readonly content: string;
  readonly memoryType: string;
}

function scoreMember(row: DuplicateMember, canonicalUserId: string): number {
  let score = 0;
  if (row.userId === canonicalUserId) score += 1_000_000;
  score += (row.successCount ?? 0) * 100;
  score += (row.useCount ?? 0) * 10;
  const learnedAtMs = Date.parse(row.learnedAt);
  if (!Number.isNaN(learnedAtMs)) {
    score += learnedAtMs / 1_000_000;
  }
  return score;
}

export function scanDuplicateGroups(
  db: Database.Database,
  canonicalUserId: string,
): readonly DuplicateGroup[] {
  const groups = db.prepare(
    `SELECT
       content,
       memory_type AS memoryType
     FROM memories
     WHERE is_latest = 1 AND invalidated_at IS NULL
     GROUP BY content, memory_type
     HAVING COUNT(*) > 1
     ORDER BY COUNT(*) DESC, MAX(learned_at) DESC`,
  ).all() as readonly DuplicateGroupRow[];

  const membersStmt = db.prepare(
    `SELECT
       memory_id      AS memoryId,
       user_id        AS userId,
       namespace,
       learned_at     AS learnedAt,
       use_count      AS useCount,
       success_count  AS successCount
     FROM memories
     WHERE content = ? AND memory_type = ?
       AND is_latest = 1 AND invalidated_at IS NULL
     ORDER BY learned_at DESC`,
  );

  return groups.map((group) => {
    const members = membersStmt.all(group.content, group.memoryType) as readonly DuplicateMember[];
    const sorted = [...members].sort(
      (a, b) => scoreMember(b, canonicalUserId) - scoreMember(a, canonicalUserId),
    );
    const winner = sorted[0];
    return {
      content: group.content,
      memoryType: group.memoryType,
      members,
      winner,
      losers: sorted.slice(1),
    };
  });
}

export function collapseExactDuplicates(
  db: Database.Database,
  canonicalUserId: string,
  dryRun: boolean,
): DedupeResult {
  const groups = scanDuplicateGroups(db, canonicalUserId);
  if (dryRun || groups.length === 0) {
    return {
      canonicalUserId,
      groups,
      invalidated: groups.reduce((sum, group) => sum + group.losers.length, 0),
      relationsCreated: groups.reduce((sum, group) => sum + group.losers.length, 0),
    };
  }

  const invalidatedAt = new Date().toISOString();
  let invalidated = 0;
  let relationsCreated = 0;

  const invalidateStmt = db.prepare(
    'UPDATE memories SET invalidated_at = ? WHERE memory_id = ? AND invalidated_at IS NULL',
  );
  const relationExistsStmt = db.prepare(
    `SELECT 1 FROM memory_relations
     WHERE src_memory_id = ? AND dst_memory_id = ? AND relation_type = 'duplicates'
     LIMIT 1`,
  );
  const insertRelationStmt = db.prepare(
    `INSERT INTO memory_relations (src_memory_id, dst_memory_id, relation_type, created_at, reason)
     VALUES (?, ?, 'duplicates', ?, ?)`,
  );

  db.transaction(() => {
    for (const group of groups) {
      for (const loser of group.losers) {
        const info = invalidateStmt.run(invalidatedAt, loser.memoryId);
        if (info.changes > 0) {
          invalidated += info.changes;
        }

        const existing = relationExistsStmt.get(loser.memoryId, group.winner.memoryId);
        if (existing) continue;

        insertRelationStmt.run(
          loser.memoryId,
          group.winner.memoryId,
          invalidatedAt,
          `Auto dedupe: exact duplicate of ${group.winner.memoryId}`,
        );
        relationsCreated++;
      }
    }
  })();

  return {
    canonicalUserId,
    groups,
    invalidated,
    relationsCreated,
  };
}
