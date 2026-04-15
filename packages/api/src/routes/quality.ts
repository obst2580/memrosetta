import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { qualityQuerySchema } from '../validation/schemas.js';

export function qualityRoutes(ctx: AppContext): Hono {
  const router = new Hono();

  router.get('/quality', async (c) => {
    const query = qualityQuerySchema.parse(c.req.query());
    const quality = await ctx.engine.quality(query.userId);

    return c.json({
      success: true as const,
      data: quality,
    });
  });

  return router;
}
