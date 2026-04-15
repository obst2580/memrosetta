import type Database from 'better-sqlite3';
import type {
  SyncPushResponse,
  SyncPullResponse,
  SyncPushResult,
} from './types.js';
import { ensureSyncSchema } from './schema.js';
import { Outbox } from './outbox.js';
import { Inbox } from './inbox.js';
import { applyInboxOps, type ApplyResult } from './applier.js';

/**
 * Minimal config required by SyncClient at runtime.
 * serverUrl and apiKey are required (unlike the optional SyncConfig
 * from @memrosetta/types which is aimed at feature-flag configuration).
 */
export interface SyncClientConfig {
  readonly serverUrl: string;
  readonly apiKey: string;
  readonly deviceId: string;
  readonly userId: string;
}

export interface SyncClientPushResponse {
  readonly pushed: number;
  readonly results: readonly SyncPushResult[];
  readonly highWatermark: number;
}

export interface SyncStatusTimestamps {
  readonly attemptAt: string | null;
  readonly successAt: string | null;
}

export interface SyncClientStatus {
  readonly enabled: true;
  readonly serverUrl: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly pendingOps: number;
  readonly lastPush: SyncStatusTimestamps;
  readonly lastPull: SyncStatusTimestamps;
  readonly cursor: number;
}

export class SyncClient {
  private readonly db: Database.Database;
  private readonly config: SyncClientConfig;
  private readonly outbox: Outbox;
  private readonly inbox: Inbox;

  constructor(db: Database.Database, config: SyncClientConfig) {
    this.db = db;
    this.config = config;
    this.outbox = new Outbox(db);
    this.inbox = new Inbox(db);
  }

  initialize(): void {
    ensureSyncSchema(this.db);
  }

  getOutbox(): Outbox {
    return this.outbox;
  }

  getInbox(): Inbox {
    return this.inbox;
  }

  getStatus(): SyncClientStatus {
    return {
      enabled: true,
      serverUrl: this.config.serverUrl,
      userId: this.config.userId,
      deviceId: this.config.deviceId,
      pendingOps: this.outbox.countPending(),
      lastPush: {
        attemptAt: this.getState('last_push_attempt_at'),
        successAt: this.getState('last_push_success_at'),
      },
      lastPull: {
        attemptAt: this.getState('last_pull_attempt_at'),
        successAt: this.getState('last_pull_success_at'),
      },
      cursor: this.getCursor(),
    };
  }

  async push(): Promise<SyncClientPushResponse> {
    const now = new Date().toISOString();
    this.setState('last_push_attempt_at', now);

    const pending = this.outbox.getPending();
    if (pending.length === 0) {
      this.setState('last_push_success_at', now);
      return { pushed: 0, results: [], highWatermark: 0 };
    }

    const baseCursor = this.getCursor();

    // Build wire ops: payload stored as JSON string in SQLite needs to be
    // sent as a parsed object over HTTP.
    const wireOps = pending.map((op) => ({
      ...op,
      payload: typeof op.payload === 'string' ? JSON.parse(op.payload as string) : op.payload,
    }));

    const url = `${this.config.serverUrl}/sync/push`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        deviceId: this.config.deviceId,
        baseCursor,
        ops: wireOps,
      }),
    });

    if (!response.ok) {
      throw new Error(`Push failed: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as SyncPushResponse;
    const { results, highWatermark } = body.data;

    // Mark accepted and duplicate ops as pushed
    const pushedIds = results
      .filter((r) => r.status === 'accepted' || r.status === 'duplicate')
      .map((r) => r.opId);

    this.outbox.markPushed(pushedIds);

    // Advance cursor to server's highWatermark
    this.setCursor(highWatermark);
    this.setState('last_push_success_at', new Date().toISOString());

    return {
      pushed: pushedIds.length,
      results,
      highWatermark,
    };
  }

  async pull(): Promise<number> {
    this.setState('last_pull_attempt_at', new Date().toISOString());
    const since = this.getCursor();

    const params = new URLSearchParams({
      since: String(since),
      userId: this.config.userId,
    });

    const url = `${this.config.serverUrl}/sync/pull?${params.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Pull failed: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as SyncPullResponse;
    const { ops, nextCursor } = body.data;

    // 1. Land incoming ops in the inbox (idempotent INSERT OR IGNORE by op_id).
    if (ops.length > 0) {
      this.inbox.addOps(ops);
    }

    // 2. Apply any inbox ops that have not yet been folded into the local
    //    memories / relations tables. This covers both the batch we just
    //    received and any leftovers from a prior failed pull.
    const pending = this.inbox.getPending();
    let skippedCount = 0;
    if (pending.length > 0) {
      const result = applyInboxOps(this.db, pending);
      if (result.applied.length > 0) {
        this.inbox.markApplied(result.applied);
      }
      skippedCount = result.skipped.length;
      if (skippedCount > 0) {
        for (const s of result.skipped) {
          process.stderr.write(
            `[sync] apply skipped op ${s.opId}: ${s.reason}\n`,
          );
        }
      }
    }

    // 3. Advance cursor so we don't re-download the same batch. Skipped
    //    ops stay pending in sync_inbox — a future pull or explicit
    //    applyPendingInbox() will retry them.
    this.setCursor(nextCursor);

    // 4. Only claim a clean success when every applied op landed. If any
    //    were skipped we leave last_pull_success_at untouched so
    //    `memrosetta sync status` reflects the partial state.
    if (skippedCount === 0) {
      this.setState('last_pull_success_at', new Date().toISOString());
    }

    return ops.length;
  }

  /** For tests / advanced callers: apply currently-pending inbox ops manually. */
  applyPendingInbox(): ApplyResult {
    const pending = this.inbox.getPending();
    if (pending.length === 0) {
      return { applied: [], skipped: [] };
    }
    const result = applyInboxOps(this.db, pending);
    if (result.applied.length > 0) {
      this.inbox.markApplied(result.applied);
    }
    return result;
  }

  getState(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM sync_state WHERE key = ?')
      .get(key) as { value: string } | undefined;

    return row?.value ?? null;
  }

  setState(key: string, value: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)')
      .run(key, value);
  }

  private getCursor(): number {
    const cursorStr =
      this.getState('last_cursor') ??
      this.getState('pull_cursor');

    return cursorStr ? parseInt(cursorStr, 10) : 0;
  }

  private setCursor(cursor: number): void {
    const value = String(cursor);
    this.setState('last_cursor', value);
    this.setState('pull_cursor', value);
  }
}
