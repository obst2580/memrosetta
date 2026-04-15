import { Hono } from 'hono';
import { z } from 'zod';
import type { SyncOp } from '@memrosetta/types';
import type { SyncAppContext } from '../app.js';

const VALID_OP_TYPES = [
  'memory_created',
  'relation_created',
  'memory_invalidated',
  'feedback_given',
  'memory_tier_set',
] as const;

const syncOpSchema = z.object({
  opId: z.string().min(1),
  opType: z.enum(VALID_OP_TYPES),
  deviceId: z.string().min(1),
  userId: z.string().min(1),
  createdAt: z.string().min(1),
  payload: z.unknown(),
});

const pushRequestSchema = z.object({
  deviceId: z.string().min(1),
  baseCursor: z.number().int().min(0),
  // TODO: userId should be derived from auth context in production.
  // For now, accept it in the request body for development convenience.
  userId: z.string().min(1).optional(),
  ops: z.array(syncOpSchema).min(1).max(500),
});

export function pushRoutes(ctx: SyncAppContext): Hono {
  const router = new Hono();

  // POST /sync/push
  router.post('/push', async (c) => {
    const body = await c.req.json();
    const parsed = pushRequestSchema.parse(body);

    // Resolve userId: prefer body-level userId, fall back to first op's userId.
    // TODO: In production, derive userId from authenticated identity instead.
    const userId = parsed.userId ?? parsed.ops[0].userId;

    const syncOps = parsed.ops as unknown as readonly SyncOp[];
    const results = await ctx.storage.pushOps(userId, syncOps);
    const highWatermark = await ctx.storage.getHighWatermark(userId);

    return c.json({
      success: true as const,
      data: { results, highWatermark },
    });
  });

  return router;
}
