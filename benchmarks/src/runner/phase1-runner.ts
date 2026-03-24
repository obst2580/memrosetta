import type { IMemoryEngine } from '@memrosetta/types';
import type { BenchmarkResult } from '../metrics/metric-types.js';
import type { BenchmarkQuery } from '../datasets/dataset-loader.js';
import type { LoCoMoLoaderOptions } from '../datasets/locomo/locomo-loader.js';
import { LoCoMoLoader } from '../datasets/locomo/locomo-loader.js';
import { InstrumentedEngine } from '../adapters/engine-adapter.js';
import {
  precisionAtK,
  recallAtK,
  ndcgAtK,
  mrr,
} from '../metrics/retrieval-metrics.js';
import { computeLatencyMetrics } from '../metrics/latency-metrics.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Phase1Config {
  readonly engine: IMemoryEngine;
  readonly verbose?: boolean;
  readonly loaderOptions?: LoCoMoLoaderOptions;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run Phase 1 benchmark using the LoCoMo dataset.
 *
 * Pipeline:
 *  1. INGEST  - Load LoCoMo dataset, convert to MemoryInputs, storeBatch
 *  2. SEARCH  - For each query, run engine.search() and collect results
 *  3. EVALUATE - Compute retrieval metrics + latency metrics
 */
