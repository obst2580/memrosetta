import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { SearchResult } from '@memrosetta/types';
import {
  applyContextSignatureBoost,
  computeContextSignature,
  contextSignatureTokens,
} from '../src/context.js';
import type { MemoryInput } from '@memrosetta/types';

function input(overrides?: Partial<MemoryInput>): MemoryInput {
  return {
    userId: 'user-1',
    memoryType: 'fact',
    content: 'Auth uses SQLite',
    project: 'memrosetta',
    namespace: 'layer-b',
    episodeId: 'ep-1',
    keywords: ['auth', 'sqlite', 'auth'],
    ...overrides,
  };
}

function result(memoryId: string, signature: string | undefined, score: number): SearchResult {
  return {
    memory: {
      memoryId,
      userId: 'user-1',
      memoryType: 'fact',
      content: 'shared retrieval target',
      learnedAt: '2026-04-24T00:00:00.000Z',
      isLatest: true,
      confidence: 1,
      salience: 1,
      tier: 'warm',
      activationScore: 1,
      accessCount: 0,
      useCount: 0,
      successCount: 0,
      keywords: ['shared'],
      ...(signature ? { contextSignature: signature } : {}),
    },
    score,
    matchType: 'fts',
  };
}

describe('context signature', () => {
  it('is deterministic for identical inputs', () => {
    const first = computeContextSignature(input(), {
      recentKeywords: ['retry', 'sqlite', 'auth'],
      timeBucket: 'afternoon',
    });
    const second = computeContextSignature(input(), {
      recentKeywords: ['retry', 'sqlite', 'auth'],
      timeBucket: 'afternoon',
    });

    expect(first).toBe(second);
    expect(contextSignatureTokens(first)).toContain('project:memrosetta');
  });

  it('boosts rankings by token Jaccard only when currentContext is supplied', () => {
    const current = {
      project: 'memrosetta',
      namespace: 'layer-b',
      episodeId: 'ep-1',
      keywords: ['auth', 'sqlite'],
    };
    const matching = computeContextSignature(input(), { timeBucket: 'afternoon' });
    const other = computeContextSignature(
      input({
        project: 'other',
        namespace: 'general',
        episodeId: 'ep-2',
        keywords: ['frontend'],
      }),
      { timeBucket: 'afternoon' },
    );

    const unchanged = applyContextSignatureBoost([result('a', matching, 1), result('b', other, 1)]);
    const boosted = applyContextSignatureBoost(
      [result('a', matching, 1), result('b', other, 1.05)],
      current,
    );

    expect(unchanged[0].memory.memoryId).toBe('a');
    expect(boosted[0].memory.memoryId).toBe('a');
    expect(boosted[0].score).toBeGreaterThan(1.05);
  });

  it('no-op boost path stays under 100us per call', () => {
    const results = Array.from({ length: 10 }, (_, index) =>
      result(`mem-${index}`, undefined, 1),
    );
    const iterations = 10_000;

    const started = performance.now();
    for (let i = 0; i < iterations; i += 1) {
      applyContextSignatureBoost(results);
    }
    const elapsedUs = ((performance.now() - started) * 1000) / iterations;

    expect(elapsedUs).toBeLessThan(100);
  });
});
