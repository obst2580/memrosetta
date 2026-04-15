import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SyncClient } from '../src/sync-client.js';
import type { SyncClientConfig } from '../src/sync-client.js';
import type { SyncPushResponse, SyncPullResponse } from '../src/types.js';

const TEST_CONFIG: SyncClientConfig = {
  serverUrl: 'https://api.example.com',
  apiKey: 'test-api-key',
  deviceId: 'device-test',
  userId: 'test-user',
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

    it('getStatus returns config and empty sync state by default', () => {
      expect(client.getStatus()).toEqual({
        enabled: true,
        serverUrl: 'https://api.example.com',
        userId: 'test-user',
        deviceId: 'device-test',
        pendingOps: 0,
        lastPush: {
          attemptAt: null,
          successAt: null,
        },
        lastPull: {
          attemptAt: null,
          successAt: null,
        },
        cursor: 0,
      });
    });
  });

  describe('push', () => {
    it('returns empty result when no pending ops', async () => {
      const result = await client.push();
      expect(result).toEqual({ pushed: 0, results: [], highWatermark: 0 });
      expect(client.getState('last_push_attempt_at')).toBeTruthy();
      expect(client.getState('last_push_success_at')).toBeTruthy();
    });

    it('sends pending ops to server and marks them pushed', async () => {
      const outbox = client.getOutbox();
      outbox.addOp({
        opId: 'op-1',
        opType: 'memory_created',
        deviceId: TEST_CONFIG.deviceId,
        userId: 'user-test',
        payload: { content: 'hello' },
        createdAt: '2025-01-01T00:00:00Z',
      });

      const mockResponse: SyncPushResponse = {
        success: true,
        data: {
          results: [
            { opId: 'op-1', status: 'accepted', cursor: 121 },
          ],
          highWatermark: 121,
        },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await client.push();
      expect(result.pushed).toBe(1);
      expect(result.results).toEqual([
        { opId: 'op-1', status: 'accepted', cursor: 121 },
      ]);
      expect(result.highWatermark).toBe(121);

      const pending = outbox.getPending();
      expect(pending).toHaveLength(0);
      expect(client.getState('last_cursor')).toBe('121');
      expect(client.getState('pull_cursor')).toBe('121');
      expect(client.getState('last_push_attempt_at')).toBeTruthy();
      expect(client.getState('last_push_success_at')).toBeTruthy();

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toBe('https://api.example.com/sync/push');
      const requestInit = fetchCall[1] as RequestInit;
      expect(requestInit.headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer test-api-key',
        }),
      );

      // Verify request body matches canonical protocol
      const body = JSON.parse(requestInit.body as string);
      expect(body.deviceId).toBe('device-test');
      expect(body.baseCursor).toBe(0);
      expect(body.ops).toHaveLength(1);
      expect(body.ops[0].opType).toBe('memory_created');
      expect(body.ops[0].payload).toEqual({ content: 'hello' });
      // No userId at top level
      expect(body.userId).toBeUndefined();
    });

    it('throws on non-ok response', async () => {
      const outbox = client.getOutbox();
      outbox.addOp({
        opId: 'op-1',
        opType: 'memory_created',
        deviceId: TEST_CONFIG.deviceId,
        userId: 'user-test',
        payload: {},
        createdAt: '2025-01-01T00:00:00Z',
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
      );

      await expect(client.push()).rejects.toThrow('Push failed: 401 Unauthorized');
      expect(client.getState('last_push_attempt_at')).toBeTruthy();
      expect(client.getState('last_push_success_at')).toBeNull();
    });
  });

  describe('pull', () => {
    it('fetches ops from server and stores in inbox', async () => {
      const mockResponse: SyncPullResponse = {
        success: true,
        data: {
          ops: [
            {
              cursor: 121,
              opId: 'remote-1',
              opType: 'memory_created',
              deviceId: 'other-device',
              userId: 'user-test',
              payload: { content: 'from server' },
              createdAt: '2025-01-01T00:00:00Z',
              receivedAt: '2025-01-01T00:00:01Z',
            },
          ],
          nextCursor: 121,
          hasMore: false,
        },
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

      expect(client.getState('last_cursor')).toBe('121');
      expect(client.getState('pull_cursor')).toBe('121');
      expect(client.getState('last_pull_attempt_at')).toBeTruthy();
      expect(client.getState('last_pull_success_at')).toBeTruthy();
    });

    it('sends since param in pull request', async () => {
      client.setState('last_cursor', '100');

      const mockResponse: SyncPullResponse = {
        success: true,
        data: {
          ops: [],
          nextCursor: 100,
          hasMore: false,
        },
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
      expect(url).toContain('since=100');
      expect(url).toContain('userId=test-user');
      // No bare cursor param (old protocol)
      expect(url).not.toContain('cursor=');
    });

    it('returns 0 when server returns empty ops', async () => {
      const mockResponse: SyncPullResponse = {
        success: true,
        data: {
          ops: [],
          nextCursor: 0,
          hasMore: false,
        },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const count = await client.pull();
      expect(count).toBe(0);
      expect(client.getState('last_pull_attempt_at')).toBeTruthy();
      expect(client.getState('last_pull_success_at')).toBeTruthy();
    });

    it('throws on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Server Error', { status: 500, statusText: 'Internal Server Error' }),
      );

      await expect(client.pull()).rejects.toThrow('Pull failed: 500 Internal Server Error');
      expect(client.getState('last_pull_attempt_at')).toBeTruthy();
      expect(client.getState('last_pull_success_at')).toBeNull();
    });

    it('getStatus reports pending ops and timestamps after sync activity', async () => {
      const outbox = client.getOutbox();
      outbox.addOp({
        opId: 'op-1',
        opType: 'memory_created',
        deviceId: TEST_CONFIG.deviceId,
        userId: 'user-test',
        payload: { content: 'hello' },
        createdAt: '2025-01-01T00:00:00Z',
      });

      const pushResponse: SyncPushResponse = {
        success: true,
        data: {
          results: [{ opId: 'op-1', status: 'accepted', cursor: 10 }],
          highWatermark: 10,
        },
      };

      const pullResponse: SyncPullResponse = {
        success: true,
        data: {
          ops: [],
          nextCursor: 10,
          hasMore: false,
        },
      };

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify(pushResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(pullResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      await client.push();
      await client.pull();

      expect(client.getStatus()).toEqual({
        enabled: true,
        serverUrl: 'https://api.example.com',
        userId: 'test-user',
        deviceId: 'device-test',
        pendingOps: 0,
        lastPush: {
          attemptAt: expect.any(String),
          successAt: expect.any(String),
        },
        lastPull: {
          attemptAt: expect.any(String),
          successAt: expect.any(String),
        },
        cursor: 10,
      });
    });
  });
});
