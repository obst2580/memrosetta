import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { MemoryInput } from '@memrosetta/types';
import { estimateSalience } from '../src/salience.js';
import { ensureSchema } from '../src/schema.js';
import { createPreparedStatements, storeMemory } from '../src/store.js';
import Database from 'better-sqlite3';

function input(overrides?: Partial<MemoryInput>): MemoryInput {
  return {
    userId: 'user-1',
    memoryType: 'fact',
    content: 'Short fact',
    keywords: [],
    ...overrides,
  };
}

describe('heuristic salience estimation', () => {
  it('boosts decision and critical/error signals strongly', () => {
    const salience = estimateSalience(
      input({
        memoryType: 'decision',
        content: 'Decision: fixed critical SQLite retry error',
        keywords: ['critical', 'fixed'],
      }),
    );

    expect(salience).toBeGreaterThanOrEqual(1.7);
    expect(salience).toBeLessThanOrEqual(2.0);
  });

  it('boosts preference signals moderately across Korean and English cues', () => {
    const korean = estimateSalience(
      input({ memoryType: 'fact', content: '사용자는 SQLite-first를 선호한다' }),
    );
    const english = estimateSalience(
      input({ memoryType: 'preference', content: 'Prefer small files' }),
    );

    expect(korean).toBeGreaterThan(1.0);
    expect(korean).toBeLessThan(1.7);
    expect(english).toBeGreaterThan(1.0);
    expect(english).toBeLessThan(1.7);
  });

  it('keeps short fact/event memories at baseline', () => {
    expect(estimateSalience(input({ memoryType: 'fact', content: 'SQLite is used' }))).toBe(1.0);
    expect(estimateSalience(input({ memoryType: 'event', content: 'Tests passed' }))).toBe(1.0);
  });

  it('penalizes long log-like text instead of overvaluing length', () => {
    const longLog = Array.from({ length: 140 }, (_, i) => `line ${i}: debug output`).join('\n');

    expect(estimateSalience(input({ content: longLog }))).toBeLessThan(1.0);
    expect(estimateSalience(input({ content: longLog }))).toBeGreaterThanOrEqual(0.5);
  });

  it('preserves caller-provided salience on store', () => {
    const db = new Database(':memory:');
    try {
      ensureSchema(db);
      const stmts = createPreparedStatements(db);

      const memory = storeMemory(
        db,
        stmts,
        input({
          memoryType: 'decision',
          content: 'Decision: critical retry behavior is fixed',
          salience: 0.6,
        }),
      );

      expect(memory.salience).toBe(0.6);
    } finally {
      db.close();
    }
  });

  it('runs in under 100us per call on the store path', () => {
    const sample = input({
      memoryType: 'decision',
      content: 'Decision: fixed critical retry handling for persistent queue',
      keywords: ['sqlite', 'critical', 'retry'],
    });
    const iterations = 10_000;

    const started = performance.now();
    for (let i = 0; i < iterations; i += 1) {
      estimateSalience(sample);
    }
    const elapsedUs = ((performance.now() - started) * 1000) / iterations;

    expect(elapsedUs).toBeLessThan(100);
  });
});
