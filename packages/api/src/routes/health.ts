import { Hono } from 'hono';

export function healthRoutes(): Hono {
  const router = new Hono();

  router.get('/health', (c) => {
    return c.json({ status: 'ok', version: '0.1.0' });
  });

  return router;
}
