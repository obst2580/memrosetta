import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

describe('AnthropicProvider', () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('reads apiKey from env when not provided', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    const { AnthropicProvider } = await import(
      '../../src/providers/anthropic-provider.js'
    );
    const provider = new AnthropicProvider();
    expect(provider).toBeDefined();
  });

  it('uses provided apiKey over env var', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key';
    const { AnthropicProvider } = await import(
      '../../src/providers/anthropic-provider.js'
    );
    const provider = new AnthropicProvider({ apiKey: 'explicit-key' });
    expect(provider).toBeDefined();
  });

  it('defaults model to claude-haiku-4-5-20251001', async () => {
    const { AnthropicProvider } = await import(
      '../../src/providers/anthropic-provider.js'
    );
    const provider = new AnthropicProvider();
    expect(provider).toBeDefined();
  });

  describe('with mocked Anthropic client', () => {
    const mockCreate = vi.fn();

    beforeEach(async () => {
      vi.resetModules();
      mockCreate.mockReset();

      vi.doMock('@anthropic-ai/sdk', () => ({
        default: class MockAnthropic {
          messages = { create: mockCreate };
        },
      }));
    });

    afterEach(() => {
      vi.doUnmock('@anthropic-ai/sdk');
    });

    it('complete() returns text from response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Hello from Claude' }],
      });

      const { AnthropicProvider } = await import(
        '../../src/providers/anthropic-provider.js'
      );
      const provider = new AnthropicProvider({ apiKey: 'test-key' });
      const result = await provider.complete('Say hello');

      expect(result).toBe('Hello from Claude');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          messages: [{ role: 'user', content: 'Say hello' }],
        }),
      );
    });

    it('complete() returns empty string when no content blocks', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [],
      });

      const { AnthropicProvider } = await import(
        '../../src/providers/anthropic-provider.js'
      );
      const provider = new AnthropicProvider({ apiKey: 'test-key' });
      const result = await provider.complete('prompt');

      expect(result).toBe('');
    });

    it('complete() joins multiple text blocks', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world' },
        ],
      });

      const { AnthropicProvider } = await import(
        '../../src/providers/anthropic-provider.js'
      );
      const provider = new AnthropicProvider({ apiKey: 'test-key' });
      const result = await provider.complete('prompt');

      expect(result).toBe('Hello world');
    });

    it('complete() passes temperature when provided', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ok' }],
      });

      const { AnthropicProvider } = await import(
        '../../src/providers/anthropic-provider.js'
      );
      const provider = new AnthropicProvider({ apiKey: 'test-key' });
      await provider.complete('prompt', { temperature: 0.7 });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
        }),
      );
    });

    it('complete() uses custom maxTokens', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ok' }],
      });

      const { AnthropicProvider } = await import(
        '../../src/providers/anthropic-provider.js'
      );
      const provider = new AnthropicProvider({ apiKey: 'test-key' });
      await provider.complete('prompt', { maxTokens: 1024 });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 1024,
        }),
      );
    });

    it('completeJSON() parses valid JSON response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"name":"Alice","age":30}' }],
      });

      const schema = z.object({ name: z.string(), age: z.number() });
      const { AnthropicProvider } = await import(
        '../../src/providers/anthropic-provider.js'
      );
      const provider = new AnthropicProvider({ apiKey: 'test-key' });
      const result = await provider.completeJSON('get user', schema);

      expect(result).toEqual({ name: 'Alice', age: 30 });
    });

    it('completeJSON() sends system prompt for JSON mode', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"value":"test"}' }],
      });

      const schema = z.object({ value: z.string() });
      const { AnthropicProvider } = await import(
        '../../src/providers/anthropic-provider.js'
      );
      const provider = new AnthropicProvider({ apiKey: 'test-key' });
      await provider.completeJSON('test', schema);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You must respond with valid JSON only. No markdown, no code blocks.',
        }),
      );
    });

    it('completeJSON() strips code block wrapping', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '```json\n{"name":"Bob","age":25}\n```' }],
      });

      const schema = z.object({ name: z.string(), age: z.number() });
      const { AnthropicProvider } = await import(
        '../../src/providers/anthropic-provider.js'
      );
      const provider = new AnthropicProvider({ apiKey: 'test-key' });
      const result = await provider.completeJSON('get user', schema);

      expect(result).toEqual({ name: 'Bob', age: 25 });
    });

    it('completeJSON() retries on invalid JSON', async () => {
      mockCreate
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'not valid json at all' }],
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: '{"name":"Alice","age":30}' }],
        });

      const schema = z.object({ name: z.string(), age: z.number() });
      const { AnthropicProvider } = await import(
        '../../src/providers/anthropic-provider.js'
      );
      const provider = new AnthropicProvider({ apiKey: 'test-key' });
      const result = await provider.completeJSON('get user', schema);

      expect(result).toEqual({ name: 'Alice', age: 30 });
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
  });
});
