/**
 * `memrosetta duplicates report` — audit exact-content duplicates
 * across user_id partitions.
 *
 * This is the read-only v0.5.2 counterpart to the destructive dedupe
 * that ships in v0.5.3. It surfaces groups of memories that share the
 * same `content` + `memory_type` so the user can eyeball the blast
 * radius before any hard delete or invalidate pass runs.
 *
 * Priority hints (descriptive only, no data is modified):
 *   1. canonical user (configured `syncUserId`) wins
 *   2. higher `success_count`
 *   3. higher `use_count`
 *   4. newer `learned_at`
 */

import type Database from 'better-sqlite3';
import { output, outputError, type OutputFormat } from '../output.js';
import { hasFlag, optionalOption } from '../parser.js';
import { resolveDbPath } from '../engine.js';
import { resolveCanonicalUserId } from '../hooks/config.js';

interface DuplicatesOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

interface DuplicateGroupRow {
  readonly content: string;
  readonly memoryType: string;
  readonly totalRows: number;
  readonly distinctUsers: number;
  readonly users: string;
}

interface DuplicateMemberRow {
  readonly memoryId: string;
  readonly userId: string;
  readonly namespace: string | null;
  readonly learnedAt: string;
  readonly useCount: number;
  readonly successCount: number;
}

interface DuplicateGroup {
  readonly content: string;
  readonly memoryType: string;
  readonly totalRows: number;
  readonly distinctUsers: number;
  readonly users: readonly string[];
  readonly members: readonly DuplicateMemberRow[];
  readonly recommendedKeep: string | null;
}

const PREVIEW_LIMIT = 200;
const MAX_GROUPS_IN_TEXT = 20;

function scanDuplicates(
  db: Database.Database,
  canonicalUserId: string,
  limit: number,
): readonly DuplicateGroup[] {
  const groups = db
    .prepare(
      `SELECT
         content,
         memory_type     AS memoryType,
         COUNT(*)        AS totalRows,
         COUNT(DISTINCT user_id) AS distinctUsers,
         GROUP_CONCAT(DISTINCT user_id) AS users
       FROM memories
       GROUP BY content, memory_type
       HAVING totalRows > 1
       ORDER BY totalRows DESC
       LIMIT ?`,
    )
    .all(limit) as readonly DuplicateGroupRow[];

  const memberStmt = db.prepare(
    `SELECT
       memory_id     AS memoryId,
       user_id       AS userId,
       namespace,
       learned_at    AS learnedAt,
       use_count     AS useCount,
       success_count AS successCount
     FROM memories
     WHERE content = ? AND memory_type = ?
     ORDER BY learned_at DESC`,
  );

  return groups.map((g) => {
    const members = memberStmt.all(g.content, g.memoryType) as readonly DuplicateMemberRow[];
    const sorted = [...members].sort((a, b) => scoreMember(b, canonicalUserId) - scoreMember(a, canonicalUserId));
    return {
      content: g.content,
      memoryType: g.memoryType,
      totalRows: g.totalRows,
      distinctUsers: g.distinctUsers,
      users: (g.users ?? '').split(','),
      members,
      recommendedKeep: sorted[0]?.memoryId ?? null,
    };
  });
}

function scoreMember(row: DuplicateMemberRow, canonicalUserId: string): number {
  // Higher score wins. Priority is:
  //   canonical user (+1_000_000)
  //   success_count  (scaled by 100)
  //   use_count      (scaled by 10)
  //   newer learned_at (parsed to ms)
  let score = 0;
  if (row.userId === canonicalUserId) score += 1_000_000;
  score += (row.successCount ?? 0) * 100;
  score += (row.useCount ?? 0) * 10;
  const ms = Date.parse(row.learnedAt);
  if (!Number.isNaN(ms)) score += ms / 1_000_000;
  return score;
}

export async function run(options: DuplicatesOptions): Promise<void> {
  const { args, format, db: dbOverride } = options;
  const sub = args[0];

  if (sub !== 'report') {
    outputError(
      'Usage: memrosetta duplicates report [--format json|text] [--limit <n>] [--canonical <user>]',
      format,
    );
    process.exitCode = 1;
    return;
  }

  const sliced = args.slice(1);
  const limitRaw = optionalOption(sliced, '--limit');
  const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10)) : PREVIEW_LIMIT;
  const verbose = hasFlag(sliced, '--verbose');
  const canonicalOverride = optionalOption(sliced, '--canonical');
  const canonicalUserId = resolveCanonicalUserId(canonicalOverride ?? null);

  const dbPath = resolveDbPath(dbOverride);
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });

  try {
    const groups = scanDuplicates(db, canonicalUserId, limit);
    const totalGroups = groups.length;
    const crossUserGroups = groups.filter((g) => g.distinctUsers > 1).length;
    const totalDuplicateRows = groups.reduce((sum, g) => sum + g.totalRows, 0);

    if (format === 'text') {
      printText(groups, canonicalUserId, {
        totalGroups,
        crossUserGroups,
        totalDuplicateRows,
        verbose,
      });
      return;
    }

    output(
      {
        canonicalUserId,
        totalGroups,
        crossUserGroups,
        totalDuplicateRows,
        groups,
      },
      format,
    );
  } finally {
    db.close();
  }
}

function printText(
  groups: readonly DuplicateGroup[],
  canonicalUserId: string,
  summary: {
    readonly totalGroups: number;
    readonly crossUserGroups: number;
    readonly totalDuplicateRows: number;
    readonly verbose: boolean;
  },
): void {
  const lines: string[] = [];
  lines.push(`Duplicate audit (canonical='${canonicalUserId}')`);
  lines.push('='.repeat(60));
  lines.push(`  duplicate groups         : ${summary.totalGroups}`);
  lines.push(`  cross-user groups        : ${summary.crossUserGroups}`);
  lines.push(`  total duplicate rows     : ${summary.totalDuplicateRows}`);
  lines.push('');

  const shown = groups.slice(0, summary.verbose ? groups.length : MAX_GROUPS_IN_TEXT);
  for (const group of shown) {
    const excerpt =
      group.content.length > 80 ? group.content.slice(0, 80) + '…' : group.content;
    lines.push(`- [${group.memoryType}] rows=${group.totalRows} users=${group.distinctUsers}`);
    lines.push(`  content: ${excerpt}`);
    lines.push(`  users: ${group.users.join(', ')}`);
    if (group.recommendedKeep) {
      lines.push(`  recommended keep: ${group.recommendedKeep}`);
    }
    if (summary.verbose) {
      for (const m of group.members) {
        lines.push(
          `    - ${m.memoryId} user=${m.userId} use=${m.useCount} success=${m.successCount} learned=${m.learnedAt}`,
        );
      }
    }
    lines.push('');
  }

  if (!summary.verbose && groups.length > MAX_GROUPS_IN_TEXT) {
    lines.push(`(+${groups.length - MAX_GROUPS_IN_TEXT} more groups — pass --verbose to list all)`);
  }

  process.stdout.write(lines.join('\n') + '\n');
}
