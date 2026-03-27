import { describe, it, expect } from 'vitest';
import {
  precisionAtK,
  recallAtK,
  ndcgAtK,
  mrr,
  staleSuppression,
} from '../../src/metrics/retrieval-metrics.js';

describe('precisionAtK', () => {
  it('returns 1.0 when all retrieved items are relevant', () => {
    const retrieved = ['a', 'b', 'c'];
    const relevant = new Set(['a', 'b', 'c']);
    expect(precisionAtK(retrieved, relevant, 3)).toBe(1.0);
  });

  it('returns 0.0 when no retrieved items are relevant', () => {
    const retrieved = ['x', 'y', 'z'];
    const relevant = new Set(['a', 'b', 'c']);
    expect(precisionAtK(retrieved, relevant, 3)).toBe(0.0);
  });

  it('returns correct partial precision', () => {
    const retrieved = ['a', 'x', 'b', 'y'];
    const relevant = new Set(['a', 'b', 'c']);
    // At k=4: 2 relevant out of 4
    expect(precisionAtK(retrieved, relevant, 4)).toBe(0.5);
  });

  it('handles k > retrieved length by using retrieved length', () => {
    const retrieved = ['a', 'b'];
    const relevant = new Set(['a', 'b', 'c']);
    // Only 2 items retrieved, both relevant -> 2/2 = 1.0
    expect(precisionAtK(retrieved, relevant, 10)).toBe(1.0);
  });

  it('returns 0.0 for empty retrieved list', () => {
    const relevant = new Set(['a', 'b']);
    expect(precisionAtK([], relevant, 5)).toBe(0.0);
  });

  it('returns 0.0 for empty relevant set', () => {
    const retrieved = ['a', 'b', 'c'];
    const relevant = new Set<string>();
    expect(precisionAtK(retrieved, relevant, 3)).toBe(0.0);
  });

  it('calculates precision at k=1 correctly', () => {
    const retrieved = ['a', 'x', 'y'];
    const relevant = new Set(['a', 'b']);
    expect(precisionAtK(retrieved, relevant, 1)).toBe(1.0);
  });

  it('calculates precision at k=2 with one relevant', () => {
    const retrieved = ['a', 'x', 'y'];
    const relevant = new Set(['a', 'b']);
    expect(precisionAtK(retrieved, relevant, 2)).toBe(0.5);
  });
});

describe('recallAtK', () => {
  it('returns 1.0 when all relevant items are found', () => {
    const retrieved = ['a', 'b', 'c', 'x'];
    const relevant = new Set(['a', 'b', 'c']);
    expect(recallAtK(retrieved, relevant, 4)).toBe(1.0);
  });

  it('returns 0.0 when no relevant items are found', () => {
    const retrieved = ['x', 'y', 'z'];
    const relevant = new Set(['a', 'b', 'c']);
    expect(recallAtK(retrieved, relevant, 3)).toBe(0.0);
  });

  it('returns correct partial recall', () => {
    const retrieved = ['a', 'x', 'b', 'y'];
    const relevant = new Set(['a', 'b', 'c']);
    // At k=4: found 2 out of 3 relevant
    expect(recallAtK(retrieved, relevant, 4)).toBeCloseTo(2 / 3);
  });

  it('returns 0.0 for empty relevant set (avoids division by zero)', () => {
    const retrieved = ['a', 'b', 'c'];
    const relevant = new Set<string>();
    expect(recallAtK(retrieved, relevant, 3)).toBe(0.0);
  });

  it('returns 0.0 for empty retrieved list', () => {
    const relevant = new Set(['a', 'b']);
    expect(recallAtK([], relevant, 5)).toBe(0.0);
  });

  it('handles k smaller than retrieved length', () => {
    const retrieved = ['a', 'b', 'c', 'd'];
    const relevant = new Set(['a', 'c', 'd']);
    // At k=2: only 'a' is relevant among first 2 -> 1/3
    expect(recallAtK(retrieved, relevant, 2)).toBeCloseTo(1 / 3);
  });
});

