import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SyncClient } from '../src/sync-client.js';
import type { SyncConfig, ServerPushResponse, ServerPullResponse } from '../src/types.js';

const TEST_CONFIG: SyncConfig = {
  serverUrl: 'https://api.example.com',
  apiKey: 'test-api-key',
  deviceId: 'device-test',
  userId: 'user-test',
};

describe('SyncClient', () => {
  let db: Database.Database;
  let client: SyncClient;

  beforeEach(() => {
    db = new Database(':memory:');
    client = new SyncClient(db, TEST_CONFIG);
    client.initialize();
    vi.restoreAllMocks();
  });

  describe('initialize', () => {
    it('creates sync tables', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as readonly { name: string }[];
      const names = tables.map((t) => t.name);

      expect(names).toContain('sync_outbox');
      expect(names).toContain('sync_inbox');
      expect(names).toContain('sync_state');
    });

    it('is idempotent', () => {
      client.initialize();
      client.initialize();

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'sync_%'")
        .all();
      expect(tables).toHaveLength(3);
    });
  });

  describe('state management', () => {
    it('getState returns null for missing key', () => {
      expect(client.getState('nonexistent')).toBeNull();
    });

    it('setState and getState round-trip', () => {
      client.setState('cursor', 'abc123');
      expect(client.getState('cursor')).toBe('abc123');
    });

    it('setState overwrites existing value', () => {
      client.setState('cursor', 'v1');
      client.setState('cursor', 'v2');
      expect(client.getState('cursor')).toBe('v2');
    });
  });

  describe('push', () => {
    it('returns empty result when no pending ops', async () => {
      const result = await client.push();
      expect(result).toEqual({ pushed: 0, acknowledged: [] });
    });

    it('sends pending ops to server and marks them pushed', async () => {
      const outbox = client.getOutbox();
      outbox.addOp({
        opId: 'op-1',
        opType: 'store_memory',
        deviceId: TEST_CONFIG.deviceId,
        userId: TEST_CONFIG.userId,
        payload: '{"content":"hello"}',
        createdAt: '2025-01-01T00:00:00Z',
        pushedAt: null,
      });

      const mockResponse: ServerPushResponse = {
        acknowledged: ['op-1'],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await client.push();
      expect(result.pushed).toBe(1);
      expect(result.acknowledged).toEqual(['op-1']);

      const pending = outbox.getPending();
      expect(pending).toHaveLength(0);

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toBe('https://api.example.com/sync/push');
      const requestInit = fetchCall[1] as RequestInit;
      expect(requestInit.headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer test-api-key',
        }),
      );
    });

    it('throws on non-ok response', async () => {
      const outbox = client.getOutbox();
      outbox.addOp({
        opId: 'op-1',
        opType: 'store_memory',
        deviceId: TEST_CONFIG.deviceId,
        userId: TEST_CONFIG.userId,
        payload: '{}',
        createdAt: '2025-01-01T00:00:00Z',
        pushedAt: null,
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
      );

      await expect(client.push()).rejects.toThrow('Push failed: 401 Unauthorized');
    });
  });

  describe('pull', () => {
    it('fetches ops from server and stores in inbox', async () => {
      const mockResponse: ServerPullResponse = {
        ops: [
          {
            opId: 'remote-1',
            opType: 'store_memory',
            deviceId: 'other-device',
            userId: 'user-test',
            payload: '{"content":"from server"}',
            createdAt: '2025-01-01T00:00:00Z',
          },
        ],
        cursor: 'cursor-abc',
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const count = await client.pull();
      expect(count).toBe(1);

      const inbox = client.getInbox();
      const pending = inbox.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].opId).toBe('remote-1');

      expect(client.getState('pull_cursor')).toBe('cursor-abc');
    });

    it('sends cursor from state in pull request', async () => {
      client.setState('pull_cursor', 'existing-cursor');

      const mockResponse: ServerPullResponse = {
        ops: [],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await client.pull();

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain('cursor=existing-cursor');
    });

    it('returns 0 when server returns empty ops', async () => {
      const mockResponse: ServerPullResponse = { ops: [] };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const count = await client.pull();
      expect(count).toBe(0);
    });

    it('throws on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Server Error', { status: 500, statusText: 'Internal Server Error' }),
      );

      await expect(client.pull()).rejects.toThrow('Pull failed: 500 Internal Server Error');
    });
  });
});
