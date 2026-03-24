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

  /** Get the embedding dimension (384 for bge-small-en-v1.5) */
  readonly dimension: number;
}

/**
 * HuggingFace Transformers.js embedder using bge-small-en-v1.5.
 *
 * Uses q8 quantized model for fast CPU inference.
 * Model is downloaded on first use and cached locally.
 */
export class HuggingFaceEmbedder implements Embedder {
  readonly dimension = 384;
  private pipeline: any = null;
  private readonly modelId: string;

  constructor(options?: { readonly modelId?: string }) {
    this.modelId = options?.modelId ?? 'Xenova/bge-small-en-v1.5';
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
