import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HuggingFaceEmbedder, EMBEDDING_PRESETS } from '../src/embedder.js';
import type { EmbeddingPreset } from '../src/embedder.js';

describe('HuggingFaceEmbedder presets (no model download)', () => {
  it('default constructor uses en preset with dimension 384', () => {
    const embedder = new HuggingFaceEmbedder();
    expect(embedder.dimension).toBe(384);
  });

  it('preset "en" has dimension 384', () => {
    const embedder = new HuggingFaceEmbedder({ preset: 'en' });
    expect(embedder.dimension).toBe(384);
  });

  it('preset "multilingual" has dimension 384', () => {
    const embedder = new HuggingFaceEmbedder({ preset: 'multilingual' });
    expect(embedder.dimension).toBe(384);
  });

  it('preset "ko" has dimension 768', () => {
    const embedder = new HuggingFaceEmbedder({ preset: 'ko' });
    expect(embedder.dimension).toBe(768);
  });

  it('custom modelId defaults to dimension 384', () => {
    const embedder = new HuggingFaceEmbedder({ modelId: 'some/custom-model' });
    expect(embedder.dimension).toBe(384);
  });

  it('EMBEDDING_PRESETS contains all expected presets', () => {
    const keys = Object.keys(EMBEDDING_PRESETS) as readonly EmbeddingPreset[];
    expect(keys).toContain('en');
    expect(keys).toContain('multilingual');
    expect(keys).toContain('ko');
    expect(keys).toHaveLength(3);
  });

  it('EMBEDDING_PRESETS.en has correct modelId', () => {
    expect(EMBEDDING_PRESETS.en.modelId).toBe('Xenova/bge-small-en-v1.5');
    expect(EMBEDDING_PRESETS.en.dimension).toBe(384);
  });

  it('EMBEDDING_PRESETS.multilingual has correct modelId', () => {
    expect(EMBEDDING_PRESETS.multilingual.modelId).toBe('Xenova/multilingual-e5-small');
    expect(EMBEDDING_PRESETS.multilingual.dimension).toBe(384);
  });

  it('EMBEDDING_PRESETS.ko has correct modelId', () => {
    expect(EMBEDDING_PRESETS.ko.modelId).toBe('Xenova/ko-sroberta-nli-multitask');
    expect(EMBEDDING_PRESETS.ko.dimension).toBe(768);
  });

  it('throws if not initialized (preset constructor)', async () => {
    const embedder = new HuggingFaceEmbedder({ preset: 'multilingual' });
    await expect(embedder.embed('test')).rejects.toThrow('not initialized');
  });
});

describe('HuggingFaceEmbedder', () => {
  let embedder: HuggingFaceEmbedder;

  beforeAll(async () => {
    embedder = new HuggingFaceEmbedder();
    await embedder.initialize();
  }, 60_000);

  afterAll(async () => {
    await embedder.close();
  });

  it('has dimension 384', () => {
    expect(embedder.dimension).toBe(384);
  });

  it('embeds a string to Float32Array of correct dimension', async () => {
    const vec = await embedder.embed('hello world');
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(384);
  });

  it('produces normalized vectors (unit length)', async () => {
    const vec = await embedder.embed('test sentence');
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 1);
  });

  it('similar texts have higher cosine similarity', async () => {
    const v1 = await embedder.embed('The cat sat on the mat');
    const v2 = await embedder.embed('A kitten is sitting on a rug');
    const v3 = await embedder.embed('Stock market prices increased today');

    const sim12 = cosineSimilarity(v1, v2);
    const sim13 = cosineSimilarity(v1, v3);

    expect(sim12).toBeGreaterThan(sim13);
    expect(sim12).toBeGreaterThan(0.3);
  });

  it('embedBatch returns correct number of results', async () => {
    const texts = ['hello', 'world', 'test'];
    const results = await embedder.embedBatch(texts);
    expect(results.length).toBe(3);
    for (const vec of results) {
      expect(vec.length).toBe(384);
    }
  });

  it('double initialize is safe', async () => {
    await embedder.initialize();
  });

  it('throws if not initialized', async () => {
    const fresh = new HuggingFaceEmbedder();
    await expect(fresh.embed('test')).rejects.toThrow('not initialized');
  });
});

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
