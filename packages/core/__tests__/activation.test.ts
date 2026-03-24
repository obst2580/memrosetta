import { describe, it, expect } from 'vitest';
import { computeActivation } from '../src/activation.js';

describe('computeActivation', () => {
  const now = new Date('2026-03-24T12:00:00Z');

  it('returns value in [0, 1] range', () => {
    const timestamps = ['2026-03-24T10:00:00Z'];
    const score = computeActivation(timestamps, 0.5, now);

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('recent access produces high activation', () => {
    // Accessed 1 hour ago
    const recentTimestamps = ['2026-03-24T11:00:00Z'];
    const recentScore = computeActivation(recentTimestamps, 0.5, now);

    // Accessed 60 days ago
    const oldTimestamps = ['2026-01-23T12:00:00Z'];
    const oldScore = computeActivation(oldTimestamps, 0.5, now);

    expect(recentScore).toBeGreaterThan(oldScore);
  });

  it('old access produces lower activation', () => {
    // Accessed 90 days ago
    const timestamps = ['2025-12-24T12:00:00Z'];
    const score = computeActivation(timestamps, 0.5, now);

    // Should be lower than 0.8 due to time decay
    expect(score).toBeLessThan(0.8);
  });

  it('multiple accesses produce higher activation than single access', () => {
    const singleAccess = ['2026-03-20T12:00:00Z'];
    const multipleAccesses = [
      '2026-03-20T12:00:00Z',
      '2026-03-21T12:00:00Z',
      '2026-03-22T12:00:00Z',
      '2026-03-23T12:00:00Z',
    ];

    const singleScore = computeActivation(singleAccess, 0.5, now);
    const multiScore = computeActivation(multipleAccesses, 0.5, now);

    expect(multiScore).toBeGreaterThan(singleScore);
  });

  it('no accesses returns very low activation', () => {
    const score = computeActivation([], 0.5, now);

    // Should be low but not zero (sigmoid never outputs 0)
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.6);
  });

  it('no accesses with low salience returns lower value', () => {
    const lowSalience = computeActivation([], 0.1, now);
    const highSalience = computeActivation([], 0.9, now);

    expect(highSalience).toBeGreaterThan(lowSalience);
  });

  it('high salience boosts activation', () => {
    const timestamps = ['2026-03-24T10:00:00Z'];

    const lowSalience = computeActivation(timestamps, 0.1, now);
    const highSalience = computeActivation(timestamps, 0.9, now);

    expect(highSalience).toBeGreaterThan(lowSalience);
  });

  it('sigmoid normalization always returns between 0 and 1', () => {
    // Test with extreme values
    const manyAccesses = Array.from({ length: 100 }, (_, i) => {
      const d = new Date(now);
      d.setHours(d.getHours() - i);
      return d.toISOString();
    });

    const score = computeActivation(manyAccesses, 1.0, now);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('future timestamps are skipped', () => {
    // All timestamps are in the future relative to now
    const futureTimestamps = ['2026-04-01T12:00:00Z'];
    const score = computeActivation(futureTimestamps, 0.5, now);

    // Should be low since there are no valid past accesses
    // The function falls through to beta * 0.1
    expect(score).toBeLessThan(0.6);
  });

  it('defaults to current time when now is not provided', () => {
    const recentTimestamp = [new Date().toISOString()];
    const score = computeActivation(recentTimestamp, 0.5);

    // Should return a valid score
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
