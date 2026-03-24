import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { relateSchema } from '../validation/schemas.js';

export function relationsRoutes(ctx: AppContext): Hono {
  const router = new Hono();

  // POST /relations - Create a relation between memories
  router.post('/relations', async (c) => {
    const body = await c.req.json();
    const input = relateSchema.parse(body);
    const relation = await ctx.engine.relate(
      input.srcMemoryId,
      input.dstMemoryId,
      input.relationType,
      input.reason,
    );
    return c.json({ success: true as const, data: relation });
  });

  return router;
}
