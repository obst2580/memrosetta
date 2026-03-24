import { describe, expect, it } from 'vitest';
import {
  convertLoCoMoDataset,
  extractKeywords,
  generateMemoryId,
  parseSample,
} from '../../src/datasets/locomo/locomo-converter.js';
import type { LoCoMoSample } from '../../src/datasets/locomo/locomo-types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeSingleTurnSample(): LoCoMoSample {
  return {
    qa: [
      {
        question: 'When did Alice go hiking?',
        answer: 'Last Saturday',
        evidence: ['D1:1'],
        category: 1,
      },
    ],
    conversation: {
      speaker_a: 'Alice',
      speaker_b: 'Bob',
      session_1_date_time: '2023-05-08T10:00:00',
      session_1: [
        {
          speaker: 'Alice',
          dia_id: 'D1:1',
          text: 'I went hiking last Saturday and it was amazing!',
        },
      ],
    },
  };
}

function makeMultiTurnSample(): LoCoMoSample {
  return {
    qa: [
      {
        question: 'What hobby does Alice enjoy?',
        answer: 'painting',
        evidence: ['D1:2'],
        category: 1,
      },
      {
        question: 'When did Bob start learning guitar?',
        answer: 'June 2023',
        evidence: ['D2:1'],
        category: 3,
      },
      {
        question: 'What instrument does Alice play?',
        answer: 'piano',
        evidence: ['D1:1', 'D2:2'],
        category: 2,
      },
    ],
    conversation: {
      speaker_a: 'Alice',
      speaker_b: 'Bob',
      session_1_date_time: '2023-05-10T14:00:00',
      session_1: [
        {
          speaker: 'Alice',
          dia_id: 'D1:1',
          text: 'I play piano every evening after work.',
        },
        {
          speaker: 'Bob',
          dia_id: 'D1:2',
          text: 'That sounds lovely! I know you also love painting.',
        },
      ],
      session_2_date_time: '2023-06-15T09:00:00',
      session_2: [
        {
          speaker: 'Bob',
          dia_id: 'D2:1',
          text: 'I started learning guitar in June 2023.',
        },
        {
          speaker: 'Alice',
          dia_id: 'D2:2',
          text: 'We should jam together sometime with my piano!',
        },
      ],
    },
  };
}

