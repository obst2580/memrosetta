// src/cli.ts
import { parseArgs } from "util";

// src/adapters/mock-engine.ts
import { randomUUID } from "crypto";
var MockEngine = class {
  memories = /* @__PURE__ */ new Map();
  relations = [];
  async initialize() {
  }
  async close() {
    this.memories.clear();
    this.relations = [];
  }
  async store(input) {
    const memory = {
      ...input,
      memoryId: randomUUID(),
      learnedAt: (/* @__PURE__ */ new Date()).toISOString(),
      isLatest: true
    };
    this.memories.set(memory.memoryId, memory);
    return memory;
  }
  async storeBatch(inputs) {
    const results = [];
    for (const input of inputs) {
      results.push(await this.store(input));
    }
    return results;
  }
  async getById(memoryId) {
    return this.memories.get(memoryId) ?? null;
  }
  async search(query) {
    const start = performance.now();
    const limit = query.limit ?? 10;
    const results = [...this.memories.values()].filter((m) => m.userId === query.userId).filter((m) => {
      const queryLower = query.query.toLowerCase();
      const contentLower = m.content.toLowerCase();
      const queryWords = queryLower.split(/\s+/);
      return queryWords.some((word) => contentLower.includes(word));
    }).slice(0, limit).map((memory, index) => ({
      memory,
      score: 1 / (index + 1),
      matchType: "fts"
    }));
    return {
      results,
      totalCount: results.length,
      queryTimeMs: performance.now() - start
    };
  }
  async relate(srcMemoryId, dstMemoryId, relationType, reason) {
    const relation = {
      srcMemoryId,
      dstMemoryId,
      relationType,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      reason
    };
    this.relations = [...this.relations, relation];
    return relation;
  }
  async count(userId) {
    return [...this.memories.values()].filter((m) => m.userId === userId).length;
  }
  async clear(userId) {
    for (const [id, memory] of this.memories) {
      if (memory.userId === userId) {
        this.memories.delete(id);
      }
    }
  }
};

// src/datasets/locomo/locomo-loader.ts
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// src/datasets/locomo/locomo-converter.ts
import { createHash } from "crypto";

// src/datasets/locomo/locomo-types.ts
import { z } from "zod";
var LoCoMoCategory = {
  SingleHop: 1,
  MultiHop: 2,
  Temporal: 3,
  OpenDomain: 4,
  Adversarial: 5
};
var LOCOMO_CATEGORY_LABELS = {
  [LoCoMoCategory.SingleHop]: "single-hop",
  [LoCoMoCategory.MultiHop]: "multi-hop",
  [LoCoMoCategory.Temporal]: "temporal",
  [LoCoMoCategory.OpenDomain]: "open-domain",
  [LoCoMoCategory.Adversarial]: "adversarial"
};
var locomoDialogueTurnSchema = z.object({
  speaker: z.string(),
  dia_id: z.string(),
  text: z.string(),
  img_url: z.array(z.string()).optional(),
  blip_caption: z.string().optional(),
  query: z.string().optional()
});
var locomoQAItemSchema = z.object({
  question: z.string(),
  answer: z.union([z.string(), z.number()]).optional(),
  evidence: z.array(z.string()),
  category: z.number().int().min(1).max(5),
  adversarial_answer: z.union([z.string(), z.number()]).optional()
});
var locomoConversationSchema = z.object({
  speaker_a: z.string(),
  speaker_b: z.string()
}).passthrough();
var locomoSampleSchema = z.object({
  qa: z.array(locomoQAItemSchema),
  conversation: locomoConversationSchema
});
var locomoDatasetSchema = z.array(locomoSampleSchema);

