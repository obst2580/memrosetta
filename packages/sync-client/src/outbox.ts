import type Database from 'better-sqlite3';
import type { SyncOp } from './types.js';

interface OutboxRow {
  readonly op_id: string;
  readonly op_type: string;
  readonly device_id: string;
  readonly user_id: string;
  readonly payload: string;
  readonly created_at: string;
  readonly pushed_at: string | null;
}

function rowToSyncOp(row: OutboxRow): SyncOp {
  return {
    opId: row.op_id,
    opType: row.op_type as SyncOp['opType'],
    deviceId: row.device_id,
    userId: row.user_id,
    payload: JSON.parse(row.payload) as unknown,
    createdAt: row.created_at,
  };
}

export class Outbox {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  addOp(op: SyncOp): void {
    const payloadStr =
      typeof op.payload === 'string' ? op.payload : JSON.stringify(op.payload);
    // INSERT OR IGNORE so deterministic op ids (used by `sync backfill`)
    // silently deduplicate on re-run instead of raising UNIQUE constraint
    // errors.
    this.db
      .prepare(
        `INSERT OR IGNORE INTO sync_outbox (op_id, op_type, device_id, user_id, payload, created_at, pushed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(op.opId, op.opType, op.deviceId, op.userId, payloadStr, op.createdAt, null);
  }

  /**
   * Return pending outbox ops in chronological order.
   *
   * When `userId` is supplied, only ops belonging to that user are
   * returned. This is the v0.5.2 hardening that prevents a
   * cross-user fragmentation: if an older client wrote ops under a
   * legacy `user_id` and the current `SyncClient` is configured with
   * a canonical user, the transport will no longer silently pick up
   * the legacy ops and ship them to the hub. The legacy queue is
   * cleared by `memrosetta migrate legacy-user-ids` before the first
   * post-migration push so this filter is defense-in-depth, not the
   * primary fix.
   */
  getPending(userId?: string): readonly SyncOp[] {
    const rows =
      userId && userId.length > 0
        ? (this.db
            .prepare(
              'SELECT * FROM sync_outbox WHERE pushed_at IS NULL AND user_id = ? ORDER BY created_at ASC',
            )
            .all(userId) as readonly OutboxRow[])
        : (this.db
            .prepare('SELECT * FROM sync_outbox WHERE pushed_at IS NULL ORDER BY created_at ASC')
            .all() as readonly OutboxRow[]);

    return rows.map(rowToSyncOp);
  }

  countPending(userId?: string): number {
    const row =
      userId && userId.length > 0
        ? (this.db
            .prepare('SELECT COUNT(*) as count FROM sync_outbox WHERE pushed_at IS NULL AND user_id = ?')
            .get(userId) as { count: number })
        : (this.db
            .prepare('SELECT COUNT(*) as count FROM sync_outbox WHERE pushed_at IS NULL')
            .get() as { count: number });

    return row.count;
  }

  markPushed(opIds: readonly string[]): void {
    if (opIds.length === 0) return;

    const now = new Date().toISOString();
    const placeholders = opIds.map(() => '?').join(', ');
    this.db
      .prepare(`UPDATE sync_outbox SET pushed_at = ? WHERE op_id IN (${placeholders})`)
      .run(now, ...opIds);
  }
}
