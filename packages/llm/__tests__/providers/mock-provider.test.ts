import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { MockProvider } from '../../src/providers/mock-provider.js';

describe('MockProvider', () => {
  let provider: MockProvider;

  beforeEach(() => {
    provider = new MockProvider(['first', 'second', 'third']);
  });

  describe('complete()', () => {
    it('returns responses in order', async () => {
      expect(await provider.complete('prompt1')).toBe('first');
      expect(await provider.complete('prompt2')).toBe('second');
      expect(await provider.complete('prompt3')).toBe('third');
    });

    it('repeats last response when exhausted', async () => {
      await provider.complete('1');
      await provider.complete('2');
      await provider.complete('3');
      expect(await provider.complete('4')).toBe('third');
      expect(await provider.complete('5')).toBe('third');
    });

    it('returns default response when created with no args', async () => {
      const defaultProvider = new MockProvider();
      expect(await defaultProvider.complete('test')).toBe('mock response');
    });
  });

  describe('completeJSON()', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    it('parses JSON response with zod schema using setJSONResponse', async () => {
      provider.setJSONResponse({ name: 'Alice', age: 30 });
      const result = await provider.completeJSON('get user', schema);
      expect(result).toEqual({ name: 'Alice', age: 30 });
    });

    it('parses string response as JSON when no jsonResponse set', async () => {
      const jsonProvider = new MockProvider(['{"name":"Bob","age":25}']);
      const result = await jsonProvider.completeJSON('get user', schema);
      expect(result).toEqual({ name: 'Bob', age: 25 });
    });

    it('throws on invalid JSON schema', async () => {
      provider.setJSONResponse({ name: 'Alice', age: 'not-a-number' });
      await expect(
        provider.completeJSON('get user', schema),
      ).rejects.toThrow();
    });
  });

  describe('calls tracking', () => {
    it('records all calls', async () => {
      await provider.complete('prompt1', { temperature: 0.5 });
      await provider.complete('prompt2');

      expect(provider.calls).toHaveLength(2);
      expect(provider.calls[0]).toEqual({
        prompt: 'prompt1',
        options: { temperature: 0.5 },
      });
      expect(provider.calls[1]).toEqual({
        prompt: 'prompt2',
        options: undefined,
      });
    });

    it('records completeJSON calls', async () => {
      const schema = z.object({ value: z.string() });
      provider.setJSONResponse({ value: 'test' });
      await provider.completeJSON('get value', schema, { maxTokens: 100 });

      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0]).toEqual({
        prompt: 'get value',
        options: { maxTokens: 100 },
      });
    });
  });

  describe('reset()', () => {
    it('clears calls and resets response index', async () => {
      await provider.complete('prompt1');
      await provider.complete('prompt2');
      expect(provider.calls).toHaveLength(2);

      provider.reset();
      expect(provider.calls).toHaveLength(0);

      // After reset, should start from first response again
      expect(await provider.complete('prompt3')).toBe('first');
    });
  });
});