// src/datasets/locomo/locomo-converter.ts
var STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "need",
  "dare",
  "ought",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "he",
  "him",
  "his",
  "she",
  "her",
  "it",
  "its",
  "they",
  "them",
  "their",
  "what",
  "which",
  "who",
  "whom",
  "this",
  "that",
  "am",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "to",
  "with",
  "and",
  "but",
  "or",
  "nor",
  "not",
  "so",
  "if",
  "then",
  "than",
  "too",
  "very",
  "just"
]);
var MIN_KEYWORD_LENGTH = 3;
function convertLoCoMoDataset(samples) {
  const parsedSamples = samples.map(
    (sample, index) => parseSample(sample, index)
  );
  const memoryInputs = [];
  const queries = [];
  const memoryIdMapping = /* @__PURE__ */ new Map();
  for (const parsed of parsedSamples) {
    const samplePrefix = `locomo-${parsed.sampleIndex}`;
    for (const session of parsed.sessions) {
      for (const turn of session.turns) {
        const memoryId = generateMemoryId(samplePrefix, turn.diaId);
        memoryIdMapping.set(turn.diaId, memoryId);
        const input = {
          userId: turn.speaker,
          namespace: samplePrefix,
          memoryType: "fact",
          content: turn.text,
          rawText: turn.text,
          documentDate: session.dateTime,
          sourceId: turn.diaId,
          confidence: 1,
          salience: 1,
          keywords: extractKeywords(turn.text)
        };
        memoryInputs.push(input);
      }
    }
    for (const [qaIndex, qa] of parsed.qaItems.entries()) {
      const relevantMemoryIds = qa.evidence.map((evidenceId) => memoryIdMapping.get(evidenceId)).filter((id) => id !== void 0);
      const query = {
        queryId: `${samplePrefix}-q${qaIndex}`,
        query: qa.question,
        expectedAnswer: qa.answer,
        relevantMemoryIds,
        category: qa.categoryLabel
      };
      queries.push(query);
    }
  }
  return {
    name: "LoCoMo",
    description: "Long-context conversational memory benchmark with 5 QA reasoning types",
    memoryInputs,
    queries,
    memoryIdMapping
  };
}
function parseSample(sample, sampleIndex) {
  const conversation = sample.conversation;
  const sessions = [];
  const sessionNumbers = discoverSessionNumbers(conversation);
  for (const num of sessionNumbers) {
    const dateTimeKey = `session_${num}_date_time`;
    const sessionKey = `session_${num}`;
    const rawDateTime = conversation[dateTimeKey];
    const rawTurns = conversation[sessionKey];
    const dateTime = typeof rawDateTime === "string" ? rawDateTime : `session_${num}`;
    const turns = parseSessionTurns(rawTurns);
    sessions.push({
      sessionNumber: num,
      dateTime,
      turns
    });
  }
  const qaItems = sample.qa.map(parseQAItem);
  return {
    sampleIndex,
    speakerA: conversation.speaker_a,
    speakerB: conversation.speaker_b,
    sessions,
    qaItems
  };
}
function discoverSessionNumbers(conversation) {
  const sessionPattern = /^session_(\d+)$/;
  const numbers = [];
  for (const key of Object.keys(conversation)) {
    const match = sessionPattern.exec(key);
    if (match) {
      numbers.push(parseInt(match[1], 10));
    }
  }
  return [...numbers].sort((a, b) => a - b);
}
function parseSessionTurns(rawTurns) {
  if (!Array.isArray(rawTurns)) {
    return [];
  }
  const parsed = [];
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
function toParsedTurn(turn) {
  return {
    speaker: turn.speaker,
    diaId: turn.dia_id,
    text: turn.text,
    imgUrl: turn.img_url,
    blipCaption: turn.blip_caption,
    query: turn.query
  };
}
function parseQAItem(item) {
  const category = item.category;
  const answer = item.answer !== void 0 ? String(item.answer) : item.adversarial_answer !== void 0 ? String(item.adversarial_answer) : "";
  return {
    question: item.question,
    answer,
    evidence: item.evidence,
    category,
    categoryLabel: LOCOMO_CATEGORY_LABELS[category] ?? `unknown-${item.category}`,
    adversarialAnswer: item.adversarial_answer !== void 0 ? String(item.adversarial_answer) : void 0
  };
}
function generateMemoryId(prefix, diaId) {
  const hash = createHash("sha256").update(`${prefix}::${diaId}`).digest("hex").slice(0, 16);
  return `mem-${hash}`;
}
function extractKeywords(text) {
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).filter(
    (token) => token.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(token)
  );
  return [...new Set(tokens)];
}

