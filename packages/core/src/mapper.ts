import type { Memory, MemoryType, MemoryTier } from '@memrosetta/types';
import { stringToKeywords } from './utils.js';

export interface MemoryRow {
  readonly id: number;
  readonly memory_id: string;
  readonly user_id: string;
  readonly namespace: string | null;
  readonly memory_type: string;
  readonly content: string;
  readonly raw_text: string | null;
  readonly document_date: string | null;
  readonly learned_at: string;
  readonly source_id: string | null;
  readonly confidence: number;
  readonly salience: number;
  readonly is_latest: number;
  readonly embedding: Buffer | null;
  readonly keywords: string | null;
  readonly event_date_start: string | null;
  readonly event_date_end: string | null;
  readonly invalidated_at: string | null;
  readonly tier: string | null;
  readonly activation_score: number | null;
  readonly access_count: number | null;
  readonly last_accessed_at: string | null;
  readonly compressed_from: string | null;
}

export function rowToMemory(row: MemoryRow): Memory {
  return {
    memoryId: row.memory_id,
    userId: row.user_id,
    ...(row.namespace != null ? { namespace: row.namespace } : {}),
    memoryType: row.memory_type as MemoryType,
    content: row.content,
    ...(row.raw_text != null ? { rawText: row.raw_text } : {}),
    ...(row.document_date != null ? { documentDate: row.document_date } : {}),
    learnedAt: row.learned_at,
    ...(row.source_id != null ? { sourceId: row.source_id } : {}),
    confidence: row.confidence,
    salience: row.salience,
    isLatest: row.is_latest === 1,
    ...(row.embedding != null ? { embedding: deserializeEmbedding(row.embedding) } : {}),
    keywords: stringToKeywords(row.keywords),
    ...(row.event_date_start != null ? { eventDateStart: row.event_date_start } : {}),
    ...(row.event_date_end != null ? { eventDateEnd: row.event_date_end } : {}),
    ...(row.invalidated_at != null ? { invalidatedAt: row.invalidated_at } : {}),
    tier: (row.tier as MemoryTier) ?? 'warm',
    activationScore: row.activation_score ?? 1.0,
    accessCount: row.access_count ?? 0,
    ...(row.last_accessed_at != null ? { lastAccessedAt: row.last_accessed_at } : {}),
    ...(row.compressed_from != null ? { compressedFrom: row.compressed_from } : {}),
  };
}

function deserializeEmbedding(buf: Buffer): readonly number[] {
  const float32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(float32);
}

export function serializeEmbedding(embedding: readonly number[] | Float32Array): Buffer {
  const float32 = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
}
