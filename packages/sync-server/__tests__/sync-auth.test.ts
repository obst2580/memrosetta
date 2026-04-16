import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { ISyncStorage } from '../src/storage.js';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';

function makeStorage(overrides: Partial<ISyncStorage> = {}): ISyncStorage {
  return {
    initialize: vi.fn(),
    close: vi.fn(),
    pushOps: vi.fn(async () => []),
    pullOps: vi.fn(async () => ({ ops: [], hasMore: false })),
    getHighWatermark: vi.fn(async () => 0),
    upsertAuthenticatedUser: vi.fn(async () => {}),
    ...overrides,
  };
}

let signingKey: KeyLike;
let jwks: { keys: JWK[] };

async function signJwt(options?: { expired?: boolean }): Promise<{ token: string; jwks: { keys: JWK[] } }> {
  let jwt = new SignJWT({ user_id: 123, roles: ['user'] })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setIssuer('auth.liliplanet.net')
    .setSubject('obst@example.com')
    .setIssuedAt();
  jwt = options?.expired ? jwt.setExpirationTime('-1h') : jwt.setExpirationTime('1h');
  const token = await jwt.sign(signingKey);
  return { token, jwks };
}

describe('sync auth middleware and owner partitioning', () => {
  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    signingKey = privateKey;
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = 'test-kid';
    jwks = { keys: [publicJwk] };
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWKS_URI = 'https://auth.liliplanet.net/.well-known/jwks.json';
    process.env.JWT_ISSUER = 'auth.liliplanet.net';
    delete process.env.MEMROSETTA_API_KEYS;
  });

  it('uses JWT user_id as owner partition for push', async () => {
    const fixture = await signJwt();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === process.env.JWKS_URI) {
        return new Response(JSON.stringify(fixture.jwks), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    }));
    const storage = makeStorage({
      pushOps: vi.fn(async () => [{ opId: 'op-1', status: 'accepted', cursor: 1 }]),
      getHighWatermark: vi.fn(async () => 1),
    });
    const app = createApp(storage);

    const res = await app.request('http://localhost/sync/push', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${fixture.token}`,
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
    expect(storage.pushOps).toHaveBeenCalledWith('123', expect.any(Array));
  });

  it('uses JWT user_id as owner partition for pull', async () => {
    const fixture = await signJwt();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === process.env.JWKS_URI) {
        return new Response(JSON.stringify(fixture.jwks), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    }));
    const storage = makeStorage({
      pullOps: vi.fn(async () => ({ ops: [], hasMore: false })),
    });
    const app = createApp(storage);

    const res = await app.request('http://localhost/sync/pull?since=0&limit=10&userId=obst', {
      method: 'GET',
      headers: { authorization: `Bearer ${fixture.token}` },
    });

    expect(res.status).toBe(200);
    expect(storage.pullOps).toHaveBeenCalledWith('123', 0, 10);
  });

  it('falls back to legacy API key when configured', async () => {
    process.env.MEMROSETTA_API_KEYS = 'legacy-key';
    const storage = makeStorage({
      pullOps: vi.fn(async () => ({ ops: [], hasMore: false })),
    });
    const app = createApp(storage);

    const res = await app.request('http://localhost/sync/pull?since=0&userId=obst', {
      method: 'GET',
      headers: { authorization: 'Bearer legacy-key' },
    });

    expect(res.status).toBe(200);
    expect(storage.pullOps).toHaveBeenCalledWith('obst', 0, 500);
  });

  it('rejects expired JWT', async () => {
    const fixture = await signJwt({ expired: true });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === process.env.JWKS_URI) {
        return new Response(JSON.stringify(fixture.jwks), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    }));
    const storage = makeStorage();
    const app = createApp(storage);

    const res = await app.request('http://localhost/sync/pull?since=0&userId=obst', {
      method: 'GET',
      headers: { authorization: `Bearer ${fixture.token}` },
    });

    expect(res.status).toBe(401);
  });
});
