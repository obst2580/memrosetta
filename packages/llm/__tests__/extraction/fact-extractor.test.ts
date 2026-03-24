import { describe, it, expect, beforeEach } from 'vitest';
import { MockProvider } from '../../src/providers/mock-provider.js';
import { FactExtractor } from '../../src/extraction/fact-extractor.js';
import type { ExtractedFact } from '../../src/extraction/fact-extractor-types.js';

describe('FactExtractor', () => {
  let provider: MockProvider;
  let extractor: FactExtractor;

  const sampleFacts: readonly ExtractedFact[] = [
    {
      content: 'John bought a red car',
      memoryType: 'event',
      confidence: 0.95,
      keywords: ['car', 'red', 'John'],
      subjectEntity: 'John',
    },
    {
      content: 'The car cost $35,000',
      memoryType: 'fact',
      confidence: 0.9,
      keywords: ['car', 'cost', 'price'],
    },
  ];

  beforeEach(() => {
    provider = new MockProvider();
    provider.setJSONResponse({ facts: sampleFacts });
    extractor = new FactExtractor(provider);
  });

  describe('extractFromTurns()', () => {
    it('should extract facts from conversation turns', async () => {
      const turns = [
        { speaker: 'John', text: 'I just bought a red car yesterday!' },
        { speaker: 'Alice', text: 'How much did it cost?' },
        { speaker: 'John', text: 'About $35,000.' },
      ];

      const facts = await extractor.extractFromTurns(turns);

      expect(facts).toHaveLength(2);
      expect(facts[0].content).toBe('John bought a red car');
      expect(facts[0].memoryType).toBe('event');
      expect(facts[0].confidence).toBe(0.95);
      expect(facts[1].content).toBe('The car cost $35,000');
    });

    it('should pass context to the prompt', async () => {
      const turns = [{ speaker: 'Alice', text: 'Hello!' }];
      const context = {
        dateTime: '2024-01-15',
        sessionNumber: 3,
        speakerA: 'Alice',
        speakerB: 'Bob',
      };

      await extractor.extractFromTurns(turns, context);

      expect(provider.calls).toHaveLength(1);
      const prompt = provider.calls[0].prompt;
      expect(prompt).toContain('2024-01-15');
      expect(prompt).toContain('Alice');
      expect(prompt).toContain('Session: 3');
    });

    it('should use default options when none provided', async () => {
      const turns = [{ speaker: 'Test', text: 'Hello' }];

      await extractor.extractFromTurns(turns);

      expect(provider.calls[0].options).toEqual({
        temperature: 0,
        maxTokens: 4096,
        model: undefined,
      });
    });

    it('should use custom options when provided', async () => {
      const customExtractor = new FactExtractor(provider, {
        temperature: 0.5,
        maxTokens: 2048,
        model: 'gpt-4',
      });

      await customExtractor.extractFromTurns([{ speaker: 'A', text: 'Hi' }]);

      expect(provider.calls[0].options).toEqual({
        temperature: 0.5,
        maxTokens: 2048,
        model: 'gpt-4',
      });
    });

    it('should filter out empty content facts', async () => {
      provider.setJSONResponse({
        facts: [
          { content: 'Valid fact', memoryType: 'fact', confidence: 0.9 },
          { content: '   ', memoryType: 'fact', confidence: 0.5 },
        ],
      });

      const facts = await extractor.extractFromTurns([
        { speaker: 'A', text: 'test' },
      ]);

      expect(facts).toHaveLength(1);
      expect(facts[0].content).toBe('Valid fact');
    });

    it('should handle empty turns', async () => {
      provider.setJSONResponse({ facts: [] });

      const facts = await extractor.extractFromTurns([]);

      expect(facts).toHaveLength(0);
    });
  });

  describe('extractFromText()', () => {
    it('should extract facts from plain text', async () => {
      const facts = await extractor.extractFromText(
        'John bought a red car for $35,000.',
      );

      expect(facts).toHaveLength(2);
      expect(provider.calls).toHaveLength(1);
      // Should create a single turn with speaker "unknown"
      expect(provider.calls[0].prompt).toContain('unknown:');
    });
  });

  describe('error handling', () => {
    it('should return empty array when provider throws', async () => {
      const errorProvider = new MockProvider();
      // Don't set a JSON response, and the default text "mock response"
      // is not valid JSON for the schema, so it will throw.
      const errorExtractor = new FactExtractor(errorProvider);

      const facts = await errorExtractor.extractFromTurns([
        { speaker: 'A', text: 'Hello' },
      ]);

      expect(facts).toEqual([]);
    });
  });

  describe('toMemoryInputs()', () => {
    it('should convert facts to MemoryInput format', () => {
      const inputs = extractor.toMemoryInputs(sampleFacts, {
        namespace: 'test-ns',
        documentDate: '2024-01-15',
        sourceId: 'src-1',
      });

      expect(inputs).toHaveLength(2);

      expect(inputs[0].userId).toBe('John'); // from subjectEntity
      expect(inputs[0].memoryType).toBe('event');
      expect(inputs[0].content).toBe('John bought a red car');
      expect(inputs[0].confidence).toBe(0.95);
      expect(inputs[0].keywords).toEqual(['car', 'red', 'John']);
      expect(inputs[0].namespace).toBe('test-ns');
      expect(inputs[0].documentDate).toBe('2024-01-15');
      expect(inputs[0].sourceId).toBe('src-1');

      // Second fact has no subjectEntity - falls back to baseInput.userId
      expect(inputs[1].userId).toBe('unknown'); // no subjectEntity, no baseInput.userId
    });

    it('should use baseInput userId when subjectEntity is missing', () => {
      const factsNoSubject: readonly ExtractedFact[] = [
        { content: 'A fact', memoryType: 'fact', confidence: 0.8 },
      ];

      const inputs = extractor.toMemoryInputs(factsNoSubject, {
        userId: 'default-user',
      });

      expect(inputs[0].userId).toBe('default-user');
    });

    it('should handle empty facts array', () => {
      const inputs = extractor.toMemoryInputs([], { userId: 'u1' });
      expect(inputs).toHaveLength(0);
    });

    it('should omit optional fields when not in baseInput', () => {
      const factsSimple: readonly ExtractedFact[] = [
        { content: 'Simple fact', memoryType: 'fact', confidence: 0.7 },
      ];

      const inputs = extractor.toMemoryInputs(factsSimple, {});

      expect(inputs[0].userId).toBe('unknown');
      expect(inputs[0].namespace).toBeUndefined();
      expect(inputs[0].documentDate).toBeUndefined();
      expect(inputs[0].sourceId).toBeUndefined();
    });
  });
});
