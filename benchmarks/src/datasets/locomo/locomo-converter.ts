import { createHash } from 'node:crypto';
import type { MemoryInput } from '@memrosetta/types';
import type { BenchmarkDataset, BenchmarkQuery } from '../dataset-loader.js';
import {
  type LoCoMoCategoryValue,
  type LoCoMoDialogueTurn,
  type LoCoMoParsedDialogueTurn,
  type LoCoMoParsedQAItem,
  type LoCoMoParsedSample,
  type LoCoMoParsedSession,
  type LoCoMoSample,
  LOCOMO_CATEGORY_LABELS,
  locomoDialogueTurnSchema,
} from './locomo-types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'it', 'its', 'they', 'them', 'their', 'what', 'which',
  'who', 'whom', 'this', 'that', 'am', 'at', 'by', 'for', 'from',
  'in', 'into', 'of', 'on', 'to', 'with', 'and', 'but', 'or', 'nor',
  'not', 'so', 'if', 'then', 'than', 'too', 'very', 'just',
]);

const MIN_KEYWORD_LENGTH = 3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert an array of raw LoCoMo samples into the common BenchmarkDataset
 * format used by the benchmark runner.
 */
export function convertLoCoMoDataset(
  samples: readonly LoCoMoSample[],
): BenchmarkDataset {
  const parsedSamples = samples.map((sample, index) =>
    parseSample(sample, index),
  );

  const memoryInputs: MemoryInput[] = [];
  const queries: BenchmarkQuery[] = [];
  const memoryIdMapping = new Map<string, string>();

  for (const parsed of parsedSamples) {
    const samplePrefix = `locomo-${parsed.sampleIndex}`;

    for (const session of parsed.sessions) {
      for (const turn of session.turns) {
        const memoryId = generateMemoryId(samplePrefix, turn.diaId);
        memoryIdMapping.set(turn.diaId, memoryId);

        const input: MemoryInput = {
          userId: turn.speaker,
          namespace: samplePrefix,
          memoryType: 'fact',
          content: turn.text,
          rawText: turn.text,
          documentDate: session.dateTime,
          sourceId: turn.diaId,
          confidence: 1.0,
          salience: 1.0,
          keywords: extractKeywords(turn.text),
        };

        memoryInputs.push(input);
      }
    }

    for (const [qaIndex, qa] of parsed.qaItems.entries()) {
      const relevantMemoryIds = qa.evidence
        .map((evidenceId) => memoryIdMapping.get(evidenceId))
        .filter((id): id is string => id !== undefined);

      const query: BenchmarkQuery = {
        queryId: `${samplePrefix}-q${qaIndex}`,
        query: qa.question,
        expectedAnswer: qa.answer,
        relevantMemoryIds,
        category: qa.categoryLabel,
      };

      queries.push(query);
    }
  }

  return {
    name: 'LoCoMo',
    description:
      'Long-context conversational memory benchmark with 5 QA reasoning types',
    memoryInputs,
    queries,
    memoryIdMapping,
  };
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a raw LoCoMo sample into the structured parsed format.
 * Extracts dynamically-keyed sessions from the conversation object.
 */
export function parseSample(
  sample: LoCoMoSample,
  sampleIndex: number,
): LoCoMoParsedSample {
  const conversation = sample.conversation;
  const sessions: LoCoMoParsedSession[] = [];

  // Sessions use dynamic keys: session_1, session_1_date_time, session_2, ...
  // Discover them by scanning the conversation object's keys.
  const sessionNumbers = discoverSessionNumbers(conversation);

  for (const num of sessionNumbers) {
    const dateTimeKey = `session_${num}_date_time`;
    const sessionKey = `session_${num}`;

    const rawDateTime = (conversation as Record<string, unknown>)[dateTimeKey];
    const rawTurns = (conversation as Record<string, unknown>)[sessionKey];

    const dateTime =
      typeof rawDateTime === 'string' ? rawDateTime : `session_${num}`;

    const turns = parseSessionTurns(rawTurns);

    sessions.push({
      sessionNumber: num,
      dateTime,
      turns,
    });
  }

  const qaItems = sample.qa.map(parseQAItem);

  return {
    sampleIndex,
    speakerA: conversation.speaker_a,
    speakerB: conversation.speaker_b,
    sessions,
    qaItems,
  };
}

/**
 * Discover which session numbers exist in the conversation object.
 * Returns sorted array of session numbers.
 */
function discoverSessionNumbers(
  conversation: Record<string, unknown>,
): readonly number[] {
  const sessionPattern = /^session_(\d+)$/;
  const numbers: number[] = [];

  for (const key of Object.keys(conversation)) {
    const match = sessionPattern.exec(key);
    if (match) {
      numbers.push(parseInt(match[1], 10));
    }
  }

  return [...numbers].sort((a, b) => a - b);
}

/**
 * Parse raw session turns, validating each with the zod schema.
 * Invalid turns are skipped with a warning.
 */
function parseSessionTurns(
  rawTurns: unknown,
): readonly LoCoMoParsedDialogueTurn[] {
  if (!Array.isArray(rawTurns)) {
    return [];
  }

  const parsed: LoCoMoParsedDialogueTurn[] = [];

  for (const rawTurn of rawTurns) {
    const result = locomoDialogueTurnSchema.safeParse(rawTurn);
    if (!result.success) {
      continue;
    }

    const turn = result.data;
    parsed.push(toParsedTurn(turn));
  }

  return parsed;
}

function toParsedTurn(turn: LoCoMoDialogueTurn): LoCoMoParsedDialogueTurn {
  return {
    speaker: turn.speaker,
    diaId: turn.dia_id,
    text: turn.text,
    imgUrl: turn.img_url,
    blipCaption: turn.blip_caption,
    query: turn.query,
  };
}

function parseQAItem(item: {
  readonly question: string;
  readonly answer?: string | number;
  readonly evidence: readonly string[];
  readonly category: number;
  readonly adversarial_answer?: string | number;
}): LoCoMoParsedQAItem {
  const category = item.category as LoCoMoCategoryValue;
  // Adversarial questions (category 5) may lack an answer field.
  // Fall back to adversarial_answer, then empty string.
  const answer =
    item.answer !== undefined
      ? String(item.answer)
      : item.adversarial_answer !== undefined
        ? String(item.adversarial_answer)
        : '';
  return {
    question: item.question,
    answer,
    evidence: item.evidence,
    category,
    categoryLabel:
      LOCOMO_CATEGORY_LABELS[category] ?? `unknown-${item.category}`,
    adversarialAnswer:
      item.adversarial_answer !== undefined
        ? String(item.adversarial_answer)
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic memory ID from a conversation prefix and dialog ID.
 * Uses SHA-256 truncated to 16 hex chars for uniqueness without excess length.
 */
export function generateMemoryId(prefix: string, diaId: string): string {
  const hash = createHash('sha256')
    .update(`${prefix}::${diaId}`)
    .digest('hex')
    .slice(0, 16);
  return `mem-${hash}`;
}

/**
 * Extract simple keywords from text by removing stop words and short tokens.
 * No LLM dependency -- purely rule-based tokenization.
 */
export function extractKeywords(text: string): readonly string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(
      (token) =>
        token.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(token),
    );

  // Deduplicate while preserving order
  return [...new Set(tokens)];
}