// src/datasets/locomo/locomo-loader.ts
var LOCOMO_RAW_URL = "https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json";
var LOCOMO_FILENAME = "locomo10.json";
function resolveCacheDir() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const benchmarksRoot = join(currentDir, "..", "..", "..");
  return join(benchmarksRoot, "data", "locomo");
}
var LoCoMoLoader = class {
  cacheDir;
  url;
  constructor(options) {
    this.cacheDir = options?.cacheDir ?? resolveCacheDir();
    this.url = options?.url ?? LOCOMO_RAW_URL;
  }
  /**
   * Check if cached LoCoMo data exists locally.
   */
  async isAvailable() {
    return existsSync(this.cachedFilePath());
  }
  /**
   * Load the LoCoMo dataset. Downloads from GitHub if not cached.
   *
   * @throws {Error} If download fails and no cached data is available.
   */
  async load() {
    const raw = await this.loadRawData();
    const parsed = this.validate(raw);
    return convertLoCoMoDataset(parsed);
  }
  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------
  cachedFilePath() {
    return join(this.cacheDir, LOCOMO_FILENAME);
  }
  /**
   * Read from cache or download from GitHub.
   */
  async loadRawData() {
    const cachedPath = this.cachedFilePath();
    if (existsSync(cachedPath)) {
      const content = await readFile(cachedPath, "utf-8");
      return JSON.parse(content);
    }
    return this.downloadAndCache();
  }
  /**
   * Download the dataset from GitHub and write it to the cache directory.
   */
  async downloadAndCache() {
    let response;
    try {
      response = await fetch(this.url);
    } catch (error) {
      throw new Error(
        buildOfflineErrorMessage(this.url, this.cacheDir, error)
      );
    }
    if (!response.ok) {
      throw new Error(
        buildOfflineErrorMessage(
          this.url,
          this.cacheDir,
          new Error(`HTTP ${response.status}: ${response.statusText}`)
        )
      );
    }
    const text = await response.text();
    const data = JSON.parse(text);
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(this.cachedFilePath(), text, "utf-8");
    return data;
  }
  /**
   * Validate raw JSON against the LoCoMo zod schema.
   */
  validate(raw) {
    const result = locomoDatasetSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues.slice(0, 5).map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
      throw new Error(
        `LoCoMo dataset validation failed.
${issues}

The dataset format may have changed. Please re-download or check for schema updates.`
      );
    }
    return result.data;
  }
};
function buildOfflineErrorMessage(url, cacheDir, cause) {
  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  return `Failed to download LoCoMo dataset: ${causeMessage}

To use the LoCoMo benchmark offline, manually download the dataset:

  mkdir -p "${cacheDir}"
  curl -L "${url}" -o "${cacheDir}/${LOCOMO_FILENAME}"

Then re-run the benchmark.`;
}

// src/utils/timer.ts
function startTimer() {
  const start = performance.now();
  return () => performance.now() - start;
}

// src/adapters/engine-adapter.ts
var InstrumentedEngine = class {
  constructor(engine) {
    this.engine = engine;
  }
  latencySamples = /* @__PURE__ */ new Map();
  async initialize() {
    const elapsed = startTimer();
    await this.engine.initialize();
    this.recordSample("initialize", elapsed());
  }
  async close() {
    const elapsed = startTimer();
    await this.engine.close();
    this.recordSample("close", elapsed());
  }
  async store(input) {
    const elapsed = startTimer();
    const memory = await this.engine.store(input);
    const latencyMs = elapsed();
    this.recordSample("store", latencyMs);
    return { memory, latencyMs };
  }
  async storeBatch(inputs) {
    const elapsed = startTimer();
    const memories = await this.engine.storeBatch(inputs);
    const latencyMs = elapsed();
    this.recordSample("storeBatch", latencyMs);
    return { memories, latencyMs };
  }
  async getById(memoryId) {
    const elapsed = startTimer();
    const memory = await this.engine.getById(memoryId);
    const latencyMs = elapsed();
    this.recordSample("getById", latencyMs);
    return { memory, latencyMs };
  }
  async search(query) {
    const elapsed = startTimer();
    const response = await this.engine.search(query);
    const latencyMs = elapsed();
    this.recordSample("search", latencyMs);
    return { response, latencyMs };
  }
  async relate(srcMemoryId, dstMemoryId, relationType, reason) {
    const elapsed = startTimer();
    const relation = await this.engine.relate(
      srcMemoryId,
      dstMemoryId,
      relationType,
      reason
    );
    const latencyMs = elapsed();
    this.recordSample("relate", latencyMs);
    return { relation, latencyMs };
  }
  async count(userId) {
    const elapsed = startTimer();
    const count = await this.engine.count(userId);
    const latencyMs = elapsed();
    this.recordSample("count", latencyMs);
    return { count, latencyMs };
  }
  async clear(userId) {
    const elapsed = startTimer();
    await this.engine.clear(userId);
    this.recordSample("clear", elapsed());
  }
  getSamples(operation) {
    return this.latencySamples.get(operation) ?? [];
  }
  getAllSamples() {
    return this.latencySamples;
  }
  clearSamples() {
    this.latencySamples.clear();
  }
  recordSample(operation, latencyMs) {
    const existing = this.latencySamples.get(operation);
    if (existing) {
      existing.push(latencyMs);
    } else {
      this.latencySamples.set(operation, [latencyMs]);
    }
  }
};

