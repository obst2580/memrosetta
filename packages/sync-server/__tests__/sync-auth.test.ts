import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { ISyncStorage } from '../src/storage.js';

function makeStorage(overrides: Partial<ISyncStorage> = {}): ISyncStorage {
  return {
    initialize: vi.fn(),
    close: vi.fn(),
    pushOps: vi.fn(async () => []),
    pullOps: vi.fn(async () => ({ ops: [], hasMore: false })),
    getHighWatermark: vi.fn(async () => 0),
    createDeviceAuthRequest: vi.fn(async () => {
      throw new Error('unused');
    }),
    getDeviceAuthRequest: vi.fn(async () => null),
    markDeviceAuthRequestCompleted: vi.fn(async () => {}),
    markDeviceAuthRequestExpired: vi.fn(async () => {}),
    upsertAuthenticatedUser: vi.fn(async () => ({ userId: 'user-1' })),
    createSession: vi.fn(async () => {}),
    refreshSession: vi.fn(async () => null),
    getSessionByAccessToken: vi.fn(async () => null),
    revokeSessionByAccessToken: vi.fn(async () => false),
    ...overrides,
  };
}

describe('sync auth middleware and owner partitioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMROSETTA_API_KEYS;
  });

  it('uses OAuth session ownerUserId for push', async () => {
    const storage = makeStorage({
      getSessionByAccessToken: vi.fn(async () => ({ userId: 'owner-1', deviceId: 'device-1' })),
      pushOps: vi.fn(async () => [{ opId: 'op-1', status: 'accepted', cursor: 1 }]),
      getHighWatermark: vi.fn(async () => 1),
    });
    const app = createApp(storage);

    const res = await app.request('http://localhost/sync/push', {
      method: 'POST',
      headers: {
        authorization: 'Bearer mrs_at_access-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: 'device-1',
        baseCursor: 0,
        userId: 'obst',
        ops: [{
          opId: 'op-1',
          opType: 'memory_created',
          deviceId: 'device-1',
          userId: 'obst',
          createdAt: new Date().toISOString(),
          payload: { memoryId: 'mem-1', content: 'hello' },
        }],
      }),
    });

    expect(res.status).toBe(200);
    expect(storage.pushOps).toHaveBeenCalledWith('owner-1', expect.any(Array));
  });

  it('keeps API key mode compatible by trusting request userId', async () => {
    process.env.MEMROSETTA_API_KEYS = 'legacy-key';
    const storage = makeStorage({
      pushOps: vi.fn(async () => [{ opId: 'op-1', status: 'accepted', cursor: 1 }]),
      getHighWatermark: vi.fn(async () => 1),
    });
    const app = createApp(storage);

    const res = await app.request('http://localhost/sync/push', {
      method: 'POST',
      headers: {
        authorization: 'Bearer legacy-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: 'device-1',
        baseCursor: 0,
        userId: 'obst',
        ops: [{
          opId: 'op-1',
          opType: 'memory_created',
          deviceId: 'device-1',
          userId: 'obst',
          createdAt: new Date().toISOString(),
          payload: { memoryId: 'mem-1', content: 'hello' },
        }],
      }),
    });

    expect(res.status).toBe(200);
    expect(storage.pushOps).toHaveBeenCalledWith('obst', expect.any(Array));
  });

  it('uses OAuth session ownerUserId for pull and ignores query userId', async () => {
    const storage = makeStorage({
      getSessionByAccessToken: vi.fn(async () => ({ userId: 'owner-2', deviceId: 'device-2' })),
      pullOps: vi.fn(async () => ({ ops: [], hasMore: false })),
    });
    const app = createApp(storage);

    const res = await app.request('http://localhost/sync/pull?since=0&limit=10&userId=obst', {
      method: 'GET',
      headers: { authorization: 'Bearer mrs_at_access-token' },
    });

    expect(res.status).toBe(200);
    expect(storage.pullOps).toHaveBeenCalledWith('owner-2', 0, 10);
  });

  it('rejects invalid bearer values', async () => {
    process.env.MEMROSETTA_API_KEYS = 'legacy-key';
    const storage = makeStorage();
    const app = createApp(storage);

    const res = await app.request('http://localhost/sync/pull?since=0&userId=obst', {
      method: 'GET',
      headers: { authorization: 'Bearer wrong-key' },
    });

    expect(res.status).toBe(401);
  });
});