describe('ndcgAtK', () => {
  it('returns 1.0 for perfect ranking (all relevant at top)', () => {
    const retrieved = ['a', 'b', 'x', 'y'];
    const relevant = new Set(['a', 'b']);
    expect(ndcgAtK(retrieved, relevant, 4)).toBeCloseTo(1.0);
  });

  it('returns less than 1.0 for suboptimal ranking', () => {
    const retrieved = ['x', 'a', 'y', 'b'];
    const relevant = new Set(['a', 'b']);
    const result = ndcgAtK(retrieved, relevant, 4);
    expect(result).toBeGreaterThan(0.0);
    expect(result).toBeLessThan(1.0);
  });

  it('returns 0.0 when no relevant results exist', () => {
    const retrieved = ['x', 'y', 'z'];
    const relevant = new Set(['a', 'b']);
    expect(ndcgAtK(retrieved, relevant, 3)).toBe(0.0);
  });

  it('returns 0.0 for empty relevant set', () => {
    const retrieved = ['a', 'b', 'c'];
    const relevant = new Set<string>();
    expect(ndcgAtK(retrieved, relevant, 3)).toBe(0.0);
  });

  it('returns 0.0 for empty retrieved list', () => {
    const relevant = new Set(['a', 'b']);
    expect(ndcgAtK([], relevant, 5)).toBe(0.0);
  });

  it('uses binary relevance (1 if in relevant set, 0 otherwise)', () => {
    // Single relevant item at position 0
    // DCG = 1 / log2(1+1) = 1 / 1 = 1.0
    // IDCG = 1.0
    // NDCG = 1.0
    const retrieved = ['a', 'x', 'y'];
    const relevant = new Set(['a']);
    expect(ndcgAtK(retrieved, relevant, 3)).toBeCloseTo(1.0);
  });

  it('calculates correct NDCG for known values', () => {
    // retrieved: [x, a, b], relevant: {a, b}
    // DCG = 0/log2(2) + 1/log2(3) + 1/log2(4) = 0 + 0.6309 + 0.5 = 1.1309
    // IDCG (ideal: [a, b, x]) = 1/log2(2) + 1/log2(3) + 0 = 1.0 + 0.6309 = 1.6309
    // NDCG = 1.1309 / 1.6309 = 0.6934
    const retrieved = ['x', 'a', 'b'];
    const relevant = new Set(['a', 'b']);
    expect(ndcgAtK(retrieved, relevant, 3)).toBeCloseTo(0.6934, 3);
  });

  it('handles k larger than retrieved length', () => {
    const retrieved = ['a'];
    const relevant = new Set(['a', 'b']);
    // DCG = 1/log2(2) = 1.0
    // IDCG = 1/log2(2) = 1.0 (only 1 item available)
    expect(ndcgAtK(retrieved, relevant, 5)).toBeCloseTo(1.0);
  });
});

describe('mrr', () => {
  it('returns 1.0 when first result is always relevant', () => {
    const retrievedPerQuery = [['a', 'b'], ['c', 'd']];
    const relevantPerQuery = [new Set(['a']), new Set(['c'])];
    expect(mrr(retrievedPerQuery, relevantPerQuery)).toBe(1.0);
  });

  it('returns correct MRR for relevant at various positions', () => {
    const retrievedPerQuery = [
      ['x', 'a', 'y'],   // rank 2 -> 1/2
      ['x', 'y', 'b'],   // rank 3 -> 1/3
    ];
    const relevantPerQuery = [new Set(['a']), new Set(['b'])];
    // MRR = (1/2 + 1/3) / 2 = 5/12
    expect(mrr(retrievedPerQuery, relevantPerQuery)).toBeCloseTo(5 / 12);
  });

  it('returns 0.0 when no relevant results in any query', () => {
    const retrievedPerQuery = [['x', 'y'], ['z', 'w']];
    const relevantPerQuery = [new Set(['a']), new Set(['b'])];
    expect(mrr(retrievedPerQuery, relevantPerQuery)).toBe(0.0);
  });

  it('handles mix of queries with and without relevant results', () => {
    const retrievedPerQuery = [
      ['a', 'b'],     // rank 1 -> 1/1
      ['x', 'y', 'z'], // no relevant -> 0
    ];
    const relevantPerQuery = [new Set(['a']), new Set(['w'])];
    // MRR = (1 + 0) / 2 = 0.5
    expect(mrr(retrievedPerQuery, relevantPerQuery)).toBe(0.5);
  });

  it('returns 0.0 for empty queries', () => {
    expect(mrr([], [])).toBe(0.0);
  });

  it('handles single query', () => {
    const retrievedPerQuery = [['x', 'a']];
    const relevantPerQuery = [new Set(['a'])];
    expect(mrr(retrievedPerQuery, relevantPerQuery)).toBe(0.5);
  });
});

describe('staleSuppression', () => {
  it('returns 1.0 for empty results', () => {
    expect(staleSuppression([])).toBe(1.0);
  });

  it('returns 1.0 when all results are fresh', () => {
    const results = [
      { memory: { isLatest: true } },
      { memory: { isLatest: true } },
    ];
    expect(staleSuppression(results)).toBe(1.0);
  });

  it('returns 0.0 when all results are invalidated', () => {
    const results = [
      { memory: { isLatest: true, invalidatedAt: '2025-01-01' } },
      { memory: { isLatest: true, invalidatedAt: '2025-01-02' } },
    ];
    expect(staleSuppression(results)).toBe(0.0);
  });

  it('returns 0.0 when all results are superseded', () => {
    const results = [
      { memory: { isLatest: false } },
      { memory: { isLatest: false } },
    ];
    expect(staleSuppression(results)).toBe(0.0);
  });

  it('returns correct ratio for mixed results', () => {
    const results = [
      { memory: { isLatest: true } },
      { memory: { isLatest: false } },
      { memory: { isLatest: true, invalidatedAt: '2025-01-01' } },
      { memory: { isLatest: true } },
    ];
    // 2 fresh out of 4
    expect(staleSuppression(results)).toBe(0.5);
  });

  it('invalidatedAt takes precedence over isLatest', () => {
    const results = [
      { memory: { isLatest: true, invalidatedAt: '2025-01-01' } },
    ];
    // isLatest is true but invalidatedAt is set -> not fresh
    expect(staleSuppression(results)).toBe(0.0);
  });
});
