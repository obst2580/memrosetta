/**
 * Interface for text embedding providers.
 * Implementations convert text strings to dense float vectors.
 */
export interface Embedder {
  /** Initialize the model (download if needed, load into memory) */
  initialize(): Promise<void>;

  /** Release model resources */
  close(): Promise<void>;

  /** Embed a single text string. Returns Float32Array of the configured dimension. */
  embed(text: string): Promise<Float32Array>;

  /** Embed multiple texts efficiently. Returns array of Float32Array. */
  embedBatch(texts: readonly string[]): Promise<readonly Float32Array[]>;

  /** Get the embedding dimension */
  readonly dimension: number;
}

/**
 * Supported embedding presets.
 *
 * - 'en': English only (bge-small-en-v1.5, 33MB, 384 dim)
 * - 'multilingual': 94 languages (multilingual-e5-small, 100MB, 384 dim)
 * - 'ko': Korean optimized (ko-sroberta-multitask, 110MB, 768 dim)
 */
export type EmbeddingPreset = 'en' | 'multilingual' | 'ko';

export const EMBEDDING_PRESETS: Readonly<
  Record<EmbeddingPreset, { readonly modelId: string; readonly dimension: number }>
> = {
  en: { modelId: 'Xenova/bge-small-en-v1.5', dimension: 384 },
  multilingual: { modelId: 'Xenova/multilingual-e5-small', dimension: 384 },
  ko: { modelId: 'Xenova/ko-sroberta-nli-multitask', dimension: 768 },
};

/**
 * HuggingFace Transformers.js embedder.
 *
 * Supports multiple models via presets:
 * - 'en' (default): bge-small-en-v1.5 (English, 384 dim)
 * - 'multilingual': multilingual-e5-small (94 languages, 384 dim)
 * - 'ko': ko-sroberta-nli-multitask (Korean, 768 dim)
 *
 * Uses q8 quantized model for fast CPU inference.
 * Model is downloaded on first use and cached locally.
 */
export class HuggingFaceEmbedder implements Embedder {
  readonly dimension: number;
  private pipeline: any = null;
  private readonly modelId: string;

  constructor(options?: { readonly modelId?: string; readonly preset?: EmbeddingPreset }) {
    if (options?.preset) {
      const p = EMBEDDING_PRESETS[options.preset];
      this.modelId = p.modelId;
      this.dimension = p.dimension;
    } else {
      this.modelId = options?.modelId ?? EMBEDDING_PRESETS.en.modelId;
      this.dimension = 384;
    }
  }

  async initialize(): Promise<void> {
    if (this.pipeline) return;

    const { pipeline, env } = await import('@huggingface/transformers');

    env.allowLocalModels = true;

    this.pipeline = await pipeline('feature-extraction', this.modelId, {
      dtype: 'q8',
    });
  }

  async close(): Promise<void> {
    if (this.pipeline?.dispose) {
      await this.pipeline.dispose();
    }
    this.pipeline = null;
  }

  async embed(text: string): Promise<Float32Array> {
    this.ensureInitialized();
    const result = await this.pipeline(text, {
      pooling: 'mean',
      normalize: true,
    });
    return new Float32Array(result.data);
  }

  async embedBatch(
    texts: readonly string[],
  ): Promise<readonly Float32Array[]> {
    this.ensureInitialized();
    const results: Float32Array[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  private ensureInitialized(): void {
    if (!this.pipeline) {
      throw new Error('Embedder not initialized. Call initialize() first.');
    }
  }
}
