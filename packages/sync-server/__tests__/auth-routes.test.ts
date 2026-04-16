import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { ISyncStorage } from '../src/storage.js';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

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

async function createJwtFixture(): Promise<{ token: string; jwks: { keys: JWK[] } }> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'test-kid';
  const token = await new SignJWT({
    user_id: 123,
    roles: ['user'],
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setIssuer('auth.liliplanet.net')
    .setSubject('obst@example.com')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);

  return { token, jwks: { keys: [publicJwk] } };
}

describe('auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMROSETTA_API_KEYS;
    process.env.JWKS_URI = 'https://auth.liliplanet.net/.well-known/jwks.json';
    process.env.JWT_ISSUER = 'auth.liliplanet.net';
  });

  it('returns JWT identity from /auth/me', async () => {
    const fixture = await createJwtFixture();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === process.env.JWKS_URI) {
        return new Response(JSON.stringify(fixture.jwks), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    }));
    const storage = makeStorage();
    const app = createApp(storage);

    const res = await app.request('http://localhost/auth/me', {
      headers: { authorization: `Bearer ${fixture.token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.ownerUserId).toBe('123');
    expect(body.data.email).toBe('obst@example.com');
    expect(body.data.roles).toEqual(['user']);
    expect(storage.upsertAuthenticatedUser).toHaveBeenCalledWith({
      ownerUserId: '123',
      email: 'obst@example.com',
      roles: ['user'],
    });
  });
});
