export type MemoryType = 'fact' | 'preference' | 'decision' | 'event';

export type MemoryTier = 'hot' | 'warm' | 'cold';

export interface MemoryInput {
  readonly userId: string;
  readonly namespace?: string;
  readonly memoryType: MemoryType;
  readonly content: string;
  readonly rawText?: string;
  readonly documentDate?: string;
  readonly sourceId?: string;
  readonly confidence?: number;
  readonly salience?: number;
  readonly keywords?: readonly string[];
  /** ISO 8601 - when the event started */
  readonly eventDateStart?: string;
  /** ISO 8601 - when the event ended */
  readonly eventDateEnd?: string;
  /** ISO 8601 - when this fact became invalid */
  readonly invalidatedAt?: string;
}

export interface Memory extends MemoryInput {
  readonly memoryId: string;
  readonly learnedAt: string;
  readonly isLatest: boolean;
  readonly embedding?: readonly number[];
  /** Memory tier: hot (working memory), warm (recent), cold (archived). Engine-managed. */
  readonly tier: MemoryTier;
  /** ACT-R activation score (0-1). Engine-managed. */
  readonly activationScore: number;
  /** Number of times this memory was accessed in search. Engine-managed. */
  readonly accessCount: number;
  /** ISO 8601 - when this memory was last accessed via search. Engine-managed. */
  readonly lastAccessedAt?: string;
  /** memory_id of the original memory, if this is a compressed summary. Engine-managed. */
  readonly compressedFrom?: string;
}
