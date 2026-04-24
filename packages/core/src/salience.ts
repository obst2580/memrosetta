import type { MemoryInput } from '@memrosetta/types';

const STRONG_PATTERN = /\b(decision|error|blocked|critical|fixed|broke|important)\b|결정|오류|차단|중요|수정|고침/i;
const PREFERENCE_PATTERN = /\b(prefer|preference|preferred|prefers)\b|선호/i;

function clampSalience(value: number): number {
  return Math.max(0.5, Math.min(2.0, Number(value.toFixed(3))));
}

function signalText(input: MemoryInput): string {
  const keywords = input.keywords?.join(' ') ?? '';
  return `${input.content} ${keywords}`;
}

export function estimateSalience(input: MemoryInput): number {
  const text = signalText(input);
  let score = 1.0;

  if (input.memoryType === 'decision') score += 0.45;
  if (STRONG_PATTERN.test(text)) score += 0.35;

  if (input.memoryType === 'preference') score += 0.25;
  if (PREFERENCE_PATTERN.test(text)) score += 0.2;

  if (input.content.length > 1000) score -= 0.3;
  if (input.content.length > 2000) score -= 0.2;

  return clampSalience(score);
}

export function resolveStoreSalience(input: MemoryInput): number {
  return input.salience ?? estimateSalience(input);
}
