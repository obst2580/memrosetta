import type { LLMProvider } from '../types.js';
import type { MemoryInput } from '@memrosetta/types';
import {
  extractionResultSchema,
  type ExtractedFact,
  type ConversationTurn,
  type ExtractionContext,
} from './fact-extractor-types.js';
import { buildExtractionSystemPrompt, buildExtractionPrompt } from './prompts.js';

export interface FactExtractorOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly model?: string;
}

export class FactExtractor {
  private readonly provider: LLMProvider;
  private readonly options: FactExtractorOptions;

  constructor(provider: LLMProvider, options?: FactExtractorOptions) {
    this.provider = provider;
    this.options = options ?? {};
  }

  async extractFromTurns(
    turns: readonly ConversationTurn[],
    context: ExtractionContext = {},
  ): Promise<readonly ExtractedFact[]> {
    const systemPrompt = buildExtractionSystemPrompt();
    const userPrompt = buildExtractionPrompt(turns, context);
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    try {
      const result = await this.provider.completeJSON(
        fullPrompt,
        extractionResultSchema,
        {
          temperature: this.options.temperature ?? 0,
          maxTokens: this.options.maxTokens ?? 4096,
          model: this.options.model,
        },
      );
      return result.facts.filter(f => f.content.trim().length > 0);
    } catch (error) {
      // Log warning but don't break the pipeline
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Warning: Fact extraction failed: ${msg}\n`);
      return [];
    }
  }

  async extractFromText(text: string): Promise<readonly ExtractedFact[]> {
    return this.extractFromTurns([{ speaker: 'unknown', text }]);
  }

  toMemoryInputs(
    facts: readonly ExtractedFact[],
    baseInput: Partial<MemoryInput>,
  ): readonly MemoryInput[] {
    return facts.map(fact => ({
      userId: fact.subjectEntity ?? baseInput.userId ?? 'unknown',
      memoryType: fact.memoryType,
      content: fact.content,
      confidence: fact.confidence,
      keywords: fact.keywords ?? [],
      ...(baseInput.namespace != null ? { namespace: baseInput.namespace } : {}),
      ...(baseInput.documentDate != null ? { documentDate: baseInput.documentDate } : {}),
      ...(baseInput.sourceId != null ? { sourceId: baseInput.sourceId } : {}),
    }));
  }
}
