/**
 * `memrosetta migrate` — one-shot data fixups that don't belong in the
 * regular schema upgrade path.
 *
 * Sub-commands:
 *
 *   legacy-user-ids
 *     Fold historical fragmented `memories.user_id` partitions
 *     (`personal/memrosetta`, `work/tech-manage-api`, `general`, ...)
 *     into a canonical user. These partitions were created by pre-0.4
 *     versions where `resolveUserId(cwd)` derived the user_id from the
 *     working directory. Starting in v0.5.2 every read/write path
 *     resolves identity through `config.syncUserId ?? username`, so
 *     the fragmentation is purely legacy state.
 *
 *     The migration is client-only and non-destructive:
 *       1. Legacy rows are copied into `memory_legacy_scope`
 *          (memory_id + legacy_user_id + legacy_namespace) so future
 *          tooling can re-derive project scope.
 *       2. `memories.user_id` is rewritten to the canonical user.
 *          `namespace` is NEVER touched — those rows already hold
 *          `session-XXXX` context.
 *       3. Local sync queues (`sync_outbox`, `sync_inbox`) are cleared
 *          so they don't keep uploading ops with the legacy user_id.
 *       4. Sync cursor state is reset so the next `sync now` starts
 *          from scratch for the canonical partition.
 *       5. The caller is instructed to run `memrosetta sync backfill`
 *          to republish the canonical partition to the hub.
 */

import type Database from 'better-sqlite3';
import { outputError, output, type OutputFormat } from '../output.js';
import { hasFlag, optionalOption } from '../parser.js';
import { resolveDbPath } from '../engine.js';
import { resolveCanonicalUserId } from '../hooks/config.js';
import { createInterface } from 'node:readline';

interface MigrateOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

interface LegacyImpactRow {
  readonly legacyUserId: string;
  readonly rows: number;
  readonly distinctNamespaces: number;
}

interface LegacyImpactReport {
  readonly canonicalUserId: string;
  readonly totalRows: number;
  readonly legacyRows: number;
  readonly distinctLegacyUserIds: number;
  readonly breakdown: readonly LegacyImpactRow[];
  readonly queuePending: number;
  readonly crossPartitionDuplicateGroups: number;
  readonly alreadyMigrated: boolean;
}

const MIGRATION_NAME = 'legacy-user-id-to-canonical-v1';

// ---------------------------------------------------------------------------
// Impact scan (dry-run + pre-exec)
// ---------------------------------------------------------------------------

export function scanLegacyImpact(
  db: Database.Database,
  canonicalUserId: string,
): LegacyImpactReport {
  const totalRows = (
    db.prepare('SELECT COUNT(*) AS c FROM memories').get() as { c: number }
  ).c;

  const legacyRows = (
    db
      .prepare('SELECT COUNT(*) AS c FROM memories WHERE user_id != ?')
      .get(canonicalUserId) as { c: number }
  ).c;

  const breakdownRows = db
    .prepare(
      `SELECT user_id AS legacyUserId, COUNT(*) AS rows, COUNT(DISTINCT namespace) AS distinctNamespaces
       FROM memories
       WHERE user_id != ?
       GROUP BY user_id
       ORDER BY rows DESC`,
    )
    .all(canonicalUserId) as readonly LegacyImpactRow[];

  const queuePending =
    hasTable(db, 'sync_outbox')
      ? (db.prepare('SELECT COUNT(*) AS c FROM sync_outbox WHERE pushed_at IS NULL').get() as { c: number }).c
      : 0;

  const crossPartitionDuplicateGroups = (
    db
      .prepare(
        `WITH x AS (
          SELECT content, COUNT(DISTINCT user_id) AS u
          FROM memories
          GROUP BY content
        )
        SELECT COUNT(*) AS c FROM x WHERE u > 1`,
      )
      .get() as { c: number }
  ).c;

  const alreadyMigrated = hasTable(db, 'migration_version')
    ? Boolean(
        db
          .prepare('SELECT 1 FROM migration_version WHERE name = ?')
          .get(MIGRATION_NAME),
      )
    : false;

  return {
    canonicalUserId,
    totalRows,
    legacyRows,
    distinctLegacyUserIds: breakdownRows.length,
    breakdown: breakdownRows,
    queuePending,
    crossPartitionDuplicateGroups,
    alreadyMigrated,
  };
}

