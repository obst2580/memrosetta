import type Database from 'better-sqlite3';
import { output, outputError, type OutputFormat } from '../output.js';
import { hasFlag, optionalOption } from '../parser.js';
import { resolveDbPath } from '../engine.js';
import { resolveCanonicalUserId } from '../hooks/config.js';

interface DedupeOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

interface DuplicateMember {
  readonly memoryId: string;
  readonly userId: string;
  readonly namespace: string | null;
  readonly learnedAt: string;
  readonly useCount: number;
  readonly successCount: number;
}

interface DuplicateGroup {
  readonly memoryType: string;
  readonly winner: DuplicateMember;
  readonly losers: readonly DuplicateMember[];
}

export async function run(options: DedupeOptions): Promise<void> {
  const { args, format, db: dbOverride } = options;
  const dryRun = hasFlag(args, '--dry-run');
  const canonicalOverride = optionalOption(args, '--canonical');
  const canonicalUserId = resolveCanonicalUserId(canonicalOverride ?? null);

  const dbPath = resolveDbPath(dbOverride);
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(dbPath);

  try {
    const result = collapseExactDuplicates(db, canonicalUserId, dryRun);
    const payload = {
      canonicalUserId,
      dryRun,
      groups: result.groups.length,
      invalidated: result.invalidated,
      relationsCreated: result.relationsCreated,
      preview: result.groups.slice(0, 20).map((group) => ({
        memoryType: group.memoryType,
        winner: group.winner.memoryId,
        losers: group.losers.map((loser) => loser.memoryId),
      })),
    };

    if (format === 'text') {
      printText(payload);
      return;
    }

    output(payload, format);
  } catch (err) {
    outputError(err instanceof Error ? err.message : String(err), format);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

function collapseExactDuplicates(
  db: Database.Database,
  canonicalUserId: string,
  dryRun: boolean,
): {
  readonly groups: readonly DuplicateGroup[];
  readonly invalidated: number;
  readonly relationsCreated: number;
} {
  const groups = scanDuplicateGroups(db, canonicalUserId);
  if (dryRun || groups.length === 0) {
    return {
      groups,
      invalidated: groups.reduce((sum, group) => sum + group.losers.length, 0),
      relationsCreated: groups.reduce((sum, group) => sum + group.losers.length, 0),
    };
  }

  const now = new Date().toISOString();
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
        const info = invalidateStmt.run(now, loser.memoryId);
        if (info.changes > 0) {
          invalidated += info.changes;
        }

        if (relationExistsStmt.get(loser.memoryId, group.winner.memoryId)) continue;

        insertRelationStmt.run(
          loser.memoryId,
          group.winner.memoryId,
          now,
          `Auto dedupe: exact duplicate of ${group.winner.memoryId}`,
        );
        relationsCreated++;
      }
    }
  })();

  return { groups, invalidated, relationsCreated };
}

function scanDuplicateGroups(
  db: Database.Database,
  canonicalUserId: string,
): readonly DuplicateGroup[] {
  const groups = db.prepare(
    `SELECT content, memory_type AS memoryType
     FROM memories
     WHERE is_latest = 1 AND invalidated_at IS NULL
     GROUP BY content, memory_type
     HAVING COUNT(*) > 1
     ORDER BY COUNT(*) DESC, MAX(learned_at) DESC`,
  ).all() as readonly { content: string; memoryType: string }[];

  const membersStmt = db.prepare(
    `SELECT
       memory_id     AS memoryId,
       user_id       AS userId,
       namespace,
       learned_at    AS learnedAt,
       use_count     AS useCount,
       success_count AS successCount
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
    return {
      memoryType: group.memoryType,
      winner: sorted[0],
      losers: sorted.slice(1),
    };
  });
}

function scoreMember(row: DuplicateMember, canonicalUserId: string): number {
  let score = 0;
  if (row.userId === canonicalUserId) score += 1_000_000;
  score += row.successCount * 100;
  score += row.useCount * 10;
  const learnedAtMs = Date.parse(row.learnedAt);
  if (!Number.isNaN(learnedAtMs)) {
    score += learnedAtMs / 1_000_000;
  }
  return score;
}

function printText(result: {
  readonly canonicalUserId: string;
  readonly dryRun: boolean;
  readonly groups: number;
  readonly invalidated: number;
  readonly relationsCreated: number;
  readonly preview: readonly {
    readonly memoryType: string;
    readonly winner: string;
    readonly losers: readonly string[];
  }[];
}): void {
  const lines: string[] = [];
  lines.push(`Dedupe (${result.dryRun ? 'dry run' : 'applied'}) canonical='${result.canonicalUserId}'`);
  lines.push('='.repeat(60));
  lines.push(`  duplicate groups   : ${result.groups}`);
  lines.push(`  invalidated rows   : ${result.invalidated}`);
  lines.push(`  relations created  : ${result.relationsCreated}`);
  lines.push('');

  for (const group of result.preview) {
    lines.push(`- [${group.memoryType}] keep=${group.winner} drop=${group.losers.join(', ')}`);
  }

  process.stdout.write(lines.join('\n') + '\n');
}
