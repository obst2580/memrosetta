import { Hono } from 'hono';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

export function healthRoutes(): Hono {
  const router = new Hono();

  router.get('/health', (c) => {
    return c.json({ status: 'ok', version: pkg.version });
  });

  return router;
}
