import type { z } from 'zod';

export interface CompletionOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly model?: string;
}

export interface LLMProvider {
  /** Complete a prompt and return the text response */
  complete(prompt: string, options?: CompletionOptions): Promise<string>;

  /** Complete a prompt and parse the response as structured JSON */
  completeJSON<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: CompletionOptions,
  ): Promise<T>;
}

export interface LLMProviderConfig {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly model: string;
  readonly defaultOptions?: CompletionOptions;
}
