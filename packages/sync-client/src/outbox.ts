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
    this.db
      .prepare(
        `INSERT INTO sync_outbox (op_id, op_type, device_id, user_id, payload, created_at, pushed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(op.opId, op.opType, op.deviceId, op.userId, payloadStr, op.createdAt, null);
  }

  getPending(): readonly SyncOp[] {
    const rows = this.db
      .prepare('SELECT * FROM sync_outbox WHERE pushed_at IS NULL ORDER BY created_at ASC')
      .all() as readonly OutboxRow[];

    return rows.map(rowToSyncOp);
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
