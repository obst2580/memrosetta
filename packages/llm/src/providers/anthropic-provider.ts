import type { LLMProvider, LLMProviderConfig, CompletionOptions } from '../types.js';
import type { z } from 'zod';
import type AnthropicClient from '@anthropic-ai/sdk';

interface AnthropicContentBlock {
  readonly type: string;
  readonly text?: string;
}

interface AnthropicMessage {
  readonly content: readonly AnthropicContentBlock[];
}

export class AnthropicProvider implements LLMProvider {
  private client: AnthropicClient | null = null;
  private readonly config: LLMProviderConfig;

  constructor(config: Partial<LLMProviderConfig> & { readonly model?: string } = {}) {
    this.config = {
      apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
      baseURL: config.baseURL,
      model: config.model ?? 'claude-haiku-4-5-20251001',
      defaultOptions: config.defaultOptions,
    };
  }

  private async getClient(): Promise<AnthropicClient> {
    if (this.client) return this.client;
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      this.client = new Anthropic({
        apiKey: this.config.apiKey,
        ...(this.config.baseURL ? { baseURL: this.config.baseURL } : {}),
      });
      return this.client;
    } catch {
      throw new Error(
        '@anthropic-ai/sdk package not installed. Run: pnpm add @anthropic-ai/sdk',
      );
    }
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const client = await this.getClient();
    const merged = { ...this.config.defaultOptions, ...options };
    const response = await client.messages.create({
      model: merged.model ?? this.config.model,
      max_tokens: merged.maxTokens ?? 4096,
      messages: [{ role: 'user', content: prompt }],
      ...(merged.temperature != null ? { temperature: merged.temperature } : {}),
    });
    return extractText(response);
  }

  async completeJSON<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: CompletionOptions,
  ): Promise<T> {
    const client = await this.getClient();
    const merged = { ...this.config.defaultOptions, ...options };

    const response = await client.messages.create({
      model: merged.model ?? this.config.model,
      max_tokens: merged.maxTokens ?? 4096,
      system: 'You must respond with valid JSON only. No markdown, no code blocks.',
      messages: [{ role: 'user', content: prompt }],
      ...(merged.temperature != null ? { temperature: merged.temperature } : {}),
    });

    const text = extractText(response);
    const cleaned = stripCodeBlock(text);

    try {
      const parsed: unknown = JSON.parse(cleaned);
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // Fall through to retry
    }

    // Retry once with error feedback
    const retryPrompt = `${prompt}\n\nYour previous response was not valid JSON or failed schema validation. Respond with ONLY valid JSON, no markdown formatting.`;
    const retryResponse = await client.messages.create({
      model: merged.model ?? this.config.model,
      max_tokens: merged.maxTokens ?? 4096,
      system: 'You must respond with valid JSON only. No markdown, no code blocks.',
      messages: [{ role: 'user', content: retryPrompt }],
      temperature: 0,
    });

    const retryText = extractText(retryResponse);
    const retryCleaned = stripCodeBlock(retryText);
    return schema.parse(JSON.parse(retryCleaned));
  }
}

function extractText(response: AnthropicMessage): string {
  const blocks: readonly AnthropicContentBlock[] = response.content ?? [];
  const textParts = blocks
    .filter((b): b is AnthropicContentBlock & { readonly text: string } =>
      b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text);
  return textParts.join('');
}

function stripCodeBlock(text: string): string {
  const trimmed = text.trim();
  const codeBlockMatch = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/;
  const match = trimmed.match(codeBlockMatch);
  return match ? match[1].trim() : trimmed;
}
