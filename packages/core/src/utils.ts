import { nanoid } from 'nanoid';

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
