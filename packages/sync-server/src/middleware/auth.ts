import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { ISyncStorage } from '../storage.js';

export type AuthContext =
  | {
      readonly mode: 'jwt';
      readonly ownerUserId: string;
      readonly email: string;
      readonly roles: readonly string[];
    }
  | { readonly mode: 'api_key' }
  | { readonly mode: 'dev' };

const DEFAULT_JWKS_URI = 'https://auth.liliplanet.net/.well-known/jwks.json';
const DEFAULT_JWT_ISSUER = 'auth.liliplanet.net';

function parseApiKeys(): ReadonlySet<string> {
  const keysEnv = process.env.MEMROSETTA_API_KEYS ?? '';
  return new Set(keysEnv.split(',').map((k) => k.trim()).filter(Boolean));
}

function resolveJwtConfig():
  | { readonly jwksUri: string; readonly issuer: string }
  | null {
  const configuredJwks = process.env.JWKS_URI;
  const configuredIssuer = process.env.JWT_ISSUER;
  if (!configuredJwks && !configuredIssuer) {
    return null;
  }
  return {
    jwksUri: configuredJwks ?? DEFAULT_JWKS_URI,
    issuer: configuredIssuer ?? DEFAULT_JWT_ISSUER,
  };
}

let cachedJwks:
  | ReturnType<typeof createRemoteJWKSet>
  | null = null;
let cachedJwksUri: string | null = null;

function getJwks(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  if (cachedJwks && cachedJwksUri === jwksUri) {
    return cachedJwks;
  }
  cachedJwksUri = jwksUri;
  cachedJwks = createRemoteJWKSet(new URL(jwksUri));
  return cachedJwks;
}

export function authMiddleware(storage: ISyncStorage): MiddlewareHandler {
  const validKeys = parseApiKeys();
  const jwtConfig = resolveJwtConfig();

  return async (c, next) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      if (validKeys.size === 0 && !jwtConfig) {
        c.set('auth', { mode: 'dev' } as AuthContext);
        await next();
        return;
      }
      return c.json({ success: false, error: 'Missing Authorization header' }, 401);
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return c.json({ success: false, error: 'Invalid Authorization format. Expected: Bearer <token>' }, 401);
    }

    const bearer = parts[1];

    if (validKeys.has(bearer)) {
      c.set('auth', { mode: 'api_key' } as AuthContext);
      await next();
      return;
    }

    if (!jwtConfig) {
      if (validKeys.size === 0) {
        c.set('auth', { mode: 'dev' } as AuthContext);
        await next();
        return;
      }
      return c.json({ success: false, error: 'Invalid API key' }, 401);
    }

    try {
      const jwks = getJwks(jwtConfig.jwksUri);
      const { payload } = await jwtVerify(bearer, jwks, {
        issuer: jwtConfig.issuer,
        algorithms: ['RS256'],
      });

      const rawUserId = payload.user_id;
      const email = payload.sub;
      const roles = Array.isArray(payload.roles)
        ? payload.roles.filter((value): value is string => typeof value === 'string')
        : [];

      if ((typeof rawUserId !== 'string' && typeof rawUserId !== 'number') || typeof email !== 'string') {
        return c.json({ success: false, error: 'JWT is missing required claims' }, 401);
      }

      const auth = {
        mode: 'jwt',
        ownerUserId: String(rawUserId),
        email,
        roles,
      } as const;

      await storage.upsertAuthenticatedUser({
        ownerUserId: auth.ownerUserId,
        email: auth.email,
        roles: auth.roles,
      });

      c.set('auth', auth as AuthContext);
      await next();
      return;
    } catch {
      if (validKeys.size > 0) {
        return c.json({ success: false, error: 'Invalid JWT or API key' }, 401);
      }
      return c.json({ success: false, error: 'Invalid JWT' }, 401);
    }
  };
}