function hasTable(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// Migration execution
// ---------------------------------------------------------------------------

interface MigrationResult {
  readonly movedRows: number;
  readonly legacyScopeRows: number;
  readonly outboxCleared: number;
  readonly inboxCleared: number;
  readonly cursorReset: boolean;
}

export function runLegacyUserIdMigration(
  db: Database.Database,
  canonicalUserId: string,
): MigrationResult {
  const run = db.transaction(() => {
    // 1. Snapshot legacy rows into memory_legacy_scope. IGNORE keeps
    //    re-runs idempotent — if a memory_id already has a legacy
    //    record we don't overwrite it.
    const insert = db.prepare(
      `INSERT OR IGNORE INTO memory_legacy_scope (
         memory_id, legacy_user_id, legacy_namespace, migrated_at
       )
       SELECT memory_id, user_id, namespace, CURRENT_TIMESTAMP
       FROM memories
       WHERE user_id != ?`,
    );
    const insertInfo = insert.run(canonicalUserId);
    const legacyScopeRows = insertInfo.changes;

    // 2. Rewrite memories.user_id to the canonical user. namespace is
    //    intentionally left alone — it already holds session context.
    const update = db.prepare(
      'UPDATE memories SET user_id = ? WHERE user_id != ?',
    );
    const updateInfo = update.run(canonicalUserId, canonicalUserId);
    const movedRows = updateInfo.changes;

    // 3. Reset local transport queues. sync_outbox and sync_inbox are
    //    transport state, not source of truth — clearing them prevents
    //    the next `sync now` from re-uploading ops tagged with the
    //    legacy user_id. The server side is untouched; old partitions
    //    become orphaned and will be pruned in a later server cleanup.
    let outboxCleared = 0;
    let inboxCleared = 0;
    if (hasTable(db, 'sync_outbox')) {
      outboxCleared = db.prepare('DELETE FROM sync_outbox').run().changes;
    }
    if (hasTable(db, 'sync_inbox')) {
      inboxCleared = db.prepare('DELETE FROM sync_inbox').run().changes;
    }

    // 4. Reset sync cursor + timestamps so the next pull starts fresh
    //    against the canonical partition.
    let cursorReset = false;
    if (hasTable(db, 'sync_state')) {
      const r = db
        .prepare(
          `DELETE FROM sync_state WHERE key IN (
             'last_cursor',
             'pull_cursor',
             'last_push_attempt_at',
             'last_push_success_at',
             'last_pull_attempt_at',
             'last_pull_success_at'
           )`,
        )
        .run();
      cursorReset = r.changes > 0;
    }

    // 5. Mark the migration applied.
    db.prepare(
      `INSERT OR IGNORE INTO migration_version (name, applied_at)
       VALUES (?, CURRENT_TIMESTAMP)`,
    ).run(MIGRATION_NAME);

    return {
      movedRows,
      legacyScopeRows,
      outboxCleared,
      inboxCleared,
      cursorReset,
    } satisfies MigrationResult;
  });

  return run();
}

// ---------------------------------------------------------------------------
// CLI glue
// ---------------------------------------------------------------------------

async function confirmInteractive(question: string): Promise<boolean> {
  // Non-TTY (piped) runs skip the prompt to avoid hanging headless
  // environments. Callers should always pass `--yes` in CI.
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${question} [y/N] `, (a) => resolve(a));
    });
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export async function run(options: MigrateOptions): Promise<void> {
  const { args, format, db: dbOverride } = options;
  const sub = args[0];

  if (sub !== 'legacy-user-ids') {
    outputError(
      'Usage: memrosetta migrate legacy-user-ids [--dry-run] [--canonical <user>] [--yes]',
      format,
    );
    process.exitCode = 1;
    return;
  }

  const sliced = args.slice(1);
  const dryRun = hasFlag(sliced, '--dry-run');
  const autoYes = hasFlag(sliced, '--yes') || hasFlag(sliced, '-y');
  const canonicalOverride = optionalOption(sliced, '--canonical');
  const canonicalUserId = resolveCanonicalUserId(canonicalOverride ?? null);

  const dbPath = resolveDbPath(dbOverride);
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(dbPath);

  try {
    // Defensive: make sure the supporting tables exist before we scan
    // or mutate. A fresh install already has them via schema v6, but
    // running `migrate` on a pre-v0.5.2 DB should still work.
    const { ensureSchema } = await import('@memrosetta/core');
    ensureSchema(db, { vectorEnabled: false });

    const report = scanLegacyImpact(db, canonicalUserId);

    if (report.alreadyMigrated && report.legacyRows === 0) {
      output(
        {
          status: 'noop',
          reason: `migration ${MIGRATION_NAME} already applied and no legacy rows remain`,
          report,
        },
        format,
      );
      return;
    }

    if (report.legacyRows === 0) {
      output(
        {
          status: 'noop',
          reason: 'no legacy user_id partitions found',
          report,
        },
        format,
      );
      return;
    }

    if (dryRun) {
      output(
        {
          status: 'dry-run',
          canonicalUserId,
          report,
          wouldClear: {
            syncOutbox: true,
            syncInbox: true,
            cursorState: true,
          },
          nextSteps: [
            'Run without --dry-run to apply the migration.',
            'After migration: `memrosetta sync backfill` then `memrosetta sync now`.',
          ],
        },
        format,
      );
      return;
    }

    if (!autoYes) {
      printImpactPreview(report, canonicalUserId);
      const ok = await confirmInteractive(
        `Apply migration and move ${report.legacyRows} row(s) onto '${canonicalUserId}'?`,
      );
      if (!ok) {
        output(
          {
            status: 'aborted',
            reason: 'user declined or non-interactive session (pass --yes to skip prompt)',
            report,
          },
          format,
        );
        return;
      }
    }

    const result = runLegacyUserIdMigration(db, canonicalUserId);

    output(
      {
        status: 'applied',
        canonicalUserId,
        migration: MIGRATION_NAME,
        result,
        nextSteps: [
          `Run \`memrosetta sync backfill --user ${canonicalUserId}\` to republish memories onto the canonical partition.`,
          'Then `memrosetta sync now` to push them to the hub.',
          'Run `memrosetta duplicates report` to audit cross-partition duplicates before any future dedupe pass.',
        ],
      },
      format,
    );
  } finally {
    db.close();
  }
}

function printImpactPreview(
  report: LegacyImpactReport,
  canonicalUserId: string,
): void {
  process.stderr.write(
    [
      '',
      'Migration impact preview',
      '------------------------',
      `  canonical user            : ${canonicalUserId}`,
      `  total memories            : ${report.totalRows}`,
      `  legacy rows to move       : ${report.legacyRows}`,
      `  distinct legacy partitions: ${report.distinctLegacyUserIds}`,
      `  sync_outbox pending       : ${report.queuePending}`,
      `  cross-partition dup groups: ${report.crossPartitionDuplicateGroups}`,
      '',
      'Top legacy partitions:',
      ...report.breakdown
        .slice(0, 10)
        .map(
          (r) =>
            `  - ${r.legacyUserId.padEnd(40)} rows=${r.rows}  namespaces=${r.distinctNamespaces}`,
        ),
      '',
      'This will:',
      '  * copy legacy rows into memory_legacy_scope (non-destructive)',
      '  * rewrite memories.user_id to the canonical user',
      '  * leave memories.namespace untouched',
      '  * clear sync_outbox / sync_inbox / sync cursor state',
      '',
      'Back up ~/.memrosetta/memories.db before continuing if you have not already.',
      '',
    ].join('\n'),
  );
}