// src/metrics/retrieval-metrics.ts
function precisionAtK(retrieved, relevant, k) {
  const effectiveK = Math.min(k, retrieved.length);
  if (effectiveK === 0) {
    return 0;
  }
  let relevantCount = 0;
  for (let i = 0; i < effectiveK; i++) {
    if (relevant.has(retrieved[i])) {
      relevantCount++;
    }
  }
  return relevantCount / effectiveK;
}
function recallAtK(retrieved, relevant, k) {
  if (relevant.size === 0) {
    return 0;
  }
  const effectiveK = Math.min(k, retrieved.length);
  let relevantCount = 0;
  for (let i = 0; i < effectiveK; i++) {
    if (relevant.has(retrieved[i])) {
      relevantCount++;
    }
  }
  return relevantCount / relevant.size;
}
function ndcgAtK(retrieved, relevant, k) {
  const effectiveK = Math.min(k, retrieved.length);
  if (effectiveK === 0 || relevant.size === 0) {
    return 0;
  }
  let dcg = 0;
  let relevantInTopK = 0;
  for (let i = 0; i < effectiveK; i++) {
    const rel = relevant.has(retrieved[i]) ? 1 : 0;
    if (rel === 1) {
      relevantInTopK++;
    }
    dcg += rel / Math.log2(i + 2);
  }
  if (dcg === 0) {
    return 0;
  }
  const idealRelevantCount = Math.min(relevant.size, effectiveK);
  let idcg = 0;
  for (let i = 0; i < idealRelevantCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return dcg / idcg;
}
function mrr(retrievedPerQuery, relevantPerQuery) {
  if (retrievedPerQuery.length === 0) {
    return 0;
  }
  let totalReciprocalRank = 0;
  for (let q = 0; q < retrievedPerQuery.length; q++) {
    const retrieved = retrievedPerQuery[q];
    const relevant = relevantPerQuery[q];
    for (let i = 0; i < retrieved.length; i++) {
      if (relevant.has(retrieved[i])) {
        totalReciprocalRank += 1 / (i + 1);
        break;
      }
    }
  }
  return totalReciprocalRank / retrievedPerQuery.length;
}

// src/utils/statistics.ts
function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length === 1) {
    return sorted[0];
  }
  const index = p / 100 * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  const fraction = index - lower;
  return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
}
function mean(values2) {
  if (values2.length === 0) {
    return 0;
  }
  const sum = values2.reduce((acc, v) => acc + v, 0);
  return sum / values2.length;
}

// src/metrics/latency-metrics.ts
function computeLatencyMetrics(operation, samples) {
  if (samples.length === 0) {
    return {
      operation,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      meanMs: 0,
      minMs: 0,
      maxMs: 0,
      sampleCount: 0
    };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    operation,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    meanMs: mean(samples),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    sampleCount: samples.length
  };
}

