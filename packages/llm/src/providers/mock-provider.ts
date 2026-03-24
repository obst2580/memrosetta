import type { LLMProvider, CompletionOptions } from '../types.js';
import type { z } from 'zod';

interface MockCall {
  readonly prompt: string;
  readonly options?: CompletionOptions;
}

export class MockProvider implements LLMProvider {
  readonly calls: MockCall[] = [];
  private responses: readonly string[];
  private responseIndex = 0;
  private jsonResponses: Map<string, unknown> = new Map();

  constructor(responses: readonly string[] = ['mock response']) {
    this.responses = responses;
  }

  /** Set a JSON response that will be returned for any completeJSON call */
  setJSONResponse(response: unknown): void {
    this.jsonResponses.set('default', response);
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    this.calls.push({ prompt, options });
    const response =
      this.responses[this.responseIndex] ??
      this.responses[this.responses.length - 1];
    if (this.responseIndex < this.responses.length - 1) {
      this.responseIndex++;
    }
    return response;
  }

  async completeJSON<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: CompletionOptions,
  ): Promise<T> {
    this.calls.push({ prompt, options });
    const jsonResp = this.jsonResponses.get('default');
    if (jsonResp) return schema.parse(jsonResp);

    // Try to parse the next string response as JSON
    const text = await this.complete(prompt, options);
    return schema.parse(JSON.parse(text));
  }

  reset(): void {
    this.calls.length = 0;
    this.responseIndex = 0;
  }
}
