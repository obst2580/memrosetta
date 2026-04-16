import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ensureSchema, ensureSyncSchema } from '@memrosetta/core';
import {
  scanLegacyImpact,
  runLegacyUserIdMigration,
} from '../../src/commands/migrate.js';
import { ensureSyncSchema as ensureSyncSchemaClient } from '@memrosetta/sync-client';

// The sync schema lives in @memrosetta/sync-client; we use it here so
// the migrate command's queue-reset path has something to delete from.

function seedMemories(
  db: Database.Database,
  rows: ReadonlyArray<{
    memoryId: string;
    userId: string;
    namespace: string | null;
    content: string;
  }>,
): void {
  const stmt = db.prepare(`
    INSERT INTO memories (
      memory_id, user_id, namespace, memory_type, content, learned_at, is_latest
    ) VALUES (?, ?, ?, 'fact', ?, '2026-04-15T00:00:00.000Z', 1)
  `);
  for (const r of rows) stmt.run(r.memoryId, r.userId, r.namespace, r.content);
}

function seedOutboxOp(
  db: Database.Database,
  opId: string,
  userId: string,
): void {
  db.prepare(`
    INSERT INTO sync_outbox (op_id, op_type, device_id, user_id, payload, created_at, pushed_at)
    VALUES (?, 'memory_created', 'device-test', ?, '{}', '2026-04-15T00:00:00Z', NULL)
  `).run(opId, userId);
}

describe('migrate legacy-user-ids', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    ensureSchema(db, { vectorEnabled: false });
    ensureSyncSchemaClient(db);

    seedMemories(db, [
      { memoryId: 'mem-1', userId: 'obst', namespace: 'session-a', content: 'canonical one' },
      { memoryId: 'mem-2', userId: 'obst', namespace: 'session-a', content: 'canonical two' },
      { memoryId: 'mem-3', userId: 'work/tech-manage-api', namespace: 'session-b', content: 'legacy one' },
      { memoryId: 'mem-4', userId: 'work/tech-manage-api', namespace: 'session-b', content: 'legacy two' },
      { memoryId: 'mem-5', userId: 'personal/memrosetta', namespace: 'session-c', content: 'legacy three' },
      { memoryId: 'mem-6', userId: 'general', namespace: null, content: 'legacy four' },
    ]);

    seedOutboxOp(db, 'op-canonical-1', 'obst');
    seedOutboxOp(db, 'op-legacy-1', 'work/tech-manage-api');
    seedOutboxOp(db, 'op-legacy-2', 'personal/memrosetta');

    db.prepare(
      `INSERT INTO sync_state (key, value) VALUES ('last_cursor', '123')`,
    ).run();
    db.prepare(
      `INSERT INTO sync_state (key, value) VALUES ('pull_cursor', '123')`,
    ).run();
  });

  afterEach(() => {
    db.close();
  });

  describe('scanLegacyImpact', () => {
    it('counts legacy rows, distinct partitions, and queue pending', () => {
      const report = scanLegacyImpact(db, 'obst');
      expect(report.canonicalUserId).toBe('obst');
      expect(report.totalRows).toBe(6);
      expect(report.legacyRows).toBe(4);
      expect(report.distinctLegacyUserIds).toBe(3);
      expect(report.queuePending).toBe(3);
      expect(report.alreadyMigrated).toBe(false);
      // breakdown ordered by row count desc
      expect(report.breakdown[0]).toEqual({
        legacyUserId: 'work/tech-manage-api',
        rows: 2,
        distinctNamespaces: 1,
      });
    });

    it('reports zero legacy rows when everything is already on canonical', () => {
      db.prepare('UPDATE memories SET user_id = ?').run('obst');
      const report = scanLegacyImpact(db, 'obst');
      expect(report.legacyRows).toBe(0);
      expect(report.distinctLegacyUserIds).toBe(0);
    });

    it('detects already-applied migration marker', () => {
      db.prepare(
        `INSERT INTO migration_version (name, applied_at) VALUES ('legacy-user-id-to-canonical-v1', CURRENT_TIMESTAMP)`,
      ).run();
      const report = scanLegacyImpact(db, 'obst');
      expect(report.alreadyMigrated).toBe(true);
    });
  });

  describe('runLegacyUserIdMigration', () => {
    it('moves legacy rows onto canonical user and preserves namespace', () => {
      const result = runLegacyUserIdMigration(db, 'obst');

      expect(result.movedRows).toBe(4);
      expect(result.legacyScopeRows).toBe(4);

      const ownerCounts = db
        .prepare('SELECT user_id, COUNT(*) AS c FROM memories GROUP BY user_id')
        .all() as readonly { user_id: string; c: number }[];
      expect(ownerCounts).toEqual([{ user_id: 'obst', c: 6 }]);

      // namespace is preserved exactly as it was.
      const ns = db
        .prepare('SELECT namespace FROM memories WHERE memory_id = ?')
        .get('mem-3') as { namespace: string };
      expect(ns.namespace).toBe('session-b');
    });

    it('records legacy_user_id and legacy_namespace snapshot', () => {
      runLegacyUserIdMigration(db, 'obst');
      const rows = db
        .prepare('SELECT memory_id, legacy_user_id, legacy_namespace FROM memory_legacy_scope ORDER BY memory_id')
        .all() as readonly {
          memory_id: string;
          legacy_user_id: string;
          legacy_namespace: string | null;
        }[];
      expect(rows).toEqual([
        { memory_id: 'mem-3', legacy_user_id: 'work/tech-manage-api', legacy_namespace: 'session-b' },
        { memory_id: 'mem-4', legacy_user_id: 'work/tech-manage-api', legacy_namespace: 'session-b' },
        { memory_id: 'mem-5', legacy_user_id: 'personal/memrosetta', legacy_namespace: 'session-c' },
        { memory_id: 'mem-6', legacy_user_id: 'general', legacy_namespace: null },
      ]);
    });

    it('clears sync_outbox, sync_inbox, and cursor state', () => {
      const result = runLegacyUserIdMigration(db, 'obst');
      expect(result.outboxCleared).toBeGreaterThan(0);
      expect(result.cursorReset).toBe(true);

      const outbox = db.prepare('SELECT COUNT(*) AS c FROM sync_outbox').get() as { c: number };
      expect(outbox.c).toBe(0);

      const inbox = db.prepare('SELECT COUNT(*) AS c FROM sync_inbox').get() as { c: number };
      expect(inbox.c).toBe(0);

      const cursor = db
        .prepare(`SELECT value FROM sync_state WHERE key = 'last_cursor'`)
        .get();
      expect(cursor).toBeUndefined();
    });

    it('marks the migration applied in migration_version', () => {
      runLegacyUserIdMigration(db, 'obst');
      const row = db
        .prepare('SELECT name FROM migration_version WHERE name = ?')
        .get('legacy-user-id-to-canonical-v1') as { name: string } | undefined;
      expect(row?.name).toBe('legacy-user-id-to-canonical-v1');
    });

    it('is idempotent - rerun after migration is a no-op', () => {
      runLegacyUserIdMigration(db, 'obst');
      const again = runLegacyUserIdMigration(db, 'obst');
      expect(again.movedRows).toBe(0);
      expect(again.legacyScopeRows).toBe(0);

      // memory_legacy_scope still only has the original 4 rows.
      const count = db
        .prepare('SELECT COUNT(*) AS c FROM memory_legacy_scope')
        .get() as { c: number };
      expect(count.c).toBe(4);
    });
  });
});
