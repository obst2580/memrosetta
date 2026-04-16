import type Database from 'better-sqlite3';
import type {
  SyncPushResponse,
  SyncPullResponse,
  SyncPushResult,
  SyncOp,
} from './types.js';
import { ensureSyncSchema } from './schema.js';
import { Outbox } from './outbox.js';
import { Inbox } from './inbox.js';
import { applyInboxOps, type ApplyResult } from './applier.js';

/**
 * Maximum ops per /sync/push HTTP call. The server's zod schema caps
 * each push at 500 ops (see adapters/sync-server push route), so we
 * chunk below that with a safety margin. Large backfills (thousands
 * of memories) are split across multiple sequential HTTP requests and
 * each batch is marked pushed as soon as it succeeds — that way a
 * mid-run failure still makes forward progress instead of rolling
 * the whole backfill back.
 */
const MAX_OPS_PER_PUSH = 400;

/**
 * Limit passed to /sync/pull per round-trip. The server caps at 1000
 * (MAX_LIMIT in sync-server pull route) so we request the maximum to
 * minimize round-trips when a new device needs to catch up on tens of
 * thousands of ops. pull() loops until `hasMore` is false.
 */
const PULL_PAGE_SIZE = 1000;

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
      pendingOps: this.outbox.countPending(this.config.userId),
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

    // v0.5.2 hardening: only push ops belonging to the configured
    // canonical user. Legacy ops tagged with a fragmented user_id
    // stay parked in sync_outbox until `memrosetta migrate
    // legacy-user-ids` rewrites them (or the user clears the queue
    // manually). This prevents old fragmented partitions from
    // silently republishing after a migration.
    const pending = this.outbox.getPending(this.config.userId);
    if (pending.length === 0) {
      this.setState('last_push_success_at', now);
      return { pushed: 0, results: [], highWatermark: 0 };
    }

    const url = `${this.config.serverUrl}/sync/push`;
    const aggregatedResults: SyncPushResult[] = [];
    let totalPushed = 0;
    let highWatermark = 0;

    // Chunk pending ops across multiple HTTP requests. Each batch is
    // acknowledged and marked pushed before moving on, so a mid-run
    // failure still commits the batches that succeeded.
    for (let start = 0; start < pending.length; start += MAX_OPS_PER_PUSH) {
      const chunk = pending.slice(start, start + MAX_OPS_PER_PUSH);
      const baseCursor = this.getCursor();

      const wireOps = chunk.map((op: SyncOp) => ({
        ...op,
        payload:
          typeof op.payload === 'string'
            ? JSON.parse(op.payload as string)
            : op.payload,
      }));

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
        throw new Error(
          `Push failed: ${response.status} ${response.statusText}`,
        );
      }

      const body = (await response.json()) as SyncPushResponse;
      const { results, highWatermark: batchHigh } = body.data;

      const pushedIds = results
        .filter((r) => r.status === 'accepted' || r.status === 'duplicate')
        .map((r) => r.opId);

      this.outbox.markPushed(pushedIds);
      this.setCursor(batchHigh);

      aggregatedResults.push(...results);
      totalPushed += pushedIds.length;
      highWatermark = batchHigh;
    }

    this.setState('last_push_success_at', new Date().toISOString());

    return {
      pushed: totalPushed,
      results: aggregatedResults,
      highWatermark,
    };
  }

  async pull(): Promise<number> {
    this.setState('last_pull_attempt_at', new Date().toISOString());

    let totalPulled = 0;
    let totalSkipped = 0;
    let hasMore = true;

    // Loop until the server says there are no more pages. Each page
    // is applied immediately so a mid-run failure still advances the
    // cursor to the last successful page boundary.
    while (hasMore) {
      const since = this.getCursor();

      const params = new URLSearchParams({
        since: String(since),
        userId: this.config.userId,
        limit: String(PULL_PAGE_SIZE),
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
      hasMore = body.data.hasMore ?? false;

      if (ops.length > 0) {
        this.inbox.addOps(ops);
      }

      const pending = this.inbox.getPending();
      if (pending.length > 0) {
        const result = applyInboxOps(this.db, pending);
        if (result.applied.length > 0) {
          this.inbox.markApplied(result.applied);
        }
        totalSkipped += result.skipped.length;
        if (result.skipped.length > 0) {
          for (const s of result.skipped) {
            process.stderr.write(
              `[sync] apply skipped op ${s.opId}: ${s.reason}\n`,
            );
          }
        }
      }

      this.setCursor(nextCursor);
      totalPulled += ops.length;
    }

    if (totalSkipped === 0) {
      this.setState('last_pull_success_at', new Date().toISOString());
    }

    return totalPulled;
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
