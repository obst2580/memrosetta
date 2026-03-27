import { nanoid } from 'nanoid';
import type { Memory, MemoryState } from '@memrosetta/types';

export function generateMemoryId(): string {
  return `mem-${nanoid(16)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function keywordsToString(keywords: readonly string[] | undefined): string | null {
  if (!keywords || keywords.length === 0) return null;
  return keywords.join(' ');
}

export function stringToKeywords(str: string | null): readonly string[] {
  if (!str || str.trim() === '') return [];
  return str.split(' ').filter(s => s.length > 0);
}

/**
 * Derive the logical state of a memory from its existing fields.
 * - invalidated: invalidatedAt is set (takes precedence)
 * - superseded: isLatest is false
 * - current: isLatest is true and not invalidated
 */
export function deriveMemoryState(memory: Memory): MemoryState {
  if (memory.invalidatedAt) return 'invalidated';
  if (!memory.isLatest) return 'superseded';
  return 'current';
}
