import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { URL } from 'node:url';

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

const spawnMock = vi.fn(() => ({ unref: vi.fn() }));

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

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

  it('sync login stores JWT and account metadata from localhost callback', async () => {
    const { run } = await import('../../src/commands/sync.js');
    const runPromise = run({
      args: ['login', '--server', 'https://sync.example.com'],
      format: 'json',
      noEmbeddings: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const openedUrl = spawnMock.mock.calls[0]?.[1]?.[0] as string;
    const loginUrl = new URL(openedUrl);
    const redirect = loginUrl.searchParams.get('redirect');
    expect(redirect).toBeTruthy();
    const fakeJwt = [
      Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({
        sub: 'obst@example.com',
        user_id: 123,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64url'),
      'signature',
    ].join('.');
    const callbackUrl = new URL(redirect!);
    callbackUrl.searchParams.set('token', fakeJwt);
    await fetch(callbackUrl);
    await runPromise;

    expect(writeConfigMock).toHaveBeenCalled();
    const saved = writeConfigMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(saved.syncAuthMode).toBe('jwt');
    expect(saved.syncAccessToken).toBe(fakeJwt);
    expect(saved.syncRefreshToken).toBeUndefined();
    expect(saved.syncAccountEmail).toBe('obst@example.com');
  });

  it('sync now uses stored JWT bearer for push/pull', async () => {
    writeConfigMock({
      dbPath: '/tmp/test.db',
      syncEnabled: true,
      syncServerUrl: 'https://sync.example.com',
      syncDeviceId: 'device-1',
      syncUserId: 'obst',
      syncAuthMode: 'jwt',
      syncAccessToken: 'jwt-token',
      syncTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    mockPush.mockResolvedValue({ pushed: 2, results: [], highWatermark: 10 });
    mockPull.mockResolvedValue(3);

    const { run } = await import('../../src/commands/sync.js');
    await run({ args: ['now'], format: 'json', noEmbeddings: false });

    expect(syncClientCtorArgs.at(-1)).toEqual(expect.objectContaining({ apiKey: 'jwt-token' }));
  });

  it('sync logout clears JWT token', async () => {
    writeConfigMock({
      dbPath: '/tmp/test.db',
      syncEnabled: true,
      syncServerUrl: 'https://sync.example.com',
      syncDeviceId: 'device-1',
      syncUserId: 'obst',
      syncAuthMode: 'jwt',
      syncAccessToken: 'jwt-token',
      syncAccountEmail: 'obst@example.com',
    });

    const { run } = await import('../../src/commands/sync.js');
    await run({ args: ['logout'], format: 'json', noEmbeddings: false });

    const saved = writeConfigMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(saved.syncAccessToken).toBeUndefined();
    expect(saved.syncRefreshToken).toBeUndefined();
    expect(saved.syncAccountEmail).toBeUndefined();
  });
});