function makeSampleWithAdversarial(): LoCoMoSample {
  return {
    qa: [
      {
        question: 'Does Alice have a pet cat?',
        answer: 'No, Alice has a dog.',
        evidence: ['D1:1'],
        category: 5,
        adversarial_answer: 'Yes, Alice has a cat.',
      },
    ],
    conversation: {
      speaker_a: 'Alice',
      speaker_b: 'Bob',
      session_1_date_time: '2023-07-01T12:00:00',
      session_1: [
        {
          speaker: 'Alice',
          dia_id: 'D1:1',
          text: 'My dog loves going to the park.',
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests: parseSample
// ---------------------------------------------------------------------------

describe('parseSample', () => {
  it('should parse a single-session sample correctly', () => {
    const raw = makeSingleTurnSample();
    const parsed = parseSample(raw, 0);

    expect(parsed.sampleIndex).toBe(0);
    expect(parsed.speakerA).toBe('Alice');
    expect(parsed.speakerB).toBe('Bob');
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0].sessionNumber).toBe(1);
    expect(parsed.sessions[0].dateTime).toBe('2023-05-08T10:00:00');
    expect(parsed.sessions[0].turns).toHaveLength(1);
    expect(parsed.sessions[0].turns[0].diaId).toBe('D1:1');
    expect(parsed.sessions[0].turns[0].speaker).toBe('Alice');
  });

  it('should parse multi-session conversations', () => {
    const raw = makeMultiTurnSample();
    const parsed = parseSample(raw, 3);

    expect(parsed.sampleIndex).toBe(3);
    expect(parsed.sessions).toHaveLength(2);
    expect(parsed.sessions[0].sessionNumber).toBe(1);
    expect(parsed.sessions[1].sessionNumber).toBe(2);
    expect(parsed.sessions[0].turns).toHaveLength(2);
    expect(parsed.sessions[1].turns).toHaveLength(2);
  });

  it('should parse QA items with correct category labels', () => {
    const raw = makeMultiTurnSample();
    const parsed = parseSample(raw, 0);

    expect(parsed.qaItems).toHaveLength(3);
    expect(parsed.qaItems[0].categoryLabel).toBe('single-hop');
    expect(parsed.qaItems[1].categoryLabel).toBe('temporal');
    expect(parsed.qaItems[2].categoryLabel).toBe('multi-hop');
  });

  it('should convert numeric answers to strings', () => {
    const raw: LoCoMoSample = {
      qa: [
        {
          question: 'How many pets does Alice have?',
          answer: 3,
          evidence: ['D1:1'],
          category: 1,
        },
      ],
      conversation: {
        speaker_a: 'Alice',
        speaker_b: 'Bob',
        session_1_date_time: '2023-01-01',
        session_1: [
          { speaker: 'Alice', dia_id: 'D1:1', text: 'I have 3 pets.' },
        ],
      },
    };

    const parsed = parseSample(raw, 0);
    expect(parsed.qaItems[0].answer).toBe('3');
  });

  it('should include adversarial answer when present', () => {
    const raw = makeSampleWithAdversarial();
    const parsed = parseSample(raw, 0);

    expect(parsed.qaItems[0].adversarialAnswer).toBe(
      'Yes, Alice has a cat.',
    );
    expect(parsed.qaItems[0].categoryLabel).toBe('adversarial');
  });
});

// ---------------------------------------------------------------------------
// Tests: convertLoCoMoDataset
// ---------------------------------------------------------------------------

describe('convertLoCoMoDataset', () => {
  it('should produce a BenchmarkDataset with correct metadata', () => {
    const dataset = convertLoCoMoDataset([makeSingleTurnSample()]);

    expect(dataset.name).toBe('LoCoMo');
    expect(dataset.description).toContain('Long-context');
  });

  it('should convert a single turn into a MemoryInput', () => {
    const dataset = convertLoCoMoDataset([makeSingleTurnSample()]);

    expect(dataset.memoryInputs).toHaveLength(1);
    const memory = dataset.memoryInputs[0];
    expect(memory.userId).toBe('Alice');
    expect(memory.memoryType).toBe('fact');
    expect(memory.content).toBe(
      'I went hiking last Saturday and it was amazing!',
    );
    expect(memory.documentDate).toBe('2023-05-08T10:00:00');
    expect(memory.sourceId).toBe('D1:1');
    expect(memory.confidence).toBe(1.0);
    expect(memory.namespace).toBe('locomo-0');
  });

  it('should convert multi-turn conversations into multiple MemoryInputs', () => {
    const dataset = convertLoCoMoDataset([makeMultiTurnSample()]);

    expect(dataset.memoryInputs).toHaveLength(4);

    const speakers = dataset.memoryInputs.map((m) => m.userId);
    expect(speakers).toEqual(['Alice', 'Bob', 'Bob', 'Alice']);
  });

  it('should build queries with resolved memory IDs', () => {
    const dataset = convertLoCoMoDataset([makeMultiTurnSample()]);

    expect(dataset.queries).toHaveLength(3);

    // First query references D1:2
    const q0 = dataset.queries[0];
    expect(q0.query).toBe('What hobby does Alice enjoy?');
    expect(q0.expectedAnswer).toBe('painting');
    expect(q0.category).toBe('single-hop');
    expect(q0.relevantMemoryIds).toHaveLength(1);

    // The relevant memory ID should be the one mapped from D1:2
    const expectedMemoryId = dataset.memoryIdMapping.get('D1:2');
    expect(q0.relevantMemoryIds?.[0]).toBe(expectedMemoryId);
  });

  it('should resolve multi-hop evidence to multiple memory IDs', () => {
    const dataset = convertLoCoMoDataset([makeMultiTurnSample()]);

    // Third query references D1:1 and D2:2
    const q2 = dataset.queries[2];
    expect(q2.relevantMemoryIds).toHaveLength(2);

    const id1 = dataset.memoryIdMapping.get('D1:1');
    const id2 = dataset.memoryIdMapping.get('D2:2');
    expect(q2.relevantMemoryIds).toContain(id1);
    expect(q2.relevantMemoryIds).toContain(id2);
  });

  it('should handle multiple samples in one dataset', () => {
    const dataset = convertLoCoMoDataset([
      makeSingleTurnSample(),
      makeMultiTurnSample(),
    ]);

    // 1 turn from first sample + 4 turns from second
    expect(dataset.memoryInputs).toHaveLength(5);
    // 1 query from first + 3 from second
    expect(dataset.queries).toHaveLength(4);
  });

  it('should use different namespaces for different samples', () => {
    const dataset = convertLoCoMoDataset([
      makeSingleTurnSample(),
      makeMultiTurnSample(),
    ]);

    const namespaces = new Set(dataset.memoryInputs.map((m) => m.namespace));
    expect(namespaces).toEqual(new Set(['locomo-0', 'locomo-1']));
  });

  it('should gracefully handle evidence IDs not found in turns', () => {
    const sample: LoCoMoSample = {
      qa: [
        {
          question: 'Nonexistent reference?',
          answer: 'N/A',
          evidence: ['D99:1'],
          category: 1,
        },
      ],
      conversation: {
        speaker_a: 'A',
        speaker_b: 'B',
        session_1_date_time: '2023-01-01',
        session_1: [
          { speaker: 'A', dia_id: 'D1:1', text: 'Hello.' },
        ],
      },
    };

    const dataset = convertLoCoMoDataset([sample]);
    // The missing evidence ID should be filtered out
    expect(dataset.queries[0].relevantMemoryIds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: generateMemoryId
// ---------------------------------------------------------------------------

describe('generateMemoryId', () => {
  it('should return a deterministic ID for the same input', () => {
    const id1 = generateMemoryId('locomo-0', 'D1:3');
    const id2 = generateMemoryId('locomo-0', 'D1:3');
    expect(id1).toBe(id2);
  });

  it('should return different IDs for different inputs', () => {
    const id1 = generateMemoryId('locomo-0', 'D1:3');
    const id2 = generateMemoryId('locomo-0', 'D1:4');
    const id3 = generateMemoryId('locomo-1', 'D1:3');

    expect(id1).not.toBe(id2);
    expect(id1).not.toBe(id3);
    expect(id2).not.toBe(id3);
  });

  it('should produce IDs with the mem- prefix', () => {
    const id = generateMemoryId('test', 'D1:1');
    expect(id).toMatch(/^mem-[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// Tests: extractKeywords
// ---------------------------------------------------------------------------

describe('extractKeywords', () => {
  it('should extract meaningful words and remove stop words', () => {
    const keywords = extractKeywords('I went hiking last Saturday');
    expect(keywords).toContain('went');
    expect(keywords).toContain('hiking');
    expect(keywords).toContain('last');
    expect(keywords).toContain('saturday');
    expect(keywords).not.toContain('i');
  });

  it('should remove short tokens', () => {
    const keywords = extractKeywords('I am at a OK fine');
    // 'am', 'at', 'ok' are all under 3 chars or stop words
    expect(keywords).toContain('fine');
    expect(keywords).not.toContain('am');
    expect(keywords).not.toContain('at');
  });

  it('should deduplicate keywords', () => {
    const keywords = extractKeywords('dog dog dog cat cat');
    expect(keywords).toEqual(['dog', 'cat']);
  });

  it('should return empty array for empty text', () => {
    const keywords = extractKeywords('');
    expect(keywords).toEqual([]);
  });

  it('should handle text with punctuation', () => {
    const keywords = extractKeywords(
      "Hello! How's your day? I'm doing great.",
    );
    expect(keywords).toContain('hello');
    expect(keywords).toContain("how's");
    expect(keywords).toContain('day');
    expect(keywords).toContain("i'm");
    expect(keywords).toContain('doing');
    expect(keywords).toContain('great');
  });
});
