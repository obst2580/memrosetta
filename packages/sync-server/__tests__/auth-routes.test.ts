import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { ISyncStorage, StoredDeviceAuthRequest } from '../src/storage.js';

const { mockStartProviderDeviceFlow, mockPollProviderDeviceFlow } = vi.hoisted(() => ({
  mockStartProviderDeviceFlow: vi.fn(),
  mockPollProviderDeviceFlow: vi.fn(),
}));

vi.mock('../src/auth/providers.js', () => ({
  startProviderDeviceFlow: (...args: unknown[]) => mockStartProviderDeviceFlow(...args),
  pollProviderDeviceFlow: (...args: unknown[]) => mockPollProviderDeviceFlow(...args),
}));

function makeStorage(overrides: Partial<ISyncStorage> = {}): ISyncStorage {
  return {
    initialize: vi.fn(),
    close: vi.fn(),
    pushOps: vi.fn(async () => []),
    pullOps: vi.fn(async () => ({ ops: [], hasMore: false })),
    getHighWatermark: vi.fn(async () => 0),
    createDeviceAuthRequest: vi.fn(async (input) => ({
      id: '2f4cbcf3-9da9-4f6b-9f8d-2b37f9fd9d6b',
      status: 'pending',
      createdAt: new Date().toISOString(),
      completedAt: null,
      ...input,
    })),
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

describe('auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMROSETTA_API_KEYS;
  });

  it('starts device flow and persists request metadata', async () => {
    mockStartProviderDeviceFlow.mockResolvedValue({
      provider: 'github',
      deviceId: 'device-1',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      intervalSeconds: 5,
      expiresAt: '2026-04-16T00:00:00.000Z',
      providerDeviceCode: 'gh-device-code',
    });
    const storage = makeStorage();
    const app = createApp(storage);

    const res = await app.request('http://localhost/auth/device/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'github', deviceId: 'device-1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.deviceRequestId).toBe('2f4cbcf3-9da9-4f6b-9f8d-2b37f9fd9d6b');
    expect(storage.createDeviceAuthRequest).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github', deviceId: 'device-1' }),
    );
  });

  it('polls device flow and mints MemRosetta session tokens', async () => {
    const request: StoredDeviceAuthRequest = {
      id: '2f4cbcf3-9da9-4f6b-9f8d-2b37f9fd9d6b',
      provider: 'github',
      deviceId: 'device-1',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      intervalSeconds: 5,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      providerDeviceCode: 'gh-device-code',
      status: 'pending',
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    mockPollProviderDeviceFlow.mockResolvedValue({
      status: 'approved',
      user: {
        userId: '',
        provider: 'github',
        providerSubject: '12345',
        email: 'obst@example.com',
        displayName: 'obst',
      },
    });
    const storage = makeStorage({
      getDeviceAuthRequest: vi.fn(async () => request),
    });
    const app = createApp(storage);

    const res = await app.request('http://localhost/auth/device/poll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceRequestId: request.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('approved');
    expect(body.data.accessToken).toMatch(/^mrs_at_/);
    expect(body.data.refreshToken).toMatch(/^mrs_rt_/);
    expect(storage.upsertAuthenticatedUser).toHaveBeenCalled();
    expect(storage.createSession).toHaveBeenCalled();
    expect(storage.markDeviceAuthRequestCompleted).toHaveBeenCalledWith(request.id);
  });

  it('refreshes opaque session tokens', async () => {
    const storage = makeStorage({
      refreshSession: vi.fn(async () => ({ userId: 'user-1', deviceId: 'device-1' })),
    });
    const app = createApp(storage);

    const res = await app.request('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'mrs_rt_refresh-token' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toMatch(/^mrs_at_/);
    expect(body.data.refreshToken).toMatch(/^mrs_rt_/);
    expect(storage.refreshSession).toHaveBeenCalled();
  });
});