// src/runner/phase1-runner.ts
async function runPhase1(config) {
  const instrumented = new InstrumentedEngine(config.engine);
  await instrumented.initialize();
  if (config.verbose) {
    process.stdout.write("Loading LoCoMo dataset...\n");
  }
  const loader = new LoCoMoLoader();
  const dataset = await loader.load();
  if (config.verbose) {
    process.stdout.write(
      `Loaded ${dataset.memoryInputs.length} memories, ${dataset.queries.length} queries
`
    );
  }
  if (config.verbose) {
    process.stdout.write("Ingesting memories...\n");
  }
  const { memories: storedMemories } = await instrumented.storeBatch(
    dataset.memoryInputs
  );
  const deterministicToStored = /* @__PURE__ */ new Map();
  for (let i = 0; i < dataset.memoryInputs.length; i++) {
    const input = dataset.memoryInputs[i];
    const stored = storedMemories[i];
    if (input.sourceId) {
      const deterministicId = dataset.memoryIdMapping.get(input.sourceId);
      if (deterministicId) {
        deterministicToStored.set(deterministicId, stored.memoryId);
      }
    }
  }
  const userIds = new Set(storedMemories.map((m) => m.userId));
  if (config.verbose) {
    process.stdout.write(
      `Stored ${storedMemories.length} memories across ${userIds.size} users
`
    );
  }
  if (config.verbose) {
    process.stdout.write("Running search queries...\n");
  }
  const allRetrieved = [];
  const allRelevant = [];
  const categoryResults = /* @__PURE__ */ new Map();
  for (const query of dataset.queries) {
    const mappedRelevantIds = mapRelevantIds(
      query,
      deterministicToStored
    );
    const mergedResults = [];
    const seenIds = /* @__PURE__ */ new Set();
    for (const uid of userIds) {
      const { response: partialResponse } = await instrumented.search({
        userId: uid,
        query: query.query,
        limit: 10
      });
      for (const r of partialResponse.results) {
        if (!seenIds.has(r.memory.memoryId)) {
          seenIds.add(r.memory.memoryId);
          mergedResults.push({
            memoryId: r.memory.memoryId,
            score: r.score
          });
        }
      }
    }
    const sortedResults = [...mergedResults].sort((a, b) => b.score - a.score).slice(0, 10);
    const retrievedIds = sortedResults.map((r) => r.memoryId);
    allRetrieved.push(retrievedIds);
    allRelevant.push(mappedRelevantIds);
    const cat = query.category;
    const existing = categoryResults.get(cat) ?? {
      total: 0,
      correct: 0
    };
    const isCorrect = mappedRelevantIds.size > 0 && retrievedIds.some((id) => mappedRelevantIds.has(id));
    categoryResults.set(cat, {
      total: existing.total + 1,
      correct: existing.correct + (isCorrect ? 1 : 0)
    });
  }
  if (config.verbose) {
    process.stdout.write("Computing metrics...\n");
  }
  const p5Values = allRetrieved.map(
    (ret, i) => precisionAtK(ret, allRelevant[i], 5)
  );
  const r5Values = allRetrieved.map(
    (ret, i) => recallAtK(ret, allRelevant[i], 5)
  );
  const ndcg10Values = allRetrieved.map(
    (ret, i) => ndcgAtK(ret, allRelevant[i], 10)
  );
  const avgP5 = safeAverage(p5Values);
  const avgR5 = safeAverage(r5Values);
  const avgNdcg10 = safeAverage(ndcg10Values);
  const mrrValue = mrr(allRetrieved, allRelevant);
  const storeSamples = [...instrumented.getSamples("storeBatch")];
  const searchSamples = [...instrumented.getSamples("search")];
  const storeLatency = computeLatencyMetrics("store", storeSamples);
  const searchLatency = computeLatencyMetrics("search", searchSamples);
  const byCategory = {};
  for (const [cat, { total, correct }] of categoryResults) {
    byCategory[cat] = {
      total,
      correct,
      accuracy: total > 0 ? correct / total : 0
    };
  }
  const totalCorrect = [...categoryResults.values()].reduce(
    (sum, c) => sum + c.correct,
    0
  );
  await instrumented.close();
  return {
    name: "MemRosetta Phase 1 Benchmark",
    phase: "phase1",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    dataset: "LoCoMo",
    engineVersion: "0.1.0",
    retrieval: {
      precisionAtK: { 5: avgP5 },
      recallAtK: { 5: avgR5 },
      ndcgAtK: { 10: avgNdcg10 },
      mrr: mrrValue
    },
    latency: [storeLatency, searchLatency],
    qa: {
      totalQuestions: dataset.queries.length,
      correctAnswers: totalCorrect,
      accuracy: dataset.queries.length > 0 ? totalCorrect / dataset.queries.length : 0,
      byCategory
    },
    metadata: {
      memoryCount: dataset.memoryInputs.length,
      queryCount: dataset.queries.length
    }
  };
}
function mapRelevantIds(query, deterministicToStored) {
  if (!query.relevantMemoryIds || query.relevantMemoryIds.length === 0) {
    return /* @__PURE__ */ new Set();
  }
  const mapped = /* @__PURE__ */ new Set();
  for (const detId of query.relevantMemoryIds) {
    const storedId = deterministicToStored.get(detId);
    if (storedId) {
      mapped.add(storedId);
    }
  }
  return mapped;
}
function safeAverage(values2) {
  if (values2.length === 0) {
    return 0;
  }
  return values2.reduce((a, b) => a + b, 0) / values2.length;
}

