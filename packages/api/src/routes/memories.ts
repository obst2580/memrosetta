import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { storeMemorySchema, storeBatchSchema } from '../validation/schemas.js';

export function memoriesRoutes(ctx: AppContext): Hono {
  const router = new Hono();

  // POST /memories - Store a single memory
  router.post('/memories', async (c) => {
    const body = await c.req.json();
    const input = storeMemorySchema.parse(body);
    const memory = await ctx.engine.store(input);
    return c.json({ success: true as const, data: memory });
  });

  // POST /memories/batch - Store multiple memories
  router.post('/memories/batch', async (c) => {
    const body = await c.req.json();
    const parsed = storeBatchSchema.parse(body);
    const memories = await ctx.engine.storeBatch(parsed.memories);
    return c.json({
      success: true as const,
      data: memories,
      count: memories.length,
    });
  });

  // GET /memories/count/:userId - Count memories for a user
  router.get('/memories/count/:userId', async (c) => {
    const userId = c.req.param('userId');
    const count = await ctx.engine.count(userId);
    return c.json({ success: true as const, data: { count } });
  });

  // DELETE /memories/user/:userId - Clear all memories for a user
  router.delete('/memories/user/:userId', async (c) => {
    const userId = c.req.param('userId');
    await ctx.engine.clear(userId);
    return c.json({ success: true as const, data: { cleared: true } });
  });

  // GET /memories/:memoryId - Get memory by ID
  router.get('/memories/:memoryId', async (c) => {
    const memoryId = c.req.param('memoryId');
    const memory = await ctx.engine.getById(memoryId);
    if (!memory) {
      return c.json(
        { success: false as const, error: 'Not found' },
        404,
      );
    }
    return c.json({ success: true as const, data: memory });
  });

  return router;
}
