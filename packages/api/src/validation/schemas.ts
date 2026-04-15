import { z } from 'zod';

export const memoryTypeSchema = z.enum(['fact', 'preference', 'decision', 'event']);
export const memoryStateSchema = z.enum(['current', 'superseded', 'invalidated']);
const isoDateSchema = z.string().max(50);
const userIdSchema = z.string().min(1).max(256);

export const storeMemorySchema = z.object({
  userId: userIdSchema,
  content: z.string().min(1).max(10_000),
  memoryType: memoryTypeSchema,
  namespace: z.string().max(256).optional(),
  keywords: z.array(z.string().max(100)).max(50).optional(),
  confidence: z.number().min(0).max(1).optional(),
  salience: z.number().min(0).max(1).optional(),
  documentDate: isoDateSchema.optional(),
  sourceId: z.string().max(256).optional(),
  rawText: z.string().max(50_000).optional(),
  eventDateStart: isoDateSchema.optional(),
  eventDateEnd: isoDateSchema.optional(),
  invalidatedAt: isoDateSchema.optional(),
});

export const storeBatchSchema = z.object({
  memories: z.array(storeMemorySchema).min(1).max(1000),
});

export const searchSchema = z.object({
  userId: userIdSchema,
  query: z.string().min(1).max(1_000),
  namespace: z.string().max(256).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  filters: z.object({
    memoryTypes: z.array(memoryTypeSchema).optional(),
    dateRange: z.object({
      start: isoDateSchema.optional(),
      end: isoDateSchema.optional(),
    }).optional(),
    eventDateRange: z.object({
      start: isoDateSchema.optional(),
      end: isoDateSchema.optional(),
    }).optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    onlyLatest: z.boolean().optional(),
    excludeInvalidated: z.boolean().optional(),
    states: z.array(memoryStateSchema).min(1).optional(),
  }).optional(),
});

export const relateSchema = z.object({
  srcMemoryId: z.string().min(1).max(256),
  dstMemoryId: z.string().min(1).max(256),
  relationType: z.enum(['updates', 'extends', 'derives', 'contradicts', 'supports']),
  reason: z.string().max(2_000).optional(),
});

export const memoryIdParamSchema = z.object({
  memoryId: z.string().min(1).max(256),
});

export const workingMemoryQuerySchema = z.object({
  userId: userIdSchema,
  maxTokens: z.coerce.number().int().min(1).max(20_000).optional(),
});

export const qualityQuerySchema = z.object({
  userId: userIdSchema,
});

export const invalidateMemorySchema = z.object({
  reason: z.string().max(2_000).optional(),
});

export const feedbackSchema = z.object({
  helpful: z.boolean(),
});
