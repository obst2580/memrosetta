import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NLIContradictionDetector } from '../src/contradiction-detector.js';

describe('NLIContradictionDetector', () => {
  let detector: NLIContradictionDetector;

  beforeAll(async () => {
    detector = new NLIContradictionDetector();
    await detector.initialize();
  }, 120_000);

  afterAll(async () => {
    await detector.close();
  });

  // -----------------------------------------------------------------------
  // Contradiction detection
  // -----------------------------------------------------------------------

  it('detects contradiction for explicit negation of concrete actions', async () => {
    const result = await detector.detect(
      'The cat is on the mat',
      'The cat is not on the mat',
    );
    expect(result.label).toBe('contradiction');
    expect(result.score).toBeGreaterThan(0.8);
  });

  it('detects contradiction for universally quantified opposing statements', async () => {
    const result = await detector.detect(
      'All birds can fly',
      'No birds can fly',
    );
    expect(result.label).toBe('contradiction');
    expect(result.score).toBeGreaterThan(0.9);
  });

  it('detects contradiction for negated activity descriptions', async () => {
    const result = await detector.detect(
      'A person is riding a horse',
      'A person is not riding a horse',
    );
    expect(result.label).toBe('contradiction');
    expect(result.score).toBeGreaterThan(0.9);
  });

  // -----------------------------------------------------------------------
  // Neutral detection
  // -----------------------------------------------------------------------

  it('detects neutral for completely unrelated statements', async () => {
    const result = await detector.detect(
      'The weather is sunny today',
      'I like pizza for dinner',
    );
    expect(result.label).toBe('neutral');
    expect(result.score).toBeGreaterThan(0.9);
  });

  // -----------------------------------------------------------------------
  // Entailment detection
  // -----------------------------------------------------------------------

  it('detects entailment for semantically related statements', async () => {
    const result = await detector.detect(
      'Dogs are animals',
      'Dogs are living creatures',
    );
    expect(result.label).toBe('entailment');
    expect(result.score).toBeGreaterThan(0.4);
  });

  // -----------------------------------------------------------------------
  // Score validity
  // -----------------------------------------------------------------------

  it('score is between 0 and 1', async () => {
    const result = await detector.detect(
      'The cat is on the mat',
      'The cat is not on the mat',
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Batch detection
  // -----------------------------------------------------------------------

  it('handles batch detection', async () => {
    const results = await detector.detectBatch([
      {
        textA: 'A man is eating food',
        textB: 'A man is not eating food',
      },
      {
        textA: 'The weather is sunny today',
        textB: 'I like pizza for dinner',
      },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].label).toBe('contradiction');
    expect(results[1].label).toBe('neutral');
  });

  it('handles empty batch', async () => {
    const results = await detector.detectBatch([]);
    expect(results).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  it('throws if not initialized', async () => {
    const fresh = new NLIContradictionDetector();
    await expect(fresh.detect('a', 'b')).rejects.toThrow('not initialized');
  });

  it('double initialize is safe', async () => {
    await detector.initialize();
    // Should not throw or create a second pipeline
    const result = await detector.detect(
      'The cat is on the mat',
      'The cat is not on the mat',
    );
    expect(result.label).toBe('contradiction');
  });

  it('close and reinitialize works', async () => {
    const temp = new NLIContradictionDetector();
    await temp.initialize();
    await temp.close();

    // After close, detect should throw
    await expect(temp.detect('a', 'b')).rejects.toThrow('not initialized');

    // Reinitialize should work
    await temp.initialize();
    const result = await temp.detect(
      'A person is riding a horse',
      'A person is not riding a horse',
    );
    expect(result.label).toBe('contradiction');
    await temp.close();
  }, 120_000);
});
