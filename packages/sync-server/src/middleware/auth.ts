import type { MiddlewareHandler } from 'hono';
import { isAccessToken } from '../auth/tokens.js';
import type { ISyncStorage } from '../storage.js';

export type AuthContext =
  | { readonly mode: 'oauth'; readonly ownerUserId: string; readonly deviceId: string }
  | { readonly mode: 'api_key' }
  | { readonly mode: 'dev' };

function parseApiKeys(): ReadonlySet<string> {
  const keysEnv = process.env.MEMROSETTA_API_KEYS ?? '';
  return new Set(keysEnv.split(',').map(k => k.trim()).filter(Boolean));
}

export function authMiddleware(storage: ISyncStorage): MiddlewareHandler {
  const validKeys = parseApiKeys();

  return async (c, next) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      if (validKeys.size === 0) {
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

    if (isAccessToken(bearer)) {
      const session = await storage.getSessionByAccessToken(bearer);
      if (!session) {
        return c.json({ success: false, error: 'Invalid or expired access token' }, 401);
      }
      c.set('auth', {
        mode: 'oauth',
        ownerUserId: session.userId,
        deviceId: session.deviceId,
      } as AuthContext);
      await next();
      return;
    }

    if (validKeys.size === 0 || validKeys.has(bearer)) {
      c.set('auth', { mode: validKeys.size === 0 ? 'dev' : 'api_key' } as AuthContext);
      await next();
      return;
    }

    return c.json({ success: false, error: 'Invalid API key' }, 401);
  };
}
