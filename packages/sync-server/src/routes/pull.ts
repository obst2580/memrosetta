import { Hono } from 'hono';
import { z } from 'zod';
import type { SyncAppContext } from '../app.js';

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 500;

const pullQuerySchema = z.object({
  since: z.coerce.number().int().min(0),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  userId: z.string().min(1),
});

export function pullRoutes(ctx: SyncAppContext): Hono {
  const router = new Hono();

  // GET /sync/pull?since=<cursor>&limit=<n>&userId=<id>
  router.get('/pull', async (c) => {
    const query = pullQuerySchema.parse({
      since: c.req.query('since'),
      limit: c.req.query('limit'),
      userId: c.req.query('userId'),
    });

    const limit = query.limit ?? DEFAULT_LIMIT;
    const { ops, hasMore } = await ctx.storage.pullOps(query.userId, query.since, limit);

    const nextCursor = ops.length > 0
      ? ops[ops.length - 1].cursor
      : query.since;

    return c.json({
      success: true as const,
      data: { ops, nextCursor, hasMore },
    });
  });

  return router;
}
