import { Hono } from 'hono';
import type { SyncAppContext } from '../app.js';
import type { AuthContext } from '../middleware/auth.js';

export function authRoutes(_ctx: SyncAppContext): Hono {
  const router = new Hono();

  router.get('/me', async (c) => {
    const auth = (c as { get(key: string): unknown }).get('auth') as AuthContext | undefined;
    if (!auth || auth.mode !== 'jwt') {
      return c.json({ success: false as const, error: 'JWT authentication required' }, 401);
    }

    return c.json({
      success: true as const,
      data: {
        ownerUserId: auth.ownerUserId,
        email: auth.email,
        roles: auth.roles,
      },
    });
  });

  return router;
}
