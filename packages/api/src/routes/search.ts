import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { searchSchema } from '../validation/schemas.js';

export function searchRoutes(ctx: AppContext): Hono {
  const router = new Hono();

  // POST /search - Search memories
  router.post('/search', async (c) => {
    const body = await c.req.json();
    const query = searchSchema.parse(body);
    const response = await ctx.engine.search(query);
    return c.json({
      success: true as const,
      data: {
        results: response.results,
        totalCount: response.totalCount,
        queryTimeMs: response.queryTimeMs,
      },
    });
  });

  return router;
}
