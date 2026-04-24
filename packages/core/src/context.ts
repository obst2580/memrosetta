import type { MemoryInput, SearchCurrentContext, SearchResult } from '@memrosetta/types';

const TOKEN_SPLIT = /[^a-z0-9가-힣_-]+/i;
const MAX_KEYWORD_TOKENS = 12;
const CONTEXT_MAX_BOOST = 0.1;

interface SignatureOptions {
  readonly recentKeywords?: readonly string[];
  readonly timeBucket?: string;
}

function normalizeToken(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9가-힣_-]/gi, '');
}

function normalizeSignatureToken(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9가-힣_:-]/gi, '');
}

function stemToken(token: string): string {
  if (token.length <= 4) return token;
  return token.replace(/(ing|ed|es|s)$/i, '');
}

function keywordTokens(values: readonly string[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    for (const raw of value.split(TOKEN_SPLIT)) {
      const token = stemToken(normalizeToken(raw));
      if (token.length === 0) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_KEYWORD_TOKENS)
    .map(([token]) => token);
}

function dedupeSorted(tokens: readonly string[]): readonly string[] {
  return [...new Set(tokens.filter((token) => token.length > 0))].sort();
}

export function coarseTimeBucket(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export function computeContextSignature(
  input: Pick<MemoryInput, 'namespace' | 'project' | 'episodeId' | 'keywords'>,
  options: SignatureOptions = {},
): string {
  const rawKeywords = [
    ...(input.keywords ?? []),
    ...(options.recentKeywords ?? []),
  ];
  const scopedTokens = [
    input.project ? `project:${normalizeToken(input.project)}` : '',
    input.namespace ? `namespace:${normalizeToken(input.namespace)}` : '',
    input.episodeId ? `episode:${normalizeToken(input.episodeId)}` : '',
    options.timeBucket ? `time:${normalizeToken(options.timeBucket)}` : '',
  ];
  const kwTokens = keywordTokens(rawKeywords).map((token) => `kw:${token}`);
  return dedupeSorted([...scopedTokens, ...kwTokens]).join(' ');
}

export function contextSignatureTokens(signature: string | undefined): readonly string[] {
  if (!signature) return [];
  return dedupeSorted(signature.split(/\s+/).map(normalizeSignatureToken));
}

export function computeCurrentContextSignature(context: SearchCurrentContext): string {
  return computeContextSignature(
    {
      namespace: context.namespace,
      project: context.project,
      episodeId: context.episodeId,
      keywords: context.keywords,
    },
    { timeBucket: context.timeBucket },
  );
}

export function applyContextSignatureBoost(
  results: readonly SearchResult[],
  currentContext?: SearchCurrentContext,
): readonly SearchResult[] {
  if (!currentContext || results.length === 0) return results;
  const current = contextSignatureTokens(computeCurrentContextSignature(currentContext));
  if (current.length === 0) return results;
  const currentSet = new Set(current);

  return results.map((result) => {
    const stored = contextSignatureTokens(result.memory.contextSignature);
    if (stored.length === 0) return result;
    const storedSet = new Set(stored);
    const intersection = current.filter((token) => storedSet.has(token)).length;
    if (intersection === 0) return result;
    const union = new Set([...currentSet, ...storedSet]).size;
    const boost = (intersection / union) * CONTEXT_MAX_BOOST;
    return { ...result, score: result.score + boost };
  }).sort((a, b) => b.score - a.score);
}

export function recentKeywordUnion(
  rows: readonly { readonly keywords: string | null }[],
): readonly string[] {
  return rows.flatMap((row) => (row.keywords ?? '').split(/\s+/).filter(Boolean));
}
