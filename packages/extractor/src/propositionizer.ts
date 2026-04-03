import type { FactDecomposer, PropositionizerOptions } from './types.js';

const DEFAULT_MODEL = 'liliplanet/propositionizer-mt5-small';
const DEFAULT_MAX_LENGTH = 256;
const DEFAULT_NUM_BEAMS = 4;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pipeline = (input: string, options?: Record<string, unknown>) => Promise<any>;

export class PropositionizerDecomposer implements FactDecomposer {
  private readonly modelId: string;
  private readonly maxLength: number;
  private readonly numBeams: number;
  private pipelinePromise: Promise<Pipeline> | null = null;

  constructor(options?: PropositionizerOptions) {
    this.modelId = options?.model ?? DEFAULT_MODEL;
    this.maxLength = options?.maxLength ?? DEFAULT_MAX_LENGTH;
    this.numBeams = options?.numBeams ?? DEFAULT_NUM_BEAMS;
  }

  private getPipeline(): Promise<Pipeline> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        const mod = await import('@huggingface/transformers');
        const pipe: Pipeline = await (mod.pipeline as Function)(
          'text2text-generation',
          this.modelId,
        );
        return pipe;
      })();
    }
    return this.pipelinePromise;
  }

  async decompose(text: string): Promise<readonly string[]> {
    return this.decomposeWithContext(text);
  }

  async decomposeWithContext(
    content: string,
    title = '',
    section = '',
  ): Promise<readonly string[]> {
    const input = `Title: ${title}. Section: ${section}. Content: ${content}`;
    const pipe = await this.getPipeline();

    const results = await pipe(input, {
      max_new_tokens: this.maxLength,
      num_beams: this.numBeams,
      repetition_penalty: 2.0,
      no_repeat_ngram_size: 3,
    });

    const output = (results as Array<{ generated_text: string }>)[0]?.generated_text ?? '';
    return this.parseOutput(output);
  }

  private parseOutput(text: string): readonly string[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map(s => s.trim());
      }
    } catch {
      // Not valid JSON — try extracting array
      const match = trimmed.match(/\[.*\]/s);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed)) {
            return parsed.filter(
              (item): item is string => typeof item === 'string' && item.trim().length > 0,
            );
          }
        } catch {
          // Fall through
        }
      }
    }

    // Fallback: return as single fact if non-empty
    return trimmed.length > 0 ? [trimmed] : [];
  }
}
