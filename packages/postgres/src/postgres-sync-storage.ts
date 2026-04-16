import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import type {
  SyncOp,
  SyncPushResult,
  SyncPulledOp,
} from '@memrosetta/types';

import type {
  AuthenticatedUser,
  ISyncStorage,
} from './sync-storage.js';
import { Migrator } from './migrator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

export interface PostgresSyncStorageOptions {
  /** PostgreSQL connection string, e.g. "postgres://user:pass@host:5432/db" */
  readonly databaseUrl: string;
  /** SSL reject-unauthorized setting (default: false for cloud DBs). */
  readonly sslRejectUnauthorized?: boolean;
  /** Max pool size (default: 10). */
  readonly maxPoolSize?: number;
}

export class PostgresSyncStorage implements ISyncStorage {
  private readonly pool: Pool;

  constructor(options: PostgresSyncStorageOptions) {
    const { databaseUrl, sslRejectUnauthorized = false, maxPoolSize = 10 } = options;
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: maxPoolSize,
      ssl: { rejectUnauthorized: sslRejectUnauthorized },
    });
  }

  /** For testing: create an instance from an existing Pool. */
  static fromPool(pool: Pool): PostgresSyncStorage {
    const instance = Object.create(PostgresSyncStorage.prototype) as PostgresSyncStorage;
    (instance as unknown as { pool: Pool }).pool = pool;
    return instance;
  }

  async initialize(): Promise<void> {
    const migrator = new Migrator(this.pool, MIGRATIONS_DIR);
    await migrator.migrate();
  }

  async pushOps(
    ownerUserId: string,
    ops: readonly SyncOp[],
  ): Promise<readonly SyncPushResult[]> {
    if (ops.length === 0) {
      return [];
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const results: SyncPushResult[] = [];

      for (const op of ops) {
        const { rows } = await client.query<{ cursor: string }>(
          `INSERT INTO sync_ops (owner_user_id, user_id, op_id, device_id, op_type, created_at, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (owner_user_id, op_id) DO NOTHING
           RETURNING cursor`,
          [ownerUserId, op.userId, op.opId, op.deviceId, op.opType, op.createdAt, JSON.stringify(op.payload)],
        );

        if (rows.length > 0) {
          results.push({
            opId: op.opId,
            status: 'accepted',
            cursor: Number(rows[0].cursor),
          });
        } else {
          // Duplicate -- fetch existing cursor
          const existing = await client.query<{ cursor: string }>(
            `SELECT cursor FROM sync_ops WHERE owner_user_id = $1 AND op_id = $2`,
            [ownerUserId, op.opId],
          );
          results.push({
            opId: op.opId,
            status: 'duplicate',
            cursor: existing.rows.length > 0 ? Number(existing.rows[0].cursor) : 0,
          });
        }
      }

      await client.query('COMMIT');
      return results;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async pullOps(
    ownerUserId: string,
    since: number,
    limit: number,
  ): Promise<{ readonly ops: readonly SyncPulledOp[]; readonly hasMore: boolean }> {
    // Fetch limit + 1 to determine hasMore
    const { rows } = await this.pool.query<{
      cursor: string;
      user_id: string;
      op_id: string;
      device_id: string;
      op_type: string;
      created_at: Date;
      received_at: Date;
      api_version: number;
      source_seq: string | null;
      payload: unknown;
    }>(
      `SELECT cursor, user_id, op_id, device_id, op_type,
              created_at, received_at, api_version, source_seq, payload
       FROM sync_ops
       WHERE owner_user_id = $1 AND cursor > $2
       ORDER BY cursor ASC
       LIMIT $3`,
      [ownerUserId, since, limit + 1],
    );

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;

    const ops: SyncPulledOp[] = sliced.map((row) => ({
      cursor: Number(row.cursor),
      opId: row.op_id,
      opType: row.op_type as SyncPulledOp['opType'],
      deviceId: row.device_id,
      userId: row.user_id,
      createdAt: row.created_at.toISOString(),
      receivedAt: row.received_at.toISOString(),
      sourceSeq: row.source_seq != null ? Number(row.source_seq) : undefined,
      payload: row.payload,
    }));

    return { ops, hasMore };
  }

  async getHighWatermark(ownerUserId: string): Promise<number> {
    const { rows } = await this.pool.query<{ hwm: string | null }>(
      `SELECT MAX(cursor) AS hwm FROM sync_ops WHERE owner_user_id = $1`,
      [ownerUserId],
    );
    return rows[0]?.hwm != null ? Number(rows[0].hwm) : 0;
  }

  async upsertAuthenticatedUser(user: AuthenticatedUser): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (owner_user_id, email, roles, created_at, last_seen_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (owner_user_id)
       DO UPDATE SET
         email = EXCLUDED.email,
         roles = EXCLUDED.roles,
         last_seen_at = NOW()`,
      [user.ownerUserId, user.email, JSON.stringify(user.roles)],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
