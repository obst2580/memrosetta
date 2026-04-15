import { Hono } from 'hono';
import { estimateTokens } from '@memrosetta/core';
import type { AppContext } from '../app.js';
import { workingMemoryQuerySchema } from '../validation/schemas.js';

export function workingMemoryRoutes(ctx: AppContext): Hono {
  const router = new Hono();

  router.get('/working-memory', async (c) => {
    const query = workingMemoryQuerySchema.parse(c.req.query());
    const memories = await ctx.engine.workingMemory(query.userId, query.maxTokens);
    const totalTokens = memories.reduce((sum, memory) => sum + estimateTokens(memory.content), 0);

    return c.json({
      success: true as const,
      data: {
        memories,
        totalTokens,
        memoryCount: memories.length,
      },
    });
  });

  return router;
}