export async function runPhase1(
  config: Phase1Config,
): Promise<BenchmarkResult> {
  const instrumented = new InstrumentedEngine(config.engine);
  await instrumented.initialize();

  // ------------------------------------------------------------------
  // 1. INGEST
  // ------------------------------------------------------------------
  if (config.verbose) {
    process.stdout.write('Loading LoCoMo dataset...\n');
  }

  const loader = new LoCoMoLoader(config.loaderOptions);
  const dataset = await loader.load();

  if (config.verbose) {
    process.stdout.write(
      `Loaded ${dataset.memoryInputs.length} memories, ${dataset.queries.length} queries\n`,
    );
  }

  if (config.verbose) {
    process.stdout.write('Ingesting memories...\n');
  }

  const { memories: storedMemories } = await instrumented.storeBatch(
    dataset.memoryInputs,
  );

  // Build mapping from dataset sourceId to stored memoryId.
  // LoCoMo converter sets sourceId = dia_id, and memoryIdMapping maps
  // dia_id -> deterministic mem-{hash} id. However, the actual engine
  // assigns its own memoryId (e.g. a UUID). We need to map the
  // deterministic IDs used in BenchmarkQuery.relevantMemoryIds to the
  // real stored memoryIds.
  const deterministicToStored = new Map<string, string>();
  for (let i = 0; i < dataset.memoryInputs.length; i++) {
    const input = dataset.memoryInputs[i];
    const stored = storedMemories[i];
    if (input.sourceId) {
      // Find the deterministic ID for this sourceId (dia_id)
      const deterministicId = dataset.memoryIdMapping.get(input.sourceId);
      if (deterministicId) {
        deterministicToStored.set(deterministicId, stored.memoryId);
      }
    }
  }

  // Determine the userId used for search. LoCoMo memories have various
  // speaker-based userIds. We collect unique userIds from stored memories.
  const userIds = new Set(storedMemories.map((m) => m.userId));

  if (config.verbose) {
    process.stdout.write(
      `Stored ${storedMemories.length} memories across ${userIds.size} users\n`,
    );
  }

  // ------------------------------------------------------------------
  // 2. SEARCH
  // ------------------------------------------------------------------
  if (config.verbose) {
    process.stdout.write('Running search queries...\n');
  }

  const allRetrieved: string[][] = [];
  const allRelevant: ReadonlySet<string>[] = [];

  const categoryResults = new Map<
    string,
    { readonly total: number; readonly correct: number }
  >();

  for (const query of dataset.queries) {
    // Map the relevant memory IDs from deterministic to stored
    const mappedRelevantIds = mapRelevantIds(
      query,
      deterministicToStored,
    );

    // Search across all userIds since LoCoMo conversations involve
    // multiple speakers. Merge results from all users, deduplicate,
    // and keep the top results sorted by score.
    const mergedResults: { readonly memoryId: string; readonly score: number }[] = [];
    const seenIds = new Set<string>();

    for (const uid of userIds) {
      const { response: partialResponse } = await instrumented.search({
        userId: uid,
        query: query.query,
        limit: 10,
      });

      for (const r of partialResponse.results) {
        if (!seenIds.has(r.memory.memoryId)) {
          seenIds.add(r.memory.memoryId);
          mergedResults.push({
            memoryId: r.memory.memoryId,
            score: r.score,
          });
        }
      }
    }

    // Sort by score descending and take top 10
    const sortedResults = [...mergedResults]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const retrievedIds = sortedResults.map((r) => r.memoryId);
    allRetrieved.push(retrievedIds);
    allRelevant.push(mappedRelevantIds);

    // Track category accuracy
    const cat = query.category;
    const existing = categoryResults.get(cat) ?? {
      total: 0,
      correct: 0,
    };
    const isCorrect =
      mappedRelevantIds.size > 0 &&
      retrievedIds.some((id) => mappedRelevantIds.has(id));
    categoryResults.set(cat, {
      total: existing.total + 1,
      correct: existing.correct + (isCorrect ? 1 : 0),
    });
  }

  // ------------------------------------------------------------------
  // 3. EVALUATE
  // ------------------------------------------------------------------
  if (config.verbose) {
    process.stdout.write('Computing metrics...\n');
  }

  // Retrieval metrics -- per-query then averaged
  const p5Values = allRetrieved.map((ret, i) =>
    precisionAtK(ret, allRelevant[i], 5),
  );
  const r5Values = allRetrieved.map((ret, i) =>
    recallAtK(ret, allRelevant[i], 5),
  );
  const ndcg10Values = allRetrieved.map((ret, i) =>
    ndcgAtK(ret, allRelevant[i], 10),
  );

  const avgP5 = safeAverage(p5Values);
  const avgR5 = safeAverage(r5Values);
  const avgNdcg10 = safeAverage(ndcg10Values);
  const mrrValue = mrr(allRetrieved, allRelevant);

  // Latency metrics
  const storeSamples = [...instrumented.getSamples('storeBatch')];
  const searchSamples = [...instrumented.getSamples('search')];

  const storeLatency = computeLatencyMetrics('store', storeSamples);
  const searchLatency = computeLatencyMetrics('search', searchSamples);

  // Build category metrics
  const byCategory: Record<
    string,
    { readonly total: number; readonly correct: number; readonly accuracy: number }
  > = {};
  for (const [cat, { total, correct }] of categoryResults) {
    byCategory[cat] = {
      total,
      correct,
      accuracy: total > 0 ? correct / total : 0,
    };
  }

  const totalCorrect = [...categoryResults.values()].reduce(
    (sum, c) => sum + c.correct,
    0,
  );

  await instrumented.close();

  return {
    name: 'MemRosetta Phase 1 Benchmark',
    phase: 'phase1',
    timestamp: new Date().toISOString(),
    dataset: 'LoCoMo',
    engineVersion: '0.1.0',
    retrieval: {
      precisionAtK: { 5: avgP5 },
      recallAtK: { 5: avgR5 },
      ndcgAtK: { 10: avgNdcg10 },
      mrr: mrrValue,
    },
    latency: [storeLatency, searchLatency],
    qa: {
      totalQuestions: dataset.queries.length,
      correctAnswers: totalCorrect,
      accuracy:
        dataset.queries.length > 0
          ? totalCorrect / dataset.queries.length
          : 0,
      byCategory,
    },
    metadata: {
      memoryCount: dataset.memoryInputs.length,
      queryCount: dataset.queries.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map relevantMemoryIds from BenchmarkQuery (which use deterministic IDs)
 * to actual stored engine IDs.
 */
function mapRelevantIds(
  query: BenchmarkQuery,
  deterministicToStored: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  if (!query.relevantMemoryIds || query.relevantMemoryIds.length === 0) {
    return new Set<string>();
  }

  const mapped = new Set<string>();
  for (const detId of query.relevantMemoryIds) {
    const storedId = deterministicToStored.get(detId);
    if (storedId) {
      mapped.add(storedId);
    }
  }
  return mapped;
}

function safeAverage(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((a, b) => a + b, 0) / values.length;
}
