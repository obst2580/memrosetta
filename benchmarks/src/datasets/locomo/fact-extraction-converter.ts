import { createHash } from 'node:crypto';
import type { MemoryInput } from '@memrosetta/types';
import type { BenchmarkDataset, BenchmarkQuery } from '../dataset-loader.js';
import type { LoCoMoSample } from './locomo-types.js';
import type { LoCoMoConverterStrategy } from './converter-types.js';
import {
  parseSample,
  generateMemoryId,
} from './locomo-converter.js';
import type { LoCoMoParsedDialogueTurn, LoCoMoParsedSession } from './locomo-types.js';
import type {
  FactExtractor,
  ConversationTurn,
  ExtractedFact,
  ExtractionCache,
} from '@memrosetta/llm';
import { PROMPT_VERSION } from '@memrosetta/llm';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CHUNK_SIZE = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FactExtractionConverterOptions {
  readonly extractor: FactExtractor;
  readonly cache?: ExtractionCache;
  readonly chunkSize?: number;
  readonly model?: string;
  readonly verbose?: boolean;
}

interface TurnChunk {
  readonly turns: readonly LoCoMoParsedDialogueTurn[];
  readonly sessionNumber: number;
  readonly dateTime: string;
  readonly speakerA: string;
  readonly speakerB: string;
  readonly samplePrefix: string;
}

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

/**
 * Converts LoCoMo samples using LLM-based fact extraction.
 * Groups dialogue turns into chunks, extracts atomic facts from each chunk,
 * and maps evidence turn IDs to the resulting fact-based memory IDs.
 */
export class FactExtractionConverter implements LoCoMoConverterStrategy {
  private readonly extractor: FactExtractor;
  private readonly cache: ExtractionCache | undefined;
  private readonly chunkSize: number;
  private readonly model: string;
  private readonly verbose: boolean;

  constructor(options: FactExtractionConverterOptions) {
    this.extractor = options.extractor;
    this.cache = options.cache;
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.model = options.model ?? 'unknown';
    this.verbose = options.verbose ?? false;
  }

  async convert(samples: readonly LoCoMoSample[]): Promise<BenchmarkDataset> {
    const parsedSamples = samples.map((sample, index) =>
      parseSample(sample, index),
    );

    const memoryInputs: MemoryInput[] = [];
    const queries: BenchmarkQuery[] = [];
    // Maps original diaId -> list of fact-based memory IDs
    const turnToFactIds = new Map<string, readonly string[]>();
    const memoryIdMapping = new Map<string, string>();

    let totalChunks = 0;
    let processedChunks = 0;

    // Count total chunks for progress
    for (const parsed of parsedSamples) {
      for (const session of parsed.sessions) {
        totalChunks += Math.ceil(session.turns.length / this.chunkSize);
      }
    }

    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 5;

    for (const parsed of parsedSamples) {
      const samplePrefix = `locomo-${parsed.sampleIndex}`;

      for (const session of parsed.sessions) {
        const chunks = this.chunkTurns(session, parsed.speakerA, parsed.speakerB, samplePrefix);

        for (const chunk of chunks) {
          const facts = await this.extractChunk(chunk);
          processedChunks++;

          if (facts.length === 0) {
            consecutiveFailures++;
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              throw new Error(
                `Extraction failed ${MAX_CONSECUTIVE_FAILURES} times consecutively. ` +
                'Check your API key and provider configuration.',
              );
            }
          } else {
            consecutiveFailures = 0;
          }

          if (this.verbose) {
            process.stderr.write(
              `Chunk ${processedChunks}/${totalChunks}: ${facts.length} facts extracted\n`,
            );
          }

          // Build memory IDs for each extracted fact
          const chunkFactIds: string[] = [];
          for (const [factIndex, fact] of facts.entries()) {
            const factKey = this.buildFactKey(chunk, factIndex);
            const memId = generateMemoryId(samplePrefix, factKey);
            chunkFactIds.push(memId);

            // Also register in memoryIdMapping with the factKey
            memoryIdMapping.set(factKey, memId);

            const input: MemoryInput = {
              userId: fact.subjectEntity ?? chunk.speakerA,
              namespace: samplePrefix,
              memoryType: fact.memoryType,
              content: fact.content,
              documentDate: chunk.dateTime,
              sourceId: factKey,
              confidence: fact.confidence,
              keywords: fact.keywords ?? [],
            };

            memoryInputs.push(input);
          }

          // Map each turn in this chunk to the extracted fact IDs
          for (const turn of chunk.turns) {
            const existing = turnToFactIds.get(turn.diaId) ?? [];
            turnToFactIds.set(turn.diaId, [...existing, ...chunkFactIds]);
          }
        }
      }

      // Build queries - map evidence diaIds to fact-based memory IDs
      for (const [qaIndex, qa] of parsed.qaItems.entries()) {
        const relevantMemoryIds: string[] = [];
        const seenIds = new Set<string>();

        for (const evidenceId of qa.evidence) {
          const factIds = turnToFactIds.get(evidenceId) ?? [];
          for (const fid of factIds) {
            if (!seenIds.has(fid)) {
              seenIds.add(fid);
              relevantMemoryIds.push(fid);
            }
          }
        }

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
      name: 'LoCoMo (fact-extraction)',
      description:
        'Long-context conversational memory benchmark with LLM-extracted atomic facts',
      memoryInputs,
      queries,
      memoryIdMapping,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private chunkTurns(
    session: LoCoMoParsedSession,
    speakerA: string,
    speakerB: string,
    samplePrefix: string,
  ): readonly TurnChunk[] {
    const chunks: TurnChunk[] = [];
    const turns = session.turns;

    for (let i = 0; i < turns.length; i += this.chunkSize) {
      const slicedTurns = turns.slice(i, i + this.chunkSize);
      chunks.push({
        turns: slicedTurns,
        sessionNumber: session.sessionNumber,
        dateTime: session.dateTime,
        speakerA,
        speakerB,
        samplePrefix,
      });
    }

    return chunks;
  }

  private async extractChunk(chunk: TurnChunk): Promise<readonly ExtractedFact[]> {
    const turnTexts = chunk.turns.map(t => `${t.speaker}: ${t.text}`);
    const cacheKey = ExtractionCacheHelper.buildKey(this.model, turnTexts);

    // Check cache
    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Convert to ConversationTurn format
    const conversationTurns: readonly ConversationTurn[] = chunk.turns.map(t => ({
      speaker: t.speaker,
      text: t.text,
      turnId: t.diaId,
    }));

    const facts = await this.extractor.extractFromTurns(conversationTurns, {
      dateTime: chunk.dateTime,
      sessionNumber: chunk.sessionNumber,
      speakerA: chunk.speakerA,
      speakerB: chunk.speakerB,
    });

    // Cache the result
    if (this.cache) {
      await this.cache.set(cacheKey, facts);
    }

    return facts;
  }

  private buildFactKey(chunk: TurnChunk, factIndex: number): string {
    const firstDiaId = chunk.turns[0]?.diaId ?? 'unknown';
    const lastDiaId = chunk.turns[chunk.turns.length - 1]?.diaId ?? 'unknown';
    return `fact-${firstDiaId}-${lastDiaId}-${factIndex}`;
  }
}

// ---------------------------------------------------------------------------
// Helper for building cache keys without importing ExtractionCache directly
// ---------------------------------------------------------------------------

class ExtractionCacheHelper {
  static buildKey(model: string, turnTexts: readonly string[]): string {
    const input = [model, PROMPT_VERSION, ...turnTexts].join('\n');
    return createHash('sha256').update(input).digest('hex').slice(0, 16);
  }
}
