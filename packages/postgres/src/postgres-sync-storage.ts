import { createHash, randomUUID } from 'node:crypto';
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
  DeviceAuthStart,
  ISyncStorage,
  SessionTokens,
  StoredDeviceAuthRequest,
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

  async createDeviceAuthRequest(input: DeviceAuthStart): Promise<StoredDeviceAuthRequest> {
    const { rows } = await this.pool.query<{
      id: string;
      provider: string;
      device_id: string;
      user_code: string;
      verification_uri: string;
      interval_seconds: number;
      expires_at: Date;
      provider_device_code: string;
      status: string;
      created_at: Date;
      completed_at: Date | null;
    }>(
      `INSERT INTO auth_device_requests (
         id, provider, device_id, user_code, verification_uri,
         interval_seconds, expires_at, provider_device_code, status, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW())
       RETURNING id, provider, device_id, user_code, verification_uri,
                 interval_seconds, expires_at, provider_device_code,
                 status, created_at, completed_at`,
      [
        cryptoRandomUuid(),
        input.provider,
        input.deviceId,
        input.userCode,
        input.verificationUri,
        input.intervalSeconds,
        input.expiresAt,
        input.providerDeviceCode,
      ],
    );

    return mapDeviceAuthRequest(rows[0]);
  }

  async getDeviceAuthRequest(id: string): Promise<StoredDeviceAuthRequest | null> {
    const { rows } = await this.pool.query<{
      id: string;
      provider: string;
      device_id: string;
      user_code: string;
      verification_uri: string;
      interval_seconds: number;
      expires_at: Date;
      provider_device_code: string;
      status: string;
      created_at: Date;
      completed_at: Date | null;
    }>(
      `SELECT id, provider, device_id, user_code, verification_uri,
              interval_seconds, expires_at, provider_device_code,
              status, created_at, completed_at
       FROM auth_device_requests
       WHERE id = $1`,
      [id],
    );

    return rows[0] ? mapDeviceAuthRequest(rows[0]) : null;
  }

  async markDeviceAuthRequestCompleted(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_device_requests
       SET status = 'completed', completed_at = NOW()
       WHERE id = $1`,
      [id],
    );
  }

  async markDeviceAuthRequestExpired(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_device_requests
       SET status = 'expired'
       WHERE id = $1`,
      [id],
    );
  }

  async upsertAuthenticatedUser(user: AuthenticatedUser): Promise<{ readonly userId: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query<{ user_id: string }>(
        `SELECT user_id
         FROM auth_accounts
         WHERE provider = $1 AND provider_subject = $2`,
        [user.provider, user.providerSubject],
      );

      const userId = existing.rows[0]?.user_id ?? cryptoRandomUuid();

      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO users (id, primary_email, display_name, created_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [userId, user.email, user.displayName],
        );
      } else {
        await client.query(
          `UPDATE users
           SET primary_email = COALESCE($2, primary_email),
               display_name = COALESCE($3, display_name)
           WHERE id = $1`,
          [userId, user.email, user.displayName],
        );
      }

      await client.query(
        `INSERT INTO auth_accounts (
           id, user_id, provider, provider_subject, email, display_name, created_at, last_login_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (provider, provider_subject)
         DO UPDATE SET
           user_id = EXCLUDED.user_id,
           email = EXCLUDED.email,
           display_name = EXCLUDED.display_name,
           last_login_at = NOW()`,
        [cryptoRandomUuid(), userId, user.provider, user.providerSubject, user.email, user.displayName],
      );

      await client.query('COMMIT');
      return { userId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async createSession(
    userId: string,
    deviceId: string,
    tokens: SessionTokens,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (
         id, user_id, device_id,
         access_token_hash, refresh_token_hash,
         access_expires_at, refresh_expires_at,
         created_at, last_seen_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [
        cryptoRandomUuid(),
        userId,
        deviceId,
        hashToken(tokens.accessToken),
        hashToken(tokens.refreshToken),
        tokens.accessExpiresAt,
        tokens.refreshExpiresAt,
      ],
    );
  }

  async refreshSession(
    refreshToken: string,
    nextTokens: SessionTokens,
  ): Promise<{ readonly userId: string; readonly deviceId: string } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ user_id: string; device_id: string }>(
        `SELECT user_id, device_id
         FROM sessions
         WHERE refresh_token_hash = $1
           AND revoked_at IS NULL
           AND refresh_expires_at > NOW()
         LIMIT 1`,
        [hashToken(refreshToken)],
      );

      const row = current.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(
        `UPDATE sessions
         SET access_token_hash = $2,
             refresh_token_hash = $3,
             access_expires_at = $4,
             refresh_expires_at = $5,
             last_seen_at = NOW()
         WHERE refresh_token_hash = $1`,
        [
          hashToken(refreshToken),
          hashToken(nextTokens.accessToken),
          hashToken(nextTokens.refreshToken),
          nextTokens.accessExpiresAt,
          nextTokens.refreshExpiresAt,
        ],
      );

      await client.query('COMMIT');
      return {
        userId: row.user_id,
        deviceId: row.device_id,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getSessionByAccessToken(
    accessToken: string,
  ): Promise<{ readonly userId: string; readonly deviceId: string } | null> {
    const { rows } = await this.pool.query<{ user_id: string; device_id: string }>(
      `SELECT user_id, device_id
       FROM sessions
       WHERE access_token_hash = $1
         AND revoked_at IS NULL
         AND access_expires_at > NOW()
       LIMIT 1`,
      [hashToken(accessToken)],
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    await this.pool.query(
      `UPDATE sessions SET last_seen_at = NOW() WHERE access_token_hash = $1`,
      [hashToken(accessToken)],
    );

    return {
      userId: row.user_id,
      deviceId: row.device_id,
    };
  }

  async revokeSessionByAccessToken(accessToken: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE sessions
       SET revoked_at = NOW()
       WHERE access_token_hash = $1
         AND revoked_at IS NULL`,
      [hashToken(accessToken)],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cryptoRandomUuid(): string {
  return randomUUID();
}

function mapDeviceAuthRequest(row: {
  id: string;
  provider: string;
  device_id: string;
  user_code: string;
  verification_uri: string;
  interval_seconds: number;
  expires_at: Date;
  provider_device_code: string;
  status: string;
  created_at: Date;
  completed_at: Date | null;
}): StoredDeviceAuthRequest {
  return {
    id: row.id,
    provider: row.provider as StoredDeviceAuthRequest['provider'],
    deviceId: row.device_id,
    userCode: row.user_code,
    verificationUri: row.verification_uri,
    intervalSeconds: row.interval_seconds,
    expiresAt: row.expires_at.toISOString(),
    providerDeviceCode: row.provider_device_code,
    status: row.status as StoredDeviceAuthRequest['status'],
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}