// src/runner/benchmark-runner.ts
async function runBenchmarks(config) {
  const results = [];
  const engine = await config.engineFactory();
  for (const phase of config.phases) {
    switch (phase) {
      case "phase1":
      case "1": {
        const result = await runPhase1({
          engine,
          verbose: config.verbose
        });
        results.push(result);
        break;
      }
      default:
        process.stdout.write(`Unknown phase: ${phase}. Skipping.
`);
    }
  }
  return results;
}

// src/report/terminal-reporter.ts
var SEPARATOR = "============================================";
var DIVIDER = "--------------------------------------------";
function printReport(result, previous) {
  const lines = [];
  lines.push("");
  lines.push(SEPARATOR);
  lines.push("  MemRosetta Benchmark Report");
  lines.push(SEPARATOR);
  lines.push(`  Date:     ${result.timestamp}`);
  lines.push(`  Engine:   memrosetta v${result.engineVersion}`);
  lines.push(`  Dataset:  ${result.dataset}`);
  lines.push(DIVIDER);
  lines.push("");
  lines.push("  Retrieval Metrics");
  lines.push("  -----------------");
  for (const [k, v] of Object.entries(result.retrieval.precisionAtK)) {
    lines.push(`  Precision@${k}:    ${formatMetric(v)}`);
  }
  for (const [k, v] of Object.entries(result.retrieval.recallAtK)) {
    lines.push(`  Recall@${k}:       ${formatMetric(v)}`);
  }
  for (const [k, v] of Object.entries(result.retrieval.ndcgAtK)) {
    lines.push(`  nDCG@${k}:        ${formatMetric(v)}`);
  }
  lines.push(`  MRR:            ${formatMetric(result.retrieval.mrr)}`);
  if (result.qa) {
    lines.push("");
    lines.push("  By Category");
    lines.push("  -----------");
    for (const [cat, metrics] of Object.entries(result.qa.byCategory)) {
      const padded = padRight(cat + ":", 16);
      lines.push(
        `  ${padded}${formatMetric(metrics.accuracy)}  (${metrics.correct}/${metrics.total})`
      );
    }
  }
  if (result.latency.length > 0) {
    lines.push("");
    lines.push("  Latency");
    lines.push("  -------");
    for (const lat of result.latency) {
      lines.push(formatLatencyLine(lat));
    }
  }
  if (previous) {
    lines.push("");
    lines.push("  vs Previous Run");
    lines.push("  ---------------");
    for (const [k, v] of Object.entries(result.retrieval.precisionAtK)) {
      const prevValue = previous.retrieval.precisionAtK[Number(k)];
      if (prevValue !== void 0) {
        lines.push(
          `  Precision@${k}:    ${formatMetric(v)}  ${formatDelta(v, prevValue)}`
        );
      }
    }
    lines.push(
      `  MRR:            ${formatMetric(result.retrieval.mrr)}  ${formatDelta(result.retrieval.mrr, previous.retrieval.mrr)}`
    );
    const currentSearchLat = result.latency.find(
      (l) => l.operation === "search"
    );
    const prevSearchLat = previous.latency.find(
      (l) => l.operation === "search"
    );
    if (currentSearchLat && prevSearchLat) {
      lines.push(
        `  Search p95:     ${formatMs(currentSearchLat.p95Ms)}  ${formatDeltaMs(currentSearchLat.p95Ms, prevSearchLat.p95Ms)}`
      );
    }
  }
  lines.push("");
  lines.push(SEPARATOR);
  lines.push("");
  process.stdout.write(lines.join("\n"));
}
function formatMetric(value) {
  return value.toFixed(4);
}
function formatMs(value) {
  return `${value.toFixed(1)}ms`;
}
function formatLatencyLine(lat) {
  const name = padRight(lat.operation + ":", 9);
  return `  ${name}p50=${formatMs(lat.p50Ms)}   p95=${formatMs(lat.p95Ms)}   p99=${formatMs(lat.p99Ms)}   (n=${lat.sampleCount})`;
}
function formatDelta(current, prev) {
  const delta = current - prev;
  const pct = prev !== 0 ? delta / prev * 100 : 0;
  const sign = delta >= 0 ? "+" : "";
  return `(${sign}${delta.toFixed(4)}, ${sign}${pct.toFixed(1)}%)`;
}
function formatDeltaMs(current, prev) {
  const delta = current - prev;
  const pct = prev !== 0 ? delta / prev * 100 : 0;
  const sign = delta >= 0 ? "+" : "";
  return `(${sign}${delta.toFixed(1)}ms, ${sign}${pct.toFixed(1)}%)`;
}
function padRight(str, length) {
  return str.length >= length ? str : str + " ".repeat(length - str.length);
}

