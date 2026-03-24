export type MemoryType = 'fact' | 'preference' | 'decision' | 'event';

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
}
