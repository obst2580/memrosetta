import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

describe('OpenAIProvider', () => {
  const originalEnv = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OPENAI_API_KEY = originalEnv;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('reads apiKey from env when not provided', async () => {
    process.env.OPENAI_API_KEY = 'test-key-from-env';
    const { OpenAIProvider } = await import(
      '../../src/providers/openai-provider.js'
    );
    // Constructor should not throw
    const provider = new OpenAIProvider();
    expect(provider).toBeDefined();
  });

  it('uses provided apiKey over env var', async () => {
    process.env.OPENAI_API_KEY = 'env-key';
    const { OpenAIProvider } = await import(
      '../../src/providers/openai-provider.js'
    );
    const provider = new OpenAIProvider({ apiKey: 'explicit-key' });
    expect(provider).toBeDefined();
  });

  it('defaults model to gpt-4o-mini', async () => {
    const { OpenAIProvider } = await import(
      '../../src/providers/openai-provider.js'
    );
    const provider = new OpenAIProvider();
    expect(provider).toBeDefined();
  });

  it('accepts custom model', async () => {
    const { OpenAIProvider } = await import(
      '../../src/providers/openai-provider.js'
    );
    const provider = new OpenAIProvider({ model: 'gpt-4o' });
    expect(provider).toBeDefined();
  });

  describe('with mocked OpenAI client', () => {
    const mockCreate = vi.fn();

    beforeEach(async () => {
      vi.resetModules();
      mockCreate.mockReset();

      vi.doMock('openai', () => ({
        default: class MockOpenAI {
          chat = {
            completions: {
              create: mockCreate,
            },
          };
        },
      }));
    });

    afterEach(() => {
      vi.doUnmock('openai');
    });

    it('complete() returns text from response', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Hello world' } }],
      });

      const { OpenAIProvider } = await import(
        '../../src/providers/openai-provider.js'
      );
      const provider = new OpenAIProvider({ apiKey: 'test-key' });
      const result = await provider.complete('Say hello');

      expect(result).toBe('Hello world');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Say hello' }],
          temperature: 0,
        }),
      );
    });

    it('complete() returns empty string when no content', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
      });

      const { OpenAIProvider } = await import(
        '../../src/providers/openai-provider.js'
      );
      const provider = new OpenAIProvider({ apiKey: 'test-key' });
      const result = await provider.complete('prompt');

      expect(result).toBe('');
    });

    it('complete() applies merged options', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' } }],
      });

      const { OpenAIProvider } = await import(
        '../../src/providers/openai-provider.js'
      );
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        defaultOptions: { temperature: 0.5 },
      });
      await provider.complete('prompt', { maxTokens: 100, model: 'gpt-4o' });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
          temperature: 0.5,
          max_tokens: 100,
        }),
      );
    });

    it('completeJSON() parses valid response', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"name":"Alice","age":30}' } }],
      });

      const schema = z.object({ name: z.string(), age: z.number() });
      const { OpenAIProvider } = await import(
        '../../src/providers/openai-provider.js'
      );
      const provider = new OpenAIProvider({ apiKey: 'test-key' });
      const result = await provider.completeJSON('get user', schema);

      expect(result).toEqual({ name: 'Alice', age: 30 });
    });

    it('completeJSON() retries on schema validation failure', async () => {
      mockCreate
        .mockResolvedValueOnce({
          choices: [{ message: { content: '{"name":"Alice","age":"not-a-number"}' } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: '{"name":"Alice","age":30}' } }],
        });

      const schema = z.object({ name: z.string(), age: z.number() });
      const { OpenAIProvider } = await import(
        '../../src/providers/openai-provider.js'
      );
      const provider = new OpenAIProvider({ apiKey: 'test-key' });
      const result = await provider.completeJSON('get user', schema);

      expect(result).toEqual({ name: 'Alice', age: 30 });
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('completeJSON() uses json_object response format', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"value":"test"}' } }],
      });

      const schema = z.object({ value: z.string() });
      const { OpenAIProvider } = await import(
        '../../src/providers/openai-provider.js'
      );
      const provider = new OpenAIProvider({ apiKey: 'test-key' });
      await provider.completeJSON('test', schema);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: { type: 'json_object' },
        }),
      );
    });
  });
});
