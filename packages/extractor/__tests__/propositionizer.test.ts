import { describe, it, expect } from 'vitest';
import { PropositionizerDecomposer } from '../src/propositionizer.js';

describe('PropositionizerDecomposer', () => {
  // Uses real model — slow, requires download
  const decomposer = new PropositionizerDecomposer();

  it('should decompose English text into atomic facts', async () => {
    const facts = await decomposer.decomposeWithContext(
      'The president signed the bill into law on Monday. The bill aims to reduce carbon emissions by 50% by 2030.',
      'News',
    );

    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every(f => typeof f === 'string')).toBe(true);
    expect(facts.every(f => f.length > 0)).toBe(true);
  });

  it('should decompose Korean text', async () => {
    const facts = await decomposer.decomposeWithContext(
      '김 대리가 시급을 낮추고 마감은 금요일이다.',
      '회의',
    );

    expect(facts.length).toBeGreaterThan(0);
  });

  it('should handle empty input gracefully', async () => {
    const facts = await decomposer.decompose('');
    expect(Array.isArray(facts)).toBe(true);
  });

  it('should accept custom model path', () => {
    const custom = new PropositionizerDecomposer({
      model: 'liliplanet/propositionizer-mt5-small',
      maxLength: 128,
    });
    expect(custom).toBeDefined();
  });
});
