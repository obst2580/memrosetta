import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const {
  getConfigMock,
  writeConfigMock,
  ensureSyncSchemaMock,
  mockGetStatus,
  mockPush,
  mockPull,
  syncClientCtorArgs,
} = vi.hoisted(() => {
  let config = {
    dbPath: '/tmp/test.db',
    syncEnabled: false,
  } as Record<string, unknown>;

  const getConfigMock = vi.fn(() => config);
  const writeConfigMock = vi.fn((next) => {
    config = next;
  });
  const ensureSyncSchemaMock = vi.fn();
  const mockGetStatus = vi.fn();
  const mockPush = vi.fn();
  const mockPull = vi.fn();
  const syncClientCtorArgs: unknown[] = [];
  return {
    getConfigMock,
    writeConfigMock,
    ensureSyncSchemaMock,
    mockGetStatus,
    mockPush,
    mockPull,
    syncClientCtorArgs,
  };
});

vi.mock('../../src/hooks/config.js', () => ({
  getConfig: getConfigMock,
  writeConfig: writeConfigMock,
  getDefaultDbPath: vi.fn().mockReturnValue('/tmp/test.db'),
}));

vi.mock('better-sqlite3', () => ({
  default: class FakeDb {
    close(): void {}
  },
}));

vi.mock('@memrosetta/sync-client', () => ({
  ensureSyncSchema: ensureSyncSchemaMock,
  SyncClient: class FakeSyncClient {
    constructor(_db: unknown, config: unknown) {
      syncClientCtorArgs.push(config);
    }
    getStatus(): Promise<unknown> {
      return mockGetStatus();
    }
    push(): Promise<unknown> {
      return mockPush();
    }
    pull(): Promise<unknown> {
      return mockPull();
    }
  },
}));

describe('sync command', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('sync login stores OAuth tokens and account metadata', async () => {
    vi.useFakeTimers();
    const { run } = await import('../../src/commands/sync.js');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: {
          deviceRequestId: '2f4cbcf3-9da9-4f6b-9f8d-2b37f9fd9d6b',
          provider: 'github',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://github.com/login/device',
          intervalSeconds: 1,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        data: {
          status: 'approved',
          provider: 'github',
          accountEmail: 'obst@example.com',
          displayName: 'obst',
          accessToken: 'mrs_at_test-access',
          refreshToken: 'mrs_rt_test-refresh',
          tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
        },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const runPromise = run({
      args: ['login', '--server', 'https://sync.example.com', '--provider', 'github'],
      format: 'json',
      noEmbeddings: false,
    });
    await vi.advanceTimersByTimeAsync(1000);
    await runPromise;

    expect(writeConfigMock).toHaveBeenCalled();
    const saved = writeConfigMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(saved.syncAuthMode).toBe('oauth');
    expect(saved.syncAccessToken).toBe('mrs_at_test-access');
    expect(saved.syncRefreshToken).toBe('mrs_rt_test-refresh');
    expect(saved.syncProvider).toBe('github');
    expect(saved.syncAccountEmail).toBe('obst@example.com');
  });

  it('sync now refreshes expiring OAuth access tokens before push/pull', async () => {
    writeConfigMock({
      dbPath: '/tmp/test.db',
      syncEnabled: true,
      syncServerUrl: 'https://sync.example.com',
      syncDeviceId: 'device-1',
      syncUserId: 'obst',
      syncAuthMode: 'oauth',
      syncAccessToken: 'mrs_at_old',
      syncRefreshToken: 'mrs_rt_old',
      syncTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    mockPush.mockResolvedValue({ pushed: 2, results: [], highWatermark: 10 });
    mockPull.mockResolvedValue(3);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        accessToken: 'mrs_at_new',
        refreshToken: 'mrs_rt_new',
        tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { run } = await import('../../src/commands/sync.js');
    await run({ args: ['now'], format: 'json', noEmbeddings: false });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sync.example.com/auth/refresh',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(syncClientCtorArgs.at(-1)).toEqual(expect.objectContaining({ apiKey: 'mrs_at_new' }));
  });

  it('sync logout clears OAuth tokens', async () => {
    writeConfigMock({
      dbPath: '/tmp/test.db',
      syncEnabled: true,
      syncServerUrl: 'https://sync.example.com',
      syncDeviceId: 'device-1',
      syncUserId: 'obst',
      syncAuthMode: 'oauth',
      syncAccessToken: 'mrs_at_old',
      syncRefreshToken: 'mrs_rt_old',
      syncProvider: 'github',
      syncAccountEmail: 'obst@example.com',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { revoked: true },
    }), { status: 200 })));

    const { run } = await import('../../src/commands/sync.js');
    await run({ args: ['logout'], format: 'json', noEmbeddings: false });

    const saved = writeConfigMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(saved.syncAccessToken).toBeUndefined();
    expect(saved.syncRefreshToken).toBeUndefined();
    expect(saved.syncProvider).toBeUndefined();
  });
});
