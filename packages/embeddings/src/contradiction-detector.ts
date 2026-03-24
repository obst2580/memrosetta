/**
 * NLI-based contradiction detection for memory pairs.
 *
 * Uses a cross-encoder NLI model (DeBERTa v3 xsmall) to classify
 * text pairs as entailment, neutral, or contradiction.
 * Runs locally on CPU -- no external API calls.
 */

export interface ContradictionResult {
  readonly label: 'entailment' | 'neutral' | 'contradiction';
  readonly score: number;
}

export interface ContradictionDetector {
  initialize(): Promise<void>;
  close(): Promise<void>;
  detect(textA: string, textB: string): Promise<ContradictionResult>;
  detectBatch(
    pairs: readonly { readonly textA: string; readonly textB: string }[],
  ): Promise<readonly ContradictionResult[]>;
}

export class NLIContradictionDetector implements ContradictionDetector {
  private pipeline: any = null;
  private readonly modelId: string;

  constructor(options?: { readonly modelId?: string }) {
    this.modelId = options?.modelId ?? 'Xenova/nli-deberta-v3-xsmall';
  }

  async initialize(): Promise<void> {
    if (this.pipeline) return;

    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = true;

    this.pipeline = await pipeline('text-classification', this.modelId, {
      dtype: 'q8',
    });
  }

  async close(): Promise<void> {
    if (this.pipeline?.dispose) {
      await this.pipeline.dispose();
    }
    this.pipeline = null;
  }

  async detect(textA: string, textB: string): Promise<ContradictionResult> {
    this.ensureInitialized();

    const result = await this.pipeline(textA, {
      text_pair: textB,
      top_k: null,
    });

    return this.parseResult(result);
  }

  async detectBatch(
    pairs: readonly { readonly textA: string; readonly textB: string }[],
  ): Promise<readonly ContradictionResult[]> {
    const results: ContradictionResult[] = [];
    for (const pair of pairs) {
      results.push(await this.detect(pair.textA, pair.textB));
    }
    return results;
  }

  private parseResult(result: any): ContradictionResult {
    // @huggingface/transformers text-classification with top_k: null returns
    // an array of { label, score } sorted by score descending.
    // With top_k not set, returns just the top result.
    const classifications: readonly { label: string; score: number }[] =
      Array.isArray(result) ? result : [result];

    // Find the highest-scoring classification
    const top = classifications.reduce((best, current) =>
      current.score > best.score ? current : best,
    );

    return {
      label: this.normalizeLabel(top.label),
      score: top.score,
    };
  }

  private normalizeLabel(
    label: string,
  ): 'entailment' | 'neutral' | 'contradiction' {
    const lower = label.toLowerCase();
    if (lower.includes('contradict')) return 'contradiction';
    if (lower.includes('entail')) return 'entailment';
    return 'neutral';
  }

  private ensureInitialized(): void {
    if (!this.pipeline) {
      throw new Error(
        'ContradictionDetector not initialized. Call initialize() first.',
      );
    }
  }
}
