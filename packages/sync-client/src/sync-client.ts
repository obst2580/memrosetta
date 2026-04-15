import type Database from 'better-sqlite3';
import type { SyncConfig, SyncPushResponse, ServerPushResponse, ServerPullResponse } from './types.js';
import { ensureSyncSchema } from './schema.js';
import { Outbox } from './outbox.js';
import { Inbox } from './inbox.js';

export class SyncClient {
  private readonly db: Database.Database;
  private readonly config: SyncConfig;
  private readonly outbox: Outbox;
  private readonly inbox: Inbox;

  constructor(db: Database.Database, config: SyncConfig) {
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

  async push(): Promise<SyncPushResponse> {
    const pending = this.outbox.getPending();
    if (pending.length === 0) {
      return { pushed: 0, acknowledged: [] };
    }

    const url = `${this.config.serverUrl}/sync/push`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        deviceId: this.config.deviceId,
        userId: this.config.userId,
        ops: pending,
      }),
    });

    if (!response.ok) {
      throw new Error(`Push failed: ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as ServerPushResponse;
    const acknowledged = body.acknowledged;

    this.outbox.markPushed(acknowledged);

    return {
      pushed: acknowledged.length,
      acknowledged,
    };
  }

  async pull(): Promise<number> {
    const cursor = this.getState('pull_cursor');
    const params = new URLSearchParams({
      deviceId: this.config.deviceId,
      userId: this.config.userId,
    });
    if (cursor) {
      params.set('cursor', cursor);
    }

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

    const body = (await response.json()) as ServerPullResponse;
    const ops = body.ops;

    if (ops.length > 0) {
      this.inbox.addOps(ops);
    }

    if (body.cursor) {
      this.setState('pull_cursor', body.cursor);
    }

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
