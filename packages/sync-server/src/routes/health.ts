import { Hono } from 'hono';
import type { SyncAppContext } from '../app.js';

const VERSION = process.env.npm_package_version ?? '0.1.0';

export function healthRoutes(ctx: SyncAppContext): Hono {
  const router = new Hono();

  router.get('/health', async (c) => {
    let dbStatus: 'ok' | 'error' = 'ok';
    try {
      // A lightweight check: get watermark for a dummy user
      await ctx.storage.getHighWatermark('__healthcheck__');
    } catch {
      dbStatus = 'error';
    }

    const status = dbStatus === 'ok' ? 'ok' : 'degraded';
    const statusCode = dbStatus === 'ok' ? 200 : 503;

    return c.json({ status, version: VERSION, db: dbStatus }, statusCode);
  });

  return router;
}
