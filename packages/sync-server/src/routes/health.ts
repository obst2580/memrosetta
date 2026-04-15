import { Hono } from 'hono';
import type { SyncAppContext } from '../app.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

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

    return c.json({ status, version: pkg.version, db: dbStatus }, statusCode);
  });

  return router;
}
