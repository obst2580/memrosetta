import { z } from 'zod';

export const memoryTypeSchema = z.enum(['fact', 'preference', 'decision', 'event']);

export const storeMemorySchema = z.object({
  userId: z.string().min(1),
  content: z.string().min(1),
  memoryType: memoryTypeSchema,
  namespace: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  salience: z.number().min(0).max(1).optional(),
  documentDate: z.string().optional(),
  sourceId: z.string().optional(),
  rawText: z.string().optional(),
});

export const storeBatchSchema = z.object({
  memories: z.array(storeMemorySchema).min(1).max(1000),
});

export const searchSchema = z.object({
  userId: z.string().min(1),
  query: z.string().min(1),
  namespace: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  filters: z.object({
    memoryTypes: z.array(memoryTypeSchema).optional(),
    dateRange: z.object({
      start: z.string().optional(),
      end: z.string().optional(),
    }).optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    onlyLatest: z.boolean().optional(),
  }).optional(),
});

export const relateSchema = z.object({
  srcMemoryId: z.string().min(1),
  dstMemoryId: z.string().min(1),
  relationType: z.enum(['updates', 'extends', 'derives', 'contradicts', 'supports']),
  reason: z.string().optional(),
});
