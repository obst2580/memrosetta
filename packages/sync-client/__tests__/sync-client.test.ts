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
        userId: 'test-user',
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
        userId: 'test-user',
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

    it('chunks pending ops across multiple HTTP requests (max 400 per batch)', async () => {
      const outbox = client.getOutbox();
      const total = 850; // 3 batches: 400 + 400 + 50
      for (let i = 0; i < total; i++) {
        outbox.addOp({
          opId: `op-${i}`,
          opType: 'memory_created',
          deviceId: TEST_CONFIG.deviceId,
          userId: 'test-user',
          payload: { content: `hello-${i}` },
          createdAt: `2025-01-01T00:00:${String(i).padStart(2, '0')}Z`,
        });
      }

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (_url, init) => {
          const body = JSON.parse((init as RequestInit).body as string);
          const ops = body.ops as Array<{ opId: string }>;
          const baseCursor = body.baseCursor as number;
          const results = ops.map((op, idx) => ({
            opId: op.opId,
            status: 'accepted' as const,
            cursor: baseCursor + idx + 1,
          }));
          const response: SyncPushResponse = {
            success: true,
            data: {
              results,
              highWatermark: baseCursor + ops.length,
            },
          };
          return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        });

      const result = await client.push();

      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(result.pushed).toBe(total);
      expect(result.results).toHaveLength(total);
      expect(result.highWatermark).toBe(total);
      expect(outbox.getPending()).toHaveLength(0);
      expect(client.getState('last_push_success_at')).toBeTruthy();

      // Each batch size should respect the 400 cap.
      const batchSizes = fetchSpy.mock.calls.map((call) => {
        const body = JSON.parse((call[1] as RequestInit).body as string);
        return body.ops.length;
      });
      expect(batchSizes).toEqual([400, 400, 50]);
    });

    it('preserves progress when a later chunk fails', async () => {
      const outbox = client.getOutbox();
      const total = 600; // 2 batches: 400 accepted + 200 fails
      for (let i = 0; i < total; i++) {
        outbox.addOp({
          opId: `op-${i}`,
          opType: 'memory_created',
          deviceId: TEST_CONFIG.deviceId,
          userId: 'test-user',
          payload: { content: `hello-${i}` },
          createdAt: `2025-01-01T00:00:${String(i).padStart(2, '0')}Z`,
        });
      }

      let call = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        call += 1;
        if (call === 1) {
          const body = JSON.parse((init as RequestInit).body as string);
          const ops = body.ops as Array<{ opId: string }>;
          const results = ops.map((op, idx) => ({
            opId: op.opId,
            status: 'accepted' as const,
            cursor: idx + 1,
          }));
          const response: SyncPushResponse = {
            success: true,
            data: { results, highWatermark: ops.length },
          };
          return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Bad Request', {
          status: 400,
          statusText: 'Bad Request',
        });
      });

      await expect(client.push()).rejects.toThrow('Push failed: 400 Bad Request');

      // First 400 ops were accepted and marked pushed.
      expect(outbox.getPending()).toHaveLength(200);
      expect(client.getState('last_cursor')).toBe('400');
      // last_push_success_at stays unset because the run did not complete.
      expect(client.getState('last_push_success_at')).toBeNull();
    });
  });

  describe('pull', () => {
    it('fetches ops from server and applies them to local memories', async () => {
      // The sync-client test file opens a fresh :memory: SQLite, so we
      // mirror the minimal memories schema the applier writes into.
      const db = (client as unknown as { db: Database.Database }).db;
      db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
          memory_id       TEXT PRIMARY KEY,
          user_id         TEXT NOT NULL,
          namespace       TEXT,
          memory_type     TEXT NOT NULL,
          content         TEXT NOT NULL,
          raw_text        TEXT,
          document_date   TEXT,
          learned_at      TEXT NOT NULL,
          source_id       TEXT,
          confidence      REAL DEFAULT 1.0,
          salience        REAL DEFAULT 1.0,
          is_latest       INTEGER NOT NULL DEFAULT 1,
          keywords        TEXT,
          event_date_start TEXT,
          event_date_end   TEXT,
          invalidated_at   TEXT,
          tier             TEXT DEFAULT 'warm',
          activation_score REAL DEFAULT 1.0,
          access_count     INTEGER DEFAULT 0,
          use_count        INTEGER DEFAULT 0,
          success_count    INTEGER DEFAULT 0
        );
      `);

      const mockResponse: SyncPullResponse = {
        success: true,
        data: {
          ops: [
            {
              cursor: 121,
              opId: 'remote-1',
              opType: 'memory_created',
              deviceId: 'other-device',
              userId: 'test-user',
              payload: {
                memoryId: 'mem-remote-1',
                userId: 'test-user',
                memoryType: 'fact',
                content: 'from server',
                confidence: 1.0,
                salience: 1.0,
                learnedAt: '2025-01-01T00:00:00.000Z',
              },
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

      // After pull the op lands in the inbox, is applied to memories,
      // and is then marked applied — no leftovers.
      const inbox = client.getInbox();
      const pending = inbox.getPending();
      expect(pending).toHaveLength(0);

      const row = db
        .prepare('SELECT memory_id, content FROM memories WHERE memory_id = ?')
        .get('mem-remote-1') as { memory_id: string; content: string } | undefined;
      expect(row?.content).toBe('from server');

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

    it('recomputes salience when applying feedback_given', async () => {
      const db = (client as unknown as { db: Database.Database }).db;
      db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
          memory_id       TEXT PRIMARY KEY,
          user_id         TEXT NOT NULL,
          namespace       TEXT,
          memory_type     TEXT NOT NULL,
          content         TEXT NOT NULL,
          raw_text        TEXT,
          document_date   TEXT,
          learned_at      TEXT NOT NULL,
          source_id       TEXT,
          confidence      REAL DEFAULT 1.0,
          salience        REAL DEFAULT 0.2,
          is_latest       INTEGER NOT NULL DEFAULT 1,
          keywords        TEXT,
          event_date_start TEXT,
          event_date_end   TEXT,
          invalidated_at   TEXT,
          tier             TEXT DEFAULT 'warm',
          activation_score REAL DEFAULT 1.0,
          access_count     INTEGER DEFAULT 0,
          use_count        INTEGER DEFAULT 0,
          success_count    INTEGER DEFAULT 0
        );
      `);
      db.prepare(`
        INSERT INTO memories (
          memory_id, user_id, memory_type, content, learned_at, salience, is_latest
        ) VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run('mem-1', 'test-user', 'fact', 'hello', '2025-01-01T00:00:00.000Z', 0.2);

      const mockResponse: SyncPullResponse = {
        success: true,
        data: {
          ops: [
            {
              cursor: 1,
              opId: 'remote-feedback-1',
              opType: 'feedback_given',
              deviceId: 'other-device',
              userId: 'test-user',
              payload: {
                memoryId: 'mem-1',
                helpful: true,
                recordedAt: '2025-01-01T00:00:01.000Z',
              },
              createdAt: '2025-01-01T00:00:01.000Z',
              receivedAt: '2025-01-01T00:00:02.000Z',
            },
          ],
          nextCursor: 1,
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

      const row = db.prepare(
        'SELECT use_count, success_count, salience FROM memories WHERE memory_id = ?',
      ).get('mem-1') as { use_count: number; success_count: number; salience: number };

      expect(row).toEqual({
        use_count: 1,
        success_count: 1,
        salience: 1,
      });
    });

    it('does not record pull success when some ops were skipped', async () => {
      const mockResponse: SyncPullResponse = {
        success: true,
        data: {
          ops: [
            {
              cursor: 9,
              opId: 'remote-unknown-1',
              opType: 'unknown_type' as never,
              deviceId: 'other-device',
              userId: 'test-user',
              payload: {},
              createdAt: '2025-01-01T00:00:00Z',
              receivedAt: '2025-01-01T00:00:01Z',
            },
          ],
          nextCursor: 9,
          hasMore: false,
        },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      const count = await client.pull();

      expect(count).toBe(1);
      expect(client.getState('last_cursor')).toBe('9');
      expect(client.getState('last_pull_attempt_at')).toBeTruthy();
      expect(client.getState('last_pull_success_at')).toBeNull();
      expect(client.getInbox().getPending()).toHaveLength(1);
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('[sync] apply skipped op remote-unknown-1'),
      );
    });

    it('throws on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Server Error', { status: 500, statusText: 'Internal Server Error' }),
      );

      await expect(client.pull()).rejects.toThrow('Pull failed: 500 Internal Server Error');
      expect(client.getState('last_pull_attempt_at')).toBeTruthy();
      expect(client.getState('last_pull_success_at')).toBeNull();
    });

    it('loops through multiple pages when hasMore is true', async () => {
      const db = (client as unknown as { db: Database.Database }).db;
      db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
          memory_id       TEXT PRIMARY KEY,
          user_id         TEXT NOT NULL,
          namespace       TEXT,
          memory_type     TEXT NOT NULL,
          content         TEXT NOT NULL,
          raw_text        TEXT,
          document_date   TEXT,
          learned_at      TEXT NOT NULL,
          source_id       TEXT,
          confidence      REAL DEFAULT 1.0,
          salience        REAL DEFAULT 1.0,
          is_latest       INTEGER NOT NULL DEFAULT 1,
          keywords        TEXT,
          event_date_start TEXT,
          event_date_end   TEXT,
          invalidated_at   TEXT,
          tier             TEXT DEFAULT 'warm',
          activation_score REAL DEFAULT 1.0,
          access_count     INTEGER DEFAULT 0,
          use_count        INTEGER DEFAULT 0,
          success_count    INTEGER DEFAULT 0
        );
      `);

      let callNum = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callNum += 1;
        if (callNum === 1) {
          const resp: SyncPullResponse = {
            success: true,
            data: {
              ops: [{
                cursor: 1, opId: 'r-1', opType: 'memory_created', deviceId: 'other',
                userId: 'test-user', createdAt: '2025-01-01T00:00:00Z',
                receivedAt: '2025-01-01T00:00:01Z',
                payload: { memoryId: 'mem-p1', userId: 'test-user', memoryType: 'fact',
                  content: 'page one', confidence: 1, salience: 1, learnedAt: '2025-01-01T00:00:00Z' },
              }],
              nextCursor: 1,
              hasMore: true,
            },
          };
          return new Response(JSON.stringify(resp), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        // Page 2: no more
        const resp: SyncPullResponse = {
          success: true,
          data: {
            ops: [{
              cursor: 2, opId: 'r-2', opType: 'memory_created', deviceId: 'other',
              userId: 'test-user', createdAt: '2025-01-02T00:00:00Z',
              receivedAt: '2025-01-02T00:00:01Z',
              payload: { memoryId: 'mem-p2', userId: 'test-user', memoryType: 'fact',
                content: 'page two', confidence: 1, salience: 1, learnedAt: '2025-01-02T00:00:00Z' },
            }],
            nextCursor: 2,
            hasMore: false,
          },
        };
        return new Response(JSON.stringify(resp), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });

      const count = await client.pull();
      expect(count).toBe(2);
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
      // Both pages applied.
      const rows = db.prepare('SELECT memory_id FROM memories ORDER BY memory_id').all() as { memory_id: string }[];
      expect(rows.map(r => r.memory_id)).toEqual(['mem-p1', 'mem-p2']);
      // Cursor advanced to the last page.
      expect(client.getState('last_cursor')).toBe('2');
      // Second call includes limit parameter.
      const url2 = vi.mocked(fetch).mock.calls[1][0] as string;
      expect(url2).toContain('limit=1000');
    });

    it('getStatus reports pending ops and timestamps after sync activity', async () => {
      const outbox = client.getOutbox();
      outbox.addOp({
        opId: 'op-1',
        opType: 'memory_created',
        deviceId: TEST_CONFIG.deviceId,
        userId: 'test-user',
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