// src/report/json-reporter.ts
import { existsSync as existsSync2 } from "fs";
import { mkdir as mkdir2, readFile as readFile2, readdir, writeFile as writeFile2 } from "fs/promises";
import { join as join2 } from "path";
async function saveReport(result, outputDir) {
  await mkdir2(outputDir, { recursive: true });
  const timestamp = result.timestamp.replace(/[:.]/g, "-");
  const filename = `${timestamp}-${result.phase}.json`;
  const filePath = join2(outputDir, filename);
  const content = JSON.stringify(result, null, 2);
  await writeFile2(filePath, content, "utf-8");
  return filePath;
}
async function loadReport(filePath) {
  const content = await readFile2(filePath, "utf-8");
  return JSON.parse(content);
}
async function findLatestReport(outputDir, phase) {
  if (!existsSync2(outputDir)) {
    return null;
  }
  let entries;
  try {
    entries = await readdir(outputDir);
  } catch {
    return null;
  }
  const matching = entries.filter((name) => name.endsWith(`-${phase}.json`)).sort().reverse();
  if (matching.length === 0) {
    return null;
  }
  return join2(outputDir, matching[0]);
}

// src/cli.ts
var { values } = parseArgs({
  options: {
    phase: { type: "string", default: "1" },
    engine: { type: "string", default: "mock" },
    verbose: { type: "boolean", default: false },
    output: { type: "string", default: "./results" },
    help: { type: "boolean", default: false }
  },
  allowPositionals: true
});
if (values.help) {
  process.stdout.write(`
Usage: memrosetta-bench [options]

Options:
  --phase <n>     Phase to run (default: 1)
  --engine <type> Engine to use: mock, sqlite (default: mock)
  --verbose       Show detailed progress
  --output <dir>  Results output directory (default: ./results)
  --help          Show this help
`);
  process.exit(0);
}
async function main() {
  const engineType = values.engine ?? "mock";
  const outputDir = values.output ?? "./results";
  const verbose = values.verbose ?? false;
  const phases = (values.phase ?? "1").split(",");
  const engineFactory = async () => {
    switch (engineType) {
      case "mock":
        return new MockEngine();
      case "sqlite": {
        const { SqliteMemoryEngine } = await import("@memrosetta/core");
        const os = await import("os");
        const path = await import("path");
        const fs = await import("fs/promises");
        const tmpDir = path.join(os.tmpdir(), "memrosetta-bench");
        await fs.mkdir(tmpDir, { recursive: true });
        const dbPath = path.join(tmpDir, `bench-${Date.now()}.db`);
        return new SqliteMemoryEngine({ dbPath });
      }
      default:
        throw new Error(
          `Unknown engine: ${engineType}. Available: mock, sqlite`
        );
    }
  };
  const results = await runBenchmarks({
    phases,
    engineFactory,
    outputDir,
    verbose
  });
  for (const result of results) {
    const previousPath = await findLatestReport(outputDir, result.phase);
    const previous = previousPath ? await loadReport(previousPath) : void 0;
    printReport(result, previous);
    const savedPath = await saveReport(result, outputDir);
    process.stdout.write(`
Report saved: ${savedPath}
`);
  }
}
main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Benchmark failed: ${message}
`);
  process.exit(1);
});
