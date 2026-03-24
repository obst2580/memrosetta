import type { LLMProvider, LLMProviderConfig, CompletionOptions } from '../types.js';
import type { z } from 'zod';

export class OpenAIProvider implements LLMProvider {
  private client: any = null;
  private readonly config: LLMProviderConfig;

  constructor(config: Partial<LLMProviderConfig> & { readonly model?: string } = {}) {
    this.config = {
      apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: config.baseURL,
      model: config.model ?? 'gpt-4o-mini',
      defaultOptions: config.defaultOptions,
    };
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    try {
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        ...(this.config.baseURL ? { baseURL: this.config.baseURL } : {}),
      });
      return this.client;
    } catch {
      throw new Error(
        'openai package not installed. Run: pnpm add openai',
      );
    }
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const client = await this.getClient();
    const merged = { ...this.config.defaultOptions, ...options };
    const response = await client.chat.completions.create({
      model: merged.model ?? this.config.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: merged.temperature ?? 0,
      ...(merged.maxTokens ? { max_tokens: merged.maxTokens } : {}),
    });
    return response.choices[0]?.message?.content ?? '';
  }

  async completeJSON<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: CompletionOptions,
  ): Promise<T> {
    const client = await this.getClient();
    const merged = { ...this.config.defaultOptions, ...options };

    const response = await client.chat.completions.create({
      model: merged.model ?? this.config.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: merged.temperature ?? 0,
      response_format: { type: 'json_object' },
      ...(merged.maxTokens ? { max_tokens: merged.maxTokens } : {}),
    });

    const text = response.choices[0]?.message?.content ?? '{}';
    const parsed: unknown = JSON.parse(text);

    const result = schema.safeParse(parsed);
    if (result.success) return result.data;

    // Retry once with error feedback
    const retryPrompt = `${prompt}\n\nYour previous response had validation errors:\n${result.error.message}\n\nPlease fix and respond with valid JSON.`;
    const retryResponse = await client.chat.completions.create({
      model: merged.model ?? this.config.model,
      messages: [{ role: 'user', content: retryPrompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
      ...(merged.maxTokens ? { max_tokens: merged.maxTokens } : {}),
    });

    const retryText = retryResponse.choices[0]?.message?.content ?? '{}';
    return schema.parse(JSON.parse(retryText));
  }
}
