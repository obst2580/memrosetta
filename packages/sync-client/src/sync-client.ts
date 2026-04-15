import type Database from 'better-sqlite3';
import type {
  SyncPushResponse,
  SyncPullResponse,
  SyncPushResult,
} from './types.js';
import { ensureSyncSchema } from './schema.js';
import { Outbox } from './outbox.js';
import { Inbox } from './inbox.js';

/**
 * Minimal config required by SyncClient at runtime.
 * serverUrl and apiKey are required (unlike the optional SyncConfig
 * from @memrosetta/types which is aimed at feature-flag configuration).
 */
export interface SyncClientConfig {
  readonly serverUrl: string;
  readonly apiKey: string;
  readonly deviceId: string;
}

export interface SyncClientPushResponse {
  readonly pushed: number;
  readonly results: readonly SyncPushResult[];
  readonly highWatermark: number;
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

  async push(): Promise<SyncClientPushResponse> {
    const pending = this.outbox.getPending();
    if (pending.length === 0) {
      return { pushed: 0, results: [], highWatermark: 0 };
    }

    const baseCursorStr = this.getState('pull_cursor');
    const baseCursor = baseCursorStr ? parseInt(baseCursorStr, 10) : 0;

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

    // Advance pull_cursor to server's highWatermark
    this.setState('pull_cursor', String(highWatermark));

    return {
      pushed: pushedIds.length,
      results,
      highWatermark,
    };
  }

  async pull(): Promise<number> {
    const cursorStr = this.getState('pull_cursor');
    const since = cursorStr ? parseInt(cursorStr, 10) : 0;

    const params = new URLSearchParams({
      since: String(since),
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
    const { ops, nextCursor, hasMore } = body.data;

    if (ops.length > 0) {
      this.inbox.addOps(ops);
    }

    // Advance cursor
    this.setState('pull_cursor', String(nextCursor));

    return ops.length;
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
}
