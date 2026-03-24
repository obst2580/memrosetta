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
}

export interface Memory extends MemoryInput {
  readonly memoryId: string;
  readonly learnedAt: string;
  readonly isLatest: boolean;
  readonly embedding?: readonly number[];
}
