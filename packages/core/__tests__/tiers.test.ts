import { describe, it, expect } from 'vitest';
import { determineTier, estimateTokens, DEFAULT_TIER_CONFIG } from '../src/tiers.js';

describe('determineTier', () => {
  const now = new Date('2026-03-24T12:00:00Z');

  it('recent memory is warm', () => {
    const tier = determineTier(
      {
        learnedAt: '2026-03-20T12:00:00Z', // 4 days ago
        activationScore: 0.5,
        tier: 'warm',
      },
      undefined,
      now,
    );

    expect(tier).toBe('warm');
  });

  it('old memory (>30 days) becomes cold', () => {
    const tier = determineTier(
      {
        learnedAt: '2026-01-01T12:00:00Z', // ~83 days ago
        activationScore: 0.5,
        tier: 'warm',
      },
      undefined,
      now,
    );

    expect(tier).toBe('cold');
  });

  it('hot tier stays hot (sticky)', () => {
    const tier = determineTier(
      {
        learnedAt: '2025-01-01T12:00:00Z', // very old
        activationScore: 0.1,
        tier: 'hot',
      },
      undefined,
      now,
    );

    expect(tier).toBe('hot');
  });

  it('memory exactly at warmDays boundary is warm', () => {
    const exactBoundary = new Date(now);
    exactBoundary.setDate(exactBoundary.getDate() - 30);

    const tier = determineTier(
      {
        learnedAt: exactBoundary.toISOString(),
        activationScore: 0.5,
        tier: 'warm',
      },
      undefined,
      now,
    );

    expect(tier).toBe('warm');
  });

  it('memory just past warmDays boundary is cold', () => {
    const pastBoundary = new Date(now);
    pastBoundary.setDate(pastBoundary.getDate() - 31);

    const tier = determineTier(
      {
        learnedAt: pastBoundary.toISOString(),
        activationScore: 0.5,
        tier: 'warm',
      },
      undefined,
      now,
    );

    expect(tier).toBe('cold');
  });

  it('respects custom config warmDays', () => {
    const config = { ...DEFAULT_TIER_CONFIG, warmDays: 7 };

    // 10 days ago - should be cold with 7-day warmDays
    const tier = determineTier(
      {
        learnedAt: '2026-03-14T12:00:00Z',
        activationScore: 0.5,
        tier: 'warm',
      },
      config,
      now,
    );

    expect(tier).toBe('cold');
  });

  it('uses current time when now is not provided', () => {
    const recentDate = new Date();
    recentDate.setHours(recentDate.getHours() - 1);

    const tier = determineTier({
      learnedAt: recentDate.toISOString(),
      activationScore: 0.5,
      tier: 'warm',
    });

    expect(tier).toBe('warm');
  });
});

describe('estimateTokens', () => {
  it('estimates tokens from content length', () => {
    const content = 'a'.repeat(100); // 100 chars = ~25 tokens
    expect(estimateTokens(content)).toBe(25);
  });

  it('rounds up for non-divisible lengths', () => {
    const content = 'a'.repeat(101); // 101 chars = ceil(101/4) = 26
    expect(estimateTokens(content)).toBe(26);
  });

  it('empty string returns 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('short content returns at least 1', () => {
    expect(estimateTokens('hi')).toBe(1);
  });
});

describe('DEFAULT_TIER_CONFIG', () => {
  it('has expected default values', () => {
    expect(DEFAULT_TIER_CONFIG.hotMaxTokens).toBe(3000);
    expect(DEFAULT_TIER_CONFIG.warmDays).toBe(30);
    expect(DEFAULT_TIER_CONFIG.coldActivationThreshold).toBe(0.3);
  });
});
