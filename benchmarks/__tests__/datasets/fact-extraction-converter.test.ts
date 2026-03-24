import { describe, it, expect, beforeEach } from 'vitest';
import { MockProvider } from '@memrosetta/llm';
import { FactExtractor, ExtractionCache, PROMPT_VERSION } from '@memrosetta/llm';
import { FactExtractionConverter } from '../../src/datasets/locomo/fact-extraction-converter.js';
import type { LoCoMoSample } from '../../src/datasets/locomo/locomo-types.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSingleSessionSample(): LoCoMoSample {
  return {
    qa: [
      {
        question: 'What did Alice buy?',
        answer: 'A red car',
        evidence: ['D1:1'],
        category: 1,
      },
    ],
    conversation: {
      speaker_a: 'Alice',
      speaker_b: 'Bob',
      session_1_date_time: '2024-01-15T10:00:00',
      session_1: [
        {
          speaker: 'Alice',
          dia_id: 'D1:1',
          text: 'I just bought a red car yesterday!',
        },
        {
          speaker: 'Bob',
          dia_id: 'D1:2',
          text: 'How much did it cost?',
        },
        {
          speaker: 'Alice',
          dia_id: 'D1:3',
          text: 'About $35,000.',
        },
      ],
    },
  };
}

function makeMultiSessionSample(): LoCoMoSample {
  return {
    qa: [
      {
        question: 'What car did Alice buy?',
        answer: 'A red car',
        evidence: ['D1:1'],
        category: 1,
      },
      {
        question: 'Where does Bob work?',
        answer: 'tech company',
        evidence: ['D2:1'],
        category: 1,
      },
    ],
    conversation: {
      speaker_a: 'Alice',
      speaker_b: 'Bob',
      session_1_date_time: '2024-01-15T10:00:00',
      session_1: [
        {
          speaker: 'Alice',
          dia_id: 'D1:1',
          text: 'I just bought a red car!',
        },
      ],
      session_2_date_time: '2024-01-20T14:00:00',
      session_2: [
        {
          speaker: 'Bob',
          dia_id: 'D2:1',
          text: 'I started working at a tech company.',
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FactExtractionConverter', () => {
  let provider: MockProvider;
  let extractor: FactExtractor;
  let tempDir: string;

  beforeEach(async () => {
    provider = new MockProvider();
    provider.setJSONResponse({
      facts: [
        {
          content: 'Alice bought a red car',
          memoryType: 'event',
          confidence: 0.95,
          keywords: ['car', 'red', 'Alice'],
          subjectEntity: 'Alice',
        },
        {
          content: 'The car cost $35,000',
          memoryType: 'fact',
          confidence: 0.9,
          keywords: ['car', 'cost'],
        },
      ],
    });
    extractor = new FactExtractor(provider);
    tempDir = await mkdtemp(join(tmpdir(), 'memrosetta-fact-conv-test-'));
  });

  it('should convert turns to facts using extractor', async () => {
    const converter = new FactExtractionConverter({
      extractor,
      model: 'test-model',
    });

    const dataset = await converter.convert([makeSingleSessionSample()]);

    // The mock returns 2 facts per chunk
    expect(dataset.memoryInputs.length).toBe(2);
    expect(dataset.memoryInputs[0].content).toBe('Alice bought a red car');
    expect(dataset.memoryInputs[0].memoryType).toBe('event');
    expect(dataset.memoryInputs[1].content).toBe('The car cost $35,000');
    expect(dataset.memoryInputs[1].memoryType).toBe('fact');
  });

  it('should produce valid BenchmarkDataset', async () => {
    const converter = new FactExtractionConverter({
      extractor,
      model: 'test-model',
    });

    const dataset = await converter.convert([makeSingleSessionSample()]);

    expect(dataset.name).toContain('LoCoMo');
    expect(dataset.name).toContain('fact-extraction');
    expect(dataset.description).toBeTruthy();
    expect(dataset.memoryInputs).toBeDefined();
    expect(dataset.queries).toBeDefined();
    expect(dataset.memoryIdMapping).toBeDefined();
  });

  it('should preserve QA queries', async () => {
    const converter = new FactExtractionConverter({
      extractor,
      model: 'test-model',
    });

    const dataset = await converter.convert([makeSingleSessionSample()]);

    expect(dataset.queries).toHaveLength(1);
    expect(dataset.queries[0].query).toBe('What did Alice buy?');
    expect(dataset.queries[0].expectedAnswer).toBe('A red car');
    expect(dataset.queries[0].category).toBe('single-hop');
  });

  it('should map evidence turn IDs to fact memory IDs', async () => {
    const converter = new FactExtractionConverter({
      extractor,
      model: 'test-model',
    });

    const dataset = await converter.convert([makeSingleSessionSample()]);

    // Evidence 'D1:1' is in the chunk, so all facts from that chunk
    // should be referenced
    const q = dataset.queries[0];
    expect(q.relevantMemoryIds).toBeDefined();
    expect(q.relevantMemoryIds!.length).toBeGreaterThan(0);
  });

  it('should produce deterministic memory IDs', async () => {
    const converter = new FactExtractionConverter({
      extractor,
      model: 'test-model',
    });

    const dataset1 = await converter.convert([makeSingleSessionSample()]);
    const dataset2 = await converter.convert([makeSingleSessionSample()]);

    expect(dataset1.memoryInputs[0].sourceId).toBe(
      dataset2.memoryInputs[0].sourceId,
    );
  });

  it('should set correct namespace per sample', async () => {
    const converter = new FactExtractionConverter({
      extractor,
      model: 'test-model',
    });

    const dataset = await converter.convert([makeSingleSessionSample()]);

    for (const input of dataset.memoryInputs) {
      expect(input.namespace).toBe('locomo-0');
    }
  });

  it('should handle multi-session samples', async () => {
    const converter = new FactExtractionConverter({
      extractor,
      model: 'test-model',
    });

    const dataset = await converter.convert([makeMultiSessionSample()]);

    // 2 sessions, each produces 2 facts (from mock) = 4 total
    expect(dataset.memoryInputs.length).toBe(4);
    expect(dataset.queries).toHaveLength(2);
  });

  it('should use cache when provided', async () => {
    const cache = new ExtractionCache(tempDir, PROMPT_VERSION);

    const converter = new FactExtractionConverter({
      extractor,
      cache,
      model: 'test-model',
    });

    // First call - cache miss
    await converter.convert([makeSingleSessionSample()]);
    const stats1 = cache.getStats();
    expect(stats1.misses).toBe(1);
    expect(stats1.hits).toBe(0);

    // Second call - cache hit
    provider.reset();
    await converter.convert([makeSingleSessionSample()]);
    const stats2 = cache.getStats();
    expect(stats2.hits).toBe(1);

    // Provider should only be called once (first call)
    expect(provider.calls).toHaveLength(0); // reset, and second call used cache

    await rm(tempDir, { recursive: true, force: true });
  });

  it('should handle empty sample', async () => {
    const emptySample: LoCoMoSample = {
      qa: [],
      conversation: {
        speaker_a: 'A',
        speaker_b: 'B',
      },
    };

    const converter = new FactExtractionConverter({
      extractor,
      model: 'test-model',
    });

    const dataset = await converter.convert([emptySample]);

    expect(dataset.memoryInputs).toHaveLength(0);
    expect(dataset.queries).toHaveLength(0);
  });
});
