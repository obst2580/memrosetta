import { describe, it, expect } from 'vitest';
import {
  exactMatch,
  f1Score,
  computeQAMetrics,
} from '../../src/metrics/qa-metrics.js';
import type { QAResult } from '../../src/metrics/qa-metrics.js';

describe('exactMatch', () => {
  it('returns true for identical strings', () => {
    expect(exactMatch('hello', 'hello')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(exactMatch('Hello', 'hello')).toBe(true);
    expect(exactMatch('HELLO', 'hello')).toBe(true);
  });

  it('trims whitespace', () => {
    expect(exactMatch('  hello  ', 'hello')).toBe(true);
    expect(exactMatch('hello', '  hello  ')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(exactMatch('hello', 'world')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(exactMatch('', '')).toBe(true);
    expect(exactMatch('hello', '')).toBe(false);
  });
});

describe('f1Score', () => {
  it('returns 1.0 for identical strings', () => {
    expect(f1Score('the cat sat', 'the cat sat')).toBe(1.0);
  });

  it('returns 0.0 for completely different strings', () => {
    expect(f1Score('hello world', 'foo bar')).toBe(0.0);
  });

  it('calculates correct F1 for partial overlap', () => {
    // predicted tokens: {the, cat}
    // expected tokens: {the, dog}
    // common: {the} -> 1
    // precision = 1/2 = 0.5, recall = 1/2 = 0.5
    // F1 = 2 * 0.5 * 0.5 / (0.5 + 0.5) = 0.5
    expect(f1Score('the cat', 'the dog')).toBeCloseTo(0.5);
  });

  it('handles case-insensitive comparison', () => {
    expect(f1Score('The Cat', 'the cat')).toBe(1.0);
  });

  it('returns 0.0 when predicted is empty', () => {
    expect(f1Score('', 'hello')).toBe(0.0);
  });

  it('returns 0.0 when expected is empty', () => {
    expect(f1Score('hello', '')).toBe(0.0);
  });

  it('returns 0.0 when both are empty', () => {
    expect(f1Score('', '')).toBe(0.0);
  });

  it('handles duplicate tokens correctly', () => {
    // predicted: {a, b, a} -> bag: {a:2, b:1}
    // expected: {a, c} -> bag: {a:1, c:1}
    // common (min counts): a:1 = 1
    // precision = 1/3, recall = 1/2
    // F1 = 2 * (1/3) * (1/2) / (1/3 + 1/2) = 2 * 1/6 / 5/6 = 2/5 = 0.4
    expect(f1Score('a b a', 'a c')).toBeCloseTo(0.4);
  });
});

describe('computeQAMetrics', () => {
  it('computes overall accuracy', () => {
    const results: readonly QAResult[] = [
      { predicted: 'Paris', expected: 'Paris', category: 'geography' },
      { predicted: 'London', expected: 'Berlin', category: 'geography' },
      { predicted: '42', expected: '42', category: 'math' },
    ];
    const metrics = computeQAMetrics(results);

    expect(metrics.totalQuestions).toBe(3);
    expect(metrics.correctAnswers).toBe(2);
    expect(metrics.accuracy).toBeCloseTo(2 / 3);
  });

  it('computes per-category metrics', () => {
    const results: readonly QAResult[] = [
      { predicted: 'Paris', expected: 'Paris', category: 'geography' },
      { predicted: 'London', expected: 'Berlin', category: 'geography' },
      { predicted: '42', expected: '42', category: 'math' },
      { predicted: '7', expected: '7', category: 'math' },
    ];
    const metrics = computeQAMetrics(results);

    expect(metrics.byCategory['geography'].total).toBe(2);
    expect(metrics.byCategory['geography'].correct).toBe(1);
    expect(metrics.byCategory['geography'].accuracy).toBe(0.5);

    expect(metrics.byCategory['math'].total).toBe(2);
    expect(metrics.byCategory['math'].correct).toBe(2);
    expect(metrics.byCategory['math'].accuracy).toBe(1.0);
  });

  it('returns zero metrics for empty results', () => {
    const metrics = computeQAMetrics([]);

    expect(metrics.totalQuestions).toBe(0);
    expect(metrics.correctAnswers).toBe(0);
    expect(metrics.accuracy).toBe(0);
  });

  it('uses case-insensitive, trimmed exact match for correctness', () => {
    const results: readonly QAResult[] = [
      { predicted: '  PARIS  ', expected: 'paris', category: 'geo' },
    ];
    const metrics = computeQAMetrics(results);

    expect(metrics.correctAnswers).toBe(1);
    expect(metrics.accuracy).toBe(1.0);
  });
});
