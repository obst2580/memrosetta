import type Database from 'better-sqlite3';
import type { SyncPulledOp } from './types.js';

interface InboxRow {
  readonly op_id: string;
  readonly op_type: string;
  readonly device_id: string;
  readonly user_id: string;
  readonly payload: string;
  readonly created_at: string;
  readonly applied_at: string | null;
}

function rowToPulledOp(row: InboxRow): SyncPulledOp {
  return {
    opId: row.op_id,
    opType: row.op_type,
    deviceId: row.device_id,
    userId: row.user_id,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

export class Inbox {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  addOps(ops: readonly SyncPulledOp[]): void {
    if (ops.length === 0) return;

    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO sync_inbox (op_id, op_type, device_id, user_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    const insertMany = this.db.transaction((items: readonly SyncPulledOp[]) => {
      for (const op of items) {
        stmt.run(op.opId, op.opType, op.deviceId, op.userId, op.payload, op.createdAt);
      }
    });

    insertMany(ops);
  }

  getPending(): readonly SyncPulledOp[] {
    const rows = this.db
      .prepare('SELECT * FROM sync_inbox WHERE applied_at IS NULL ORDER BY created_at ASC')
      .all() as readonly InboxRow[];

    return rows.map(rowToPulledOp);
  }

  markApplied(opIds: readonly string[]): void {
    if (opIds.length === 0) return;

    const now = new Date().toISOString();
    const placeholders = opIds.map(() => '?').join(', ');
    this.db
      .prepare(`UPDATE sync_inbox SET applied_at = ? WHERE op_id IN (${placeholders})`)
      .run(now, ...opIds);
  }
}
