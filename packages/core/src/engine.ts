import Database from 'better-sqlite3';
import type {
  IMemoryEngine,
  Memory,
  MemoryInput,
  MemoryTier,
  MemoryQuality,
  SearchQuery,
  SearchResponse,
  MemoryRelation,
  RelationType,
  CompressResult,
  MaintenanceResult,
  ReconstructRecallInput,
  ReconstructRecallResult,
  BuildEpisodesOptions,
  BuildEpisodesResult,
} from '@memrosetta/types';
import { ensureSchema } from './schema.js';
import {
  createPreparedStatements,
  storeMemory,
  storeBatchInTransaction,
  type PreparedStatements,
} from './store.js';
import { searchMemories } from './search.js';
import { getSourceAttestations } from './source.js';
import { recordCoAccess } from './coaccess.js';
import {
  createRelationStatements,
  createRelation,
  getRelationsByMemory,
  inferDeterministicRelation,
  type RelationStatements,
} from './relations.js';
import { rowToMemory, type MemoryRow } from './mapper.js';
import { generateMemoryId, nowIso, keywordsToString } from './utils.js';
import { computeActivation, computeEbbinghaus } from './activation.js';
import { determineTier, estimateTokens } from './tiers.js';
import { computeNoveltyScore } from './novelty.js';
import { ConsolidationQueue, type ConsolidationJob } from './consolidation.js';
import {
  discoverReplayRelations,
  type RelationDiscoveryCursor,
} from './replay.js';
import {
  reconstructRecall as reconstructRecallInternal,
  RecallHookRegistry,
} from './recall.js';
import {
  createConstructStatements,
  recordConstructReuse,
  type ConstructStatements,
} from './constructs.js';
import {
  createEpisodeStatements,
  insertEpisode,
  bindMemoryToEpisode,
} from './episodes.js';
import {
  createHippocampalStatements,
  reinforceEpisodicCue,
  type HippocampalStatements,
} from './hippocampal.js';
import type { FeatureFamily } from '@memrosetta/types';


/**
 * Layer B feature flags (v4 §2 Layer B, Codex Step 8 review Q5/Q10).
 *
 * These toggle the store-time runtime hooks for Layer B. All default
 * to OFF so existing callers see the Layer A behaviour they already
 * tested against. Enabling requires explicit opt-in, which is also
 * how Codex's "activation boundary" must-fix is satisfied: if you
 * want novelty scoring to influence salience, you turn the flag on.
 */
export interface LayerBConfig {
  /**
   * Compute a novelty score at store time and let it nudge salience.
   * Costs one FTS-style similarity pass against recent memories.
   */
  readonly enableNoveltyScoring?: boolean;
  /**
   * When true, the engine records a light "pattern separation" marker
   * on the newly-stored memory by writing its novelty score into the
   * `gist_confidence` slot when no explicit gist confidence was
   * provided. This keeps downstream Layer B jobs able to rank
   * candidates without requiring a new column.
   */
  readonly enablePatternSeparation?: boolean;
  /**
   * When true, novelty / pattern separation outcomes also enqueue a
   * background consolidation job (gist_refinement by default).
   */
  readonly enableConsolidation?: boolean;
  /**
   * Similarity threshold used by the Layer B novelty pass. Same
   * semantics as NoveltyInput.similarityThreshold.
   */
  readonly noveltySimilarityThreshold?: number;
  /** Recent replay window for relation discovery jobs. Default 7, max 30. */
  readonly relationDiscoveryRecentDays?: number;
  /** Minimum co-access count before replay can infer a relation. Default 2. */
  readonly relationDiscoveryCoAccessThreshold?: number;
}

export interface SqliteEngineOptions {
  readonly dbPath: string; // ':memory:' for in-memory, or file path
  /** Layer B runtime flags (default all OFF). */
  readonly layerB?: LayerBConfig;
}

export interface ConsolidationRunResult {
  readonly processed: number;
  readonly done: number;
  readonly failed: number;
  readonly retried: number;
  readonly jobs: readonly ConsolidationJob[];
  readonly orphanRecent: number;
  readonly orphanRatio: number;
}

interface AutoRelateCandidateRow {
  readonly memory_id: string;
  readonly keywords: string | null;
}

interface RelationDiscoveryJobPayload extends Record<string, unknown> {
  readonly recentDays?: number;
  readonly threshold?: number;
  readonly maxPairs?: number;
  readonly cursor?: RelationDiscoveryCursor;
}

export class SqliteMemoryEngine implements IMemoryEngine {
  private db: Database.Database | null = null;
  private stmts: PreparedStatements | null = null;
  private relStmts: RelationStatements | null = null;
  private constructStmts: ConstructStatements | null = null;
  private readonly options: SqliteEngineOptions;
  /**
   * Layer B consolidation queue. Always exists so tests and admin
   * flows can enqueue jobs; actual runtime integration is
   * flag-gated via options.layerB.enableConsolidation.
   */
  public readonly consolidation = new ConsolidationQueue();

  /**
   * @internal
   * Test / admin access to the underlying DB handle.
   *
   * NOT PART OF THE SUPPORTED APPLICATION SURFACE. Production callers
   * must go through typed engine methods (store, search, reconstructRecall
   * …). This exists so the test suite and admin tooling can issue
   * ad-hoc SQL without shipping parallel statement registries.
   *
   * Returns null before initialize() is called. May be removed or
   * renamed without a semver bump — do not depend on it from
   * downstream packages.
   */
  public rawDatabase(): Database.Database | null {
    return this.db;
  }

  constructor(options: SqliteEngineOptions) {
    this.options = options;
  }

  async initialize(): Promise<void> {
    this.db = new Database(this.options.dbPath);

    // WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    ensureSchema(this.db);

    this.stmts = createPreparedStatements(this.db);
    this.relStmts = createRelationStatements(this.db);
    this.constructStmts = createConstructStatements(this.db);
    this.consolidation.attach(this.db);
    this.consolidation.register('relation_discovery', async (_db, job) => {
      this.runRelationDiscoveryJob(job as ConsolidationJob<RelationDiscoveryJobPayload>);
    });
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.stmts = null;
      this.relStmts = null;
      this.consolidation.detach();
    }
  }

  async store(input: MemoryInput): Promise<Memory> {
    this.ensureInitialized();

    const memory: Memory = storeMemory(this.db!, this.stmts!, input);

    // Check for duplicates and auto-create 'updates' relation for very high similarity
    await this.checkDuplicates(memory);

    // Auto-create 'extends' relations for memories with overlapping keywords
    await this.autoRelate(memory);

    // Layer B activation (Codex Step 8 review must-fix: "define the
    // activation boundary"). All behaviour here is flag-gated so the
    // legacy engine path stays exactly as before unless a caller
    // explicitly opted in via options.layerB.
    this.runLayerB(memory);

    return memory;
  }

  private runLayerB(memory: Memory): void {
    const layerB = this.options.layerB;
    if (!layerB) return;
    if (!layerB.enableNoveltyScoring && !layerB.enablePatternSeparation && !layerB.enableConsolidation) {
      return;
    }

    // Compute novelty once and share the result across flags.
    const novelty = computeNoveltyScore(this.db!, {
      userId: memory.userId,
      content: memory.content,
      keywords: memory.keywords ? Array.from(memory.keywords) : undefined,
      similarityThreshold: layerB.noveltySimilarityThreshold,
      excludeMemoryId: memory.memoryId,
    });

    if (layerB.enableNoveltyScoring) {
      // Salience bump proportional to novelty. Avoid mutating the
      // salience outright — multiply by (0.5 + novelty/2) so very
      // novel memories land around 1.0x while near-duplicates settle
      // around 0.5x of the existing salience.
      const currentSalience = memory.salience ?? 1.0;
      const newSalience = Math.max(
        0,
        Math.min(1.5, currentSalience * (0.5 + novelty.score / 2)),
      );
      this.db!
        .prepare('UPDATE memories SET salience = ? WHERE memory_id = ?')
        .run(newSalience, memory.memoryId);
    }

    if (layerB.enablePatternSeparation) {
      // If the caller did not supply a gist_confidence, we park the
      // novelty score there as a soft proxy so later ranking can
      // tell "ultra-novel store" from "duplicate-of-earlier".
      if (memory.gistConfidence == null) {
        this.db!
          .prepare('UPDATE memories SET gist_confidence = ? WHERE memory_id = ?')
          .run(novelty.score, memory.memoryId);
      }
    }

    if (layerB.enableConsolidation) {
      this.consolidation.enqueue({
        userId: memory.userId,
        kind: 'gist_refinement',
        dedupKey: `gist_refinement:${memory.memoryId}`,
        payload: {
          memoryId: memory.memoryId,
          noveltyScore: novelty.score,
          neighborCount: novelty.neighborCount,
        },
      });
    }
  }

  /**
   * Reconstructive Recall (v4 §6). Runs the Step 7 pipeline with the
   * Step 9 full anti-interference. Each returned evidence that maps to
   * a memory_constructs row also gets its reuse counter incremented
   * (Codex Step 9 review must-fix): if constructs can now influence
   * ranking, the system needs a principled way to say they were used.
   *
   * Layer C plugins (MINERVA echo, reconsolidation) should register
   * against the hooks passed in via options; when omitted, the
   * default registry is used.
   */
  async reconstructRecall(
    input: ReconstructRecallInput,
    hooks?: RecallHookRegistry,
  ): Promise<ReconstructRecallResult> {
    this.ensureInitialized();
    const registry = hooks ?? new RecallHookRegistry();

    // Wire construct reuse accounting to on_recall so callers that
    // bring their own hook registry still get it — unless they've
    // already registered an on_recall handler, in which case we
    // piggyback rather than replace.
    registry.register('on_recall', (ctx) => {
      for (const e of ctx.evidence) {
        const hasConstruct = this.constructStmts!
          ? this.constructStmts.getConstruct.get(e.memoryId)
          : null;
        if (!hasConstruct) continue;
        // Success attribution: conservatively mark reuse as
        // "not yet confirmed successful" — Layer B feedback API
        // will bump the success counter explicitly via
        // engine.feedback() once the caller reports outcomes.
        recordConstructReuse(this.constructStmts!, e.memoryId, false);
      }
    });

    return reconstructRecallInternal(this.db!, this.stmts!.hippocampal, input, registry);
  }

  async storeBatch(
    inputs: readonly MemoryInput[],
  ): Promise<readonly Memory[]> {
    this.ensureInitialized();
    const memories = storeBatchInTransaction(this.db!, this.stmts!, inputs);

    // Run post-store checks for small batches (<=50)
    if (memories.length <= 50) {
      for (const memory of memories) {
        try {
          await this.checkDuplicates(memory);
        } catch {
          // Failure should not block storage
        }
        try {
          await this.autoRelate(memory);
        } catch {
          // Failure should not block storage
        }
      }
    }

    return memories;
  }

  async getById(memoryId: string): Promise<Memory | null> {
    this.ensureInitialized();
    const row = this.stmts!.getByMemoryId.get(memoryId) as
      | MemoryRow
      | undefined;
    return row ? rowToMemory(row) : null;
  }

  async search(query: SearchQuery): Promise<SearchResponse> {
    this.ensureInitialized();
    const response = searchMemories(this.db!, query);

    // Hebbian co-access: record that these memories were retrieved
    // together so future searches can boost co-accessed neighbors.
    // Only top results (up to 10) to avoid flooding the table.
    if (response.results.length >= 2) {
      const topIds = response.results.slice(0, 10).map((r) => r.memory.memoryId);
      recordCoAccess(this.db!, topIds);
    }

    if (!query.includeSource) return response;

    return {
      ...response,
      results: response.results.map((result) => ({
        ...result,
        sources: getSourceAttestations(this.stmts!.source, result.memory.memoryId),
      })),
    };
  }

  async relate(
    srcMemoryId: string,
    dstMemoryId: string,
    relationType: RelationType,
    reason?: string,
  ): Promise<MemoryRelation> {
    this.ensureInitialized();
    return createRelation(
      this.db!,
      this.relStmts!,
      srcMemoryId,
      dstMemoryId,
      relationType,
      reason,
    );
  }

  async getRelations(memoryId: string): Promise<readonly MemoryRelation[]> {
    this.ensureInitialized();
    return getRelationsByMemory(this.relStmts!, memoryId);
  }

  async count(userId: string): Promise<number> {
    this.ensureInitialized();
    const row = this.stmts!.countByUser.get(userId) as { count: number };
    return row.count;
  }

  async clear(userId: string): Promise<void> {
    this.ensureInitialized();
    const db = this.db!;

    // Use transaction for atomicity
    const clearTransaction = db.transaction((uid: string) => {
      // 1. Delete relations involving this user's memories
      db.prepare(
        `
        DELETE FROM memory_relations WHERE src_memory_id IN (
          SELECT memory_id FROM memories WHERE user_id = ?
        ) OR dst_memory_id IN (
          SELECT memory_id FROM memories WHERE user_id = ?
        )
      `,
      ).run(uid, uid);

      // 2. Delete memories (FTS sync triggers handle FTS cleanup)
      db.prepare('DELETE FROM memories WHERE user_id = ?').run(uid);
    });

    clearTransaction(userId);
  }

  async invalidate(memoryId: string, _reason?: string): Promise<void> {
    this.ensureInitialized();
    const now = new Date().toISOString();
    this.db!.prepare(
      'UPDATE memories SET invalidated_at = ? WHERE memory_id = ?',
    ).run(now, memoryId);
  }

  async clearNamespace(userId: string, namespace: string): Promise<void> {
    this.ensureInitialized();
    const db = this.db!;

    const clearTransaction = db.transaction((uid: string, ns: string) => {
      db.prepare(`
        DELETE FROM memory_relations WHERE src_memory_id IN (
          SELECT memory_id FROM memories WHERE user_id = ? AND namespace = ?
        ) OR dst_memory_id IN (
          SELECT memory_id FROM memories WHERE user_id = ? AND namespace = ?
        )
      `).run(uid, ns, uid, ns);

      db.prepare('DELETE FROM memories WHERE user_id = ? AND namespace = ?').run(uid, ns);
    });

    clearTransaction(userId, namespace);
  }

  async workingMemory(userId: string, maxTokens: number = 3000): Promise<readonly Memory[]> {
    this.ensureInitialized();
    const db = this.db!;

    // Get memories ordered by tier priority then activation score
    const rows = db.prepare(`
      SELECT * FROM memories
      WHERE user_id = ? AND is_latest = 1 AND invalidated_at IS NULL
      ORDER BY
        CASE tier WHEN 'hot' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END,
        activation_score DESC
    `).all(userId) as MemoryRow[];

    const result: Memory[] = [];
    let totalTokens = 0;

    for (const row of rows) {
      const memory = rowToMemory(row);
      const estimated = estimateTokens(memory.content);

      if (totalTokens + estimated > maxTokens) break;

      result.push(memory);
      totalTokens += estimated;
    }

    return result;
  }

  async compress(userId: string): Promise<CompressResult> {
    this.ensureInitialized();
    const db = this.db!;

    // Find cold memories with very low activation (exclude invalidated)
    const coldMemories = db.prepare(`
      SELECT * FROM memories
      WHERE user_id = ? AND tier = 'cold' AND activation_score < 0.1 AND is_latest = 1
      AND invalidated_at IS NULL
      ORDER BY namespace, learned_at
    `).all(userId) as MemoryRow[];

    if (coldMemories.length === 0) return { compressed: 0, removed: 0 };

    // Group by namespace
    const groups = new Map<string, MemoryRow[]>();
    for (const row of coldMemories) {
      const ns = row.namespace ?? '__default__';
      const existing = groups.get(ns);
      if (existing) {
        existing.push(row);
      } else {
        groups.set(ns, [row]);
      }
    }

    let compressed = 0;
    let removed = 0;

    const transaction = db.transaction(() => {
      for (const [namespace, rows] of groups) {
        if (rows.length < 2) continue; // Don't compress single memories

        // Create summary: concatenate content with separators
        const summaryContent = rows
          .map(r => r.content)
          .join(' | ');

        // Truncate if too long
        const content = summaryContent.length > 500
          ? summaryContent.slice(0, 497) + '...'
          : summaryContent;

        // Store compressed memory
        const memoryId = generateMemoryId();
        const learnedAt = nowIso();

        this.stmts!.insertMemory.run(
          memoryId,
          userId,
          namespace === '__default__' ? null : namespace,
          'fact', // compressed summaries are facts
          content,
          null, // raw_text
          null, // document_date
          learnedAt,
          null, // source_id
          0.5, // confidence
          0.5, // salience
          1, // is_latest
          null, // keywords
          null, // event_date_start
          null, // event_date_end
          null, // invalidated_at
          'cold', // tier
          0.5, // activation_score
          0, // access_count
          null, // last_accessed_at
          rows[0].memory_id, // compressed_from
          0, // use_count
          0, // success_count
          null, // project
          null, // activity_type
          content, // verbatim_content — summary text itself
          null, // gist_content (no separate gist for summaries yet)
          null, // gist_confidence
          null, // gist_extracted_at
          null, // gist_extracted_model
          'semantic', // memory_system — summaries are semantic abstractions
          'fact', // memory_role — summary is a fact by convention
        );
        compressed++;

        // Mark originals as not latest
        for (const row of rows) {
          db.prepare('UPDATE memories SET is_latest = 0 WHERE memory_id = ?')
            .run(row.memory_id);
          removed++;
        }
      }
    });

    transaction();
    return { compressed, removed };
  }

  async maintain(userId: string): Promise<MaintenanceResult> {
    this.ensureInitialized();
    const db = this.db!;

    // 1. Recompute activation scores for all active memories
    const memories = db.prepare(
      'SELECT * FROM memories WHERE user_id = ? AND is_latest = 1',
    ).all(userId) as MemoryRow[];

    let activationUpdated = 0;

    const updateActivation = db.prepare(
      'UPDATE memories SET activation_score = ? WHERE memory_id = ?',
    );

    const activationTransaction = db.transaction(() => {
      for (const mem of memories) {
        // Use Ebbinghaus forgetting curve (works with existing fields)
        const ebbinghaus = computeEbbinghaus(
          mem.access_count ?? 0,
          mem.last_accessed_at ?? null,
        );
        // Blend Ebbinghaus retention with salience for final activation score
        // Ebbinghaus dominates (80%) so that old unused memories decay properly
        const score = ebbinghaus * 0.8 + (mem.salience ?? 1.0) * 0.2;
        updateActivation.run(score, mem.memory_id);
        activationUpdated++;
      }
    });

    activationTransaction();

    // 2. Update tiers based on age and activation
    // Re-read memories with updated activation scores
    const updatedMemories = db.prepare(
      'SELECT * FROM memories WHERE user_id = ? AND is_latest = 1',
    ).all(userId) as MemoryRow[];

    let tiersUpdated = 0;
    const updateTier = db.prepare(
      'UPDATE memories SET tier = ? WHERE memory_id = ?',
    );

    const tierTransaction = db.transaction(() => {
      for (const mem of updatedMemories) {
        const newTier = determineTier({
          learnedAt: mem.learned_at,
          activationScore: mem.activation_score ?? 1.0,
          tier: mem.tier ?? 'warm',
          accessCount: mem.access_count ?? 0,
        });

        if (newTier !== (mem.tier ?? 'warm')) {
          updateTier.run(newTier, mem.memory_id);
          tiersUpdated++;
        }
      }
    });

    tierTransaction();

    // 3. Compress cold low-activation memories
    const compressResult = await this.compress(userId);

    return {
      activationUpdated,
      tiersUpdated,
      compressed: compressResult.compressed,
      removed: compressResult.removed,
    };
  }

  async runConsolidation(
    userId: string,
    options: {
      readonly limit?: number;
      readonly maxAttempts?: number;
    } = {},
  ): Promise<ConsolidationRunResult> {
    this.ensureInitialized();
    const db = this.db!;
    const limit = options.limit ?? 50;
    const maxAttempts = options.maxAttempts ?? 3;
    let processed = 0;
    let done = 0;
    let failed = 0;
    let retried = 0;
    const jobs: ConsolidationJob[] = [];

    this.enqueueRelationDiscoveryJob(userId);

    while (processed < limit) {
      const job =
        (await this.consolidation.runNext(db, 'abstraction', { userId, maxAttempts })) ??
        (await this.consolidation.runNext(db, 'maintenance', { userId, maxAttempts }));
      if (!job) break;

      processed++;
      jobs.push(job);
      if (job.status === 'done') done++;
      else if (job.status === 'failed') failed++;
      else if (job.status === 'pending') retried++;
    }

    const orphanMetrics = this.computeRecentOrphanMetrics(userId);
    return { processed, done, failed, retried, jobs, ...orphanMetrics };
  }

  private enqueueRelationDiscoveryJob(
    userId: string,
    payload: RelationDiscoveryJobPayload = this.defaultRelationDiscoveryPayload(),
  ): void {
    if (!this.options.layerB?.enableConsolidation) return;

    const cursor = payload.cursor;
    const cursorKey = cursor
      ? `${cursor.coAccessCount}:${cursor.memoryAId}:${cursor.memoryBId}`
      : 'default';
    this.consolidation.enqueue({
      userId,
      kind: 'relation_discovery',
      dedupKey: `relation_discovery:${userId}:${cursorKey}`,
      payload,
    });
  }

  private runRelationDiscoveryJob(
    job: ConsolidationJob<RelationDiscoveryJobPayload>,
  ): void {
    const payload = {
      ...this.defaultRelationDiscoveryPayload(),
      ...job.payload,
    };
    const result = discoverReplayRelations(this.db!, {
      userId: job.userId,
      recentDays: payload.recentDays,
      coAccessThreshold: payload.threshold,
      maxPairs: payload.maxPairs,
      cursor: payload.cursor,
    });

    if (result.nextCursor) {
      this.enqueueRelationDiscoveryJob(job.userId, {
        ...payload,
        cursor: result.nextCursor,
      });
    }
  }

  private defaultRelationDiscoveryPayload(): RelationDiscoveryJobPayload {
    const layerB = this.options.layerB;
    return {
      recentDays: clampInt(layerB?.relationDiscoveryRecentDays ?? 7, 1, 30),
      threshold: Math.max(
        1,
        Math.floor(layerB?.relationDiscoveryCoAccessThreshold ?? 2),
      ),
      maxPairs: 100,
    };
  }

  private computeRecentOrphanMetrics(userId: string): {
    readonly orphanRecent: number;
    readonly orphanRatio: number;
  } {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const total = (
      this.db!.prepare(
        `SELECT COUNT(*) AS count
         FROM memories
         WHERE user_id = ?
           AND learned_at >= ?
           AND invalidated_at IS NULL`,
      ).get(userId, cutoff) as { count: number }
    ).count;
    const orphanRecent = (
      this.db!.prepare(
        `SELECT COUNT(*) AS count
         FROM memories m
         WHERE m.user_id = ?
           AND m.learned_at >= ?
           AND m.invalidated_at IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM memory_relations r
             WHERE r.src_memory_id = m.memory_id
                OR r.dst_memory_id = m.memory_id
           )`,
      ).get(userId, cutoff) as { count: number }
    ).count;

    return {
      orphanRecent,
      orphanRatio: total === 0 ? 0 : orphanRecent / total,
    };
  }

  /**
   * Backfill episodes from existing memories.
   *
   * The v1.0 recall kernel pattern-completes against episodes, but
   * the write path (pre-auto-bind) stored memories without ever
   * materializing episodes. Users with large pre-existing memory
   * stores therefore see `recall` always hit `episodic_layer_empty`.
   *
   * This method groups is_latest=1 memories by a simple heuristic
   * (project + YYYY-MM-DD, or other `granularity` option) and:
   *   1. creates an Episode row per group,
   *   2. writes memory_episodic_bindings for each memory in the group,
   *   3. reinforces coarse cues (project, keyword tokens) against the
   *      episode's row in the episodic_index via the Hebbian path.
   *
   * It is explicitly a scaffold: episode_gist stays null, no segment
   * splits, no Layer B consolidation. Just enough structure that
   * `patternComplete` can return evidence.
   *
   * Safe to re-run. By default memories that already have a binding
   * are skipped, so repeated calls only materialize newly added
   * unbound memories.
   */
  async buildEpisodes(
    userId: string,
    options: BuildEpisodesOptions = {},
  ): Promise<BuildEpisodesResult> {
    this.ensureInitialized();
    const db = this.db!;

    const granularity = options.granularity ?? 'project-day';
    const skipAlreadyBound = options.skipAlreadyBound ?? true;
    const dryRun = options.dryRun ?? false;

    const epStmts = createEpisodeStatements(db);
    const hippoStmts = createHippocampalStatements(db);

    // 1. Scan user's live memories.
    const rows = db
      .prepare(
        `SELECT memory_id, project, learned_at, document_date, source_id,
                keywords, activity_type
           FROM memories
          WHERE user_id = ? AND is_latest = 1`,
      )
      .all(userId) as readonly {
      readonly memory_id: string;
      readonly project: string | null;
      readonly learned_at: string | null;
      readonly document_date: string | null;
      readonly source_id: string | null;
      readonly keywords: string | null;
      readonly activity_type: string | null;
    }[];

    let alreadyBound = 0;
    let skippedMissingDate = 0;

    // 2. Build groups.
    interface GroupRow {
      readonly memoryId: string;
      readonly project: string | null;
      readonly sourceId: string | null;
      readonly keywords: readonly string[];
      readonly activityType: string | null;
      readonly timestamp: string;
    }
    const groups = new Map<string, GroupRow[]>();

    const hasBinding = db.prepare(
      'SELECT 1 FROM memory_episodic_bindings WHERE memory_id = ? LIMIT 1',
    );

    for (const r of rows) {
      if (skipAlreadyBound) {
        const bound = hasBinding.get(r.memory_id);
        if (bound) {
          alreadyBound++;
          continue;
        }
      }
      // document_date ("when the event happened") takes precedence
      // over learned_at ("when this memory was stored") for grouping,
      // because backfill is trying to reconstruct when something
      // actually occurred, not when the DB row was inserted.
      const timestamp = r.document_date ?? r.learned_at;
      if (!timestamp) {
        skippedMissingDate++;
        continue;
      }
      const day = timestamp.slice(0, 10); // YYYY-MM-DD

      let key: string;
      if (granularity === 'day') {
        key = day;
      } else if (granularity === 'source') {
        key = r.source_id ?? `${r.project ?? 'unbound'}::${day}`;
      } else {
        key = `${r.project ?? 'unbound'}::${day}`;
      }

      const kwList = (r.keywords ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const bucket = groups.get(key) ?? [];
      bucket.push({
        memoryId: r.memory_id,
        project: r.project,
        sourceId: r.source_id,
        keywords: kwList,
        activityType: r.activity_type,
        timestamp,
      });
      groups.set(key, bucket);
    }

    if (dryRun) {
      // Dry run still reports what it would have done. We do not
      // simulate cue counts — they depend on enforceFamilyCap pruning
      // which is a runtime effect — but we give the operator enough
      // to judge the backfill's scope before committing.
      let dryCues = 0;
      for (const bucket of groups.values()) {
        // one 'project' cue per episode (if any) + unique keyword topics
        const projectCues = bucket[0].project ? 1 : 0;
        const topics = new Set<string>();
        for (const m of bucket)
          for (const k of m.keywords.slice(0, 6)) topics.add(k);
        dryCues += projectCues + topics.size;
      }
      return {
        scannedMemories: rows.length,
        alreadyBound,
        skippedMissingDate,
        episodesCreated: groups.size,
        memoriesBound: Array.from(groups.values()).reduce(
          (n, g) => n + g.length,
          0,
        ),
        cuesIndexed: dryCues,
        dryRun: true,
      };
    }

    // 3. Materialize. One transaction per group so a failure in one
    // group doesn't nuke the whole run.
    let episodesCreated = 0;
    let memoriesBound = 0;
    let cuesIndexed = 0;

    for (const [, bucket] of groups) {
      bucket.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const startedAt = bucket[0].timestamp;
      const endedAt = bucket[bucket.length - 1].timestamp;
      const project = bucket[0].project;

      const txn = db.transaction(() => {
        const episode = insertEpisode(epStmts, {
          userId,
          startedAt,
          boundaryReason: 'backfill',
        });
        if (endedAt !== startedAt) {
          epStmts.updateEpisodeEnd.run(endedAt, episode.episodeId);
        } else {
          epStmts.updateEpisodeEnd.run(endedAt, episode.episodeId);
        }
        episodesCreated++;

        for (let i = 0; i < bucket.length; i++) {
          bindMemoryToEpisode(epStmts, {
            memoryId: bucket[i].memoryId,
            episodeId: episode.episodeId,
          });
          memoriesBound++;
        }

        cuesIndexed += indexBackfillCues(
          db,
          hippoStmts,
          episode.episodeId,
          project,
          bucket,
        );
      });
      txn();
    }

    return {
      scannedMemories: rows.length,
      alreadyBound,
      skippedMissingDate,
      episodesCreated,
      memoriesBound,
      cuesIndexed,
      dryRun: false,
    };
  }

  async setTier(memoryId: string, tier: MemoryTier): Promise<void> {
    this.ensureInitialized();
    this.db!.prepare('UPDATE memories SET tier = ? WHERE memory_id = ?')
      .run(tier, memoryId);
  }

  async feedback(memoryId: string, helpful: boolean): Promise<void> {
    this.ensureInitialized();
    const db = this.db!;

    db.transaction(() => {
      // Increment use_count, and success_count if helpful
      if (helpful) {
        db.prepare(
          'UPDATE memories SET use_count = use_count + 1, success_count = success_count + 1 WHERE memory_id = ?',
        ).run(memoryId);
      } else {
        db.prepare(
          'UPDATE memories SET use_count = use_count + 1 WHERE memory_id = ?',
        ).run(memoryId);
      }

      // Recalculate salience based on success rate
      // If never used (use_count=0), keep original salience
      const row = db.prepare(
        'SELECT salience, use_count, success_count FROM memories WHERE memory_id = ?',
      ).get(memoryId) as { salience: number; use_count: number; success_count: number } | undefined;

      if (row && row.use_count > 0) {
        const successRate = row.success_count / row.use_count;
        // Blend: keep at least 50% of original salience, boost up to 100% based on success
        const newSalience = Math.min(1.0, Math.max(0.1, 0.5 + 0.5 * successRate));
        db.prepare('UPDATE memories SET salience = ? WHERE memory_id = ?').run(newSalience, memoryId);
      }
    })();
  }

  async quality(userId: string): Promise<MemoryQuality> {
    this.ensureInitialized();
    const db = this.db!;

    const total = (
      db.prepare('SELECT COUNT(*) as c FROM memories WHERE user_id = ?').get(userId) as { c: number }
    ).c;

    const fresh = (
      db.prepare(
        'SELECT COUNT(*) as c FROM memories WHERE user_id = ? AND is_latest = 1 AND invalidated_at IS NULL',
      ).get(userId) as { c: number }
    ).c;

    const invalidated = (
      db.prepare(
        'SELECT COUNT(*) as c FROM memories WHERE user_id = ? AND invalidated_at IS NOT NULL',
      ).get(userId) as { c: number }
    ).c;

    const superseded = (
      db.prepare(
        'SELECT COUNT(*) as c FROM memories WHERE user_id = ? AND is_latest = 0',
      ).get(userId) as { c: number }
    ).c;

    const withRelations = (
      db.prepare(`
        SELECT COUNT(DISTINCT mid) as c FROM (
          SELECT src_memory_id as mid FROM memory_relations
            WHERE src_memory_id IN (SELECT memory_id FROM memories WHERE user_id = ?)
          UNION
          SELECT dst_memory_id as mid FROM memory_relations
            WHERE dst_memory_id IN (SELECT memory_id FROM memories WHERE user_id = ?)
        )
      `).get(userId, userId) as { c: number }
    ).c;

    const avgRow = db.prepare(
      'SELECT AVG(activation_score) as avg FROM memories WHERE user_id = ? AND is_latest = 1',
    ).get(userId) as { avg: number | null };

    const avgActivation = avgRow.avg ?? 0;

    return {
      total,
      fresh,
      invalidated,
      superseded,
      withRelations,
      avgActivation,
    };
  }

  /**
   * Check for near-duplicate memories after storing.
   *
   * Post HF-removal (v0.11): content-exact match only. The previous
   * cosine-similarity path required an embedder, which MemRosetta no
   * longer ships. Exact-content duplicates still get caught by the
   * `memrosetta dedupe` command (lexical).
   */
  private async checkDuplicates(newMemory: Memory): Promise<void> {
    try {
      const row = this.db!
        .prepare(
          `SELECT memory_id FROM memories
           WHERE user_id = ? AND memory_id != ? AND content = ?
             AND is_latest = 1 AND invalidated_at IS NULL
           LIMIT 1`,
        )
        .get(newMemory.userId, newMemory.memoryId, newMemory.content) as
        | { memory_id: string }
        | undefined;
      if (!row) return;
      try {
        await this.relate(
          newMemory.memoryId,
          row.memory_id,
          'updates',
          'Auto-detected exact-content duplicate',
        );
      } catch {
        // Relation may already exist
      }
    } catch {
      // Duplicate check failure should not block storage
    }
  }

  /**
   * Auto-create 'extends' relations when a new memory shares keywords
   * with existing memories. Builds graph density for future graph-based retrieval.
   *
   * Only runs for individual store() calls, not storeBatch().
   * Requires at least 2 overlapping keywords to create a relation.
   * Graceful: errors are silently swallowed.
   */
  private async autoRelate(newMemory: Memory): Promise<void> {
    if (!newMemory.keywords || newMemory.keywords.length === 0) return;

    try {
      const keywordList = newMemory.keywords.map((keyword) => keyword.toLowerCase());
      const inferredAutoRelation = inferDeterministicRelation(newMemory.content);

      const existing = newMemory.namespace
        ? this.db!.prepare(`
          SELECT memory_id, keywords FROM memories
          WHERE user_id = ? AND namespace = ? AND is_latest = 1 AND memory_id != ?
          AND invalidated_at IS NULL
          ORDER BY learned_at DESC LIMIT 50
        `).all(newMemory.userId, newMemory.namespace, newMemory.memoryId) as readonly AutoRelateCandidateRow[]
        : this.db!.prepare(`
          SELECT memory_id, keywords FROM memories
          WHERE user_id = ? AND is_latest = 1 AND memory_id != ?
          AND invalidated_at IS NULL
          ORDER BY learned_at DESC LIMIT 50
        `).all(newMemory.userId, newMemory.memoryId) as readonly AutoRelateCandidateRow[];

      for (const row of existing) {
        const existingKeywords = row.keywords
          ? row.keywords.split(' ').map((keyword) => keyword.trim().toLowerCase()).filter(Boolean)
          : [];
        const overlap = keywordList.filter((keyword) => existingKeywords.includes(keyword));

        if (overlap.length >= 2) {
          // Check if any relation already exists between these memories
          // (e.g., from checkDuplicates creating an 'updates' relation)
          const existingRelation = this.db!.prepare(
            `SELECT 1 FROM memory_relations
             WHERE (src_memory_id = ? AND dst_memory_id = ?)
                OR (src_memory_id = ? AND dst_memory_id = ?)
             LIMIT 1`,
          ).get(
            newMemory.memoryId, row.memory_id,
            row.memory_id, newMemory.memoryId,
          );

          if (existingRelation) continue;

          try {
            const relationType = inferredAutoRelation?.relationType ?? 'extends';
            const reason = inferredAutoRelation
              ? `${inferredAutoRelation.reason}; ${overlap.length} shared keywords (${overlap.join(', ')})`
              : `Auto: ${overlap.length} shared keywords (${overlap.join(', ')})`;
            await this.relate(
              newMemory.memoryId,
              row.memory_id,
              relationType,
              reason,
            );
          } catch {
            // Relation may already exist
          }
        }
      }
    } catch {
      // Auto-relate failure should not block storage
    }
  }

  private ensureInitialized(): void {
    if (!this.db || !this.stmts || !this.relStmts) {
      throw new Error('Engine not initialized. Call initialize() first.');
    }
  }
}

// Factory function for convenience
export function createEngine(
  options: SqliteEngineOptions,
): SqliteMemoryEngine {
  return new SqliteMemoryEngine(options);
}

/**
 * Write a minimal cue bundle for a backfilled episode:
 *   - 1 `project` cue (if available)
 *   - up to 6 `topic` cues per episode drawn from member keywords
 *   - 1 `activity` cue if any member has activity_type
 *
 * Cues are strength 1.0 for the project (the coarsest anchor) and
 * 0.5 for topics so the recall kernel still ranks explicit project
 * anchors higher than opportunistic keyword hits. The Hebbian path
 * itself will rebalance on real recall usage.
 *
 * Returns the number of cue rows written so the caller can report it.
 */
function indexBackfillCues(
  _db: import('better-sqlite3').Database,
  hippo: HippocampalStatements,
  episodeId: string,
  project: string | null,
  bucket: readonly {
    readonly keywords: readonly string[];
    readonly activityType: string | null;
  }[],
): number {
  let count = 0;
  if (project) {
    reinforceEpisodicCue(_db, hippo, {
      episodeId,
      feature: {
        featureType: 'project' as FeatureFamily,
        featureValue: project,
      },
      activation: 1.0,
    });
    count++;
  }

  const topicCap = 6;
  const topics = new Set<string>();
  for (const m of bucket) {
    for (const k of m.keywords) {
      if (topics.size >= topicCap) break;
      topics.add(k);
    }
    if (topics.size >= topicCap) break;
  }
  for (const t of topics) {
    reinforceEpisodicCue(_db, hippo, {
      episodeId,
      feature: { featureType: 'topic' as FeatureFamily, featureValue: t },
      activation: 0.5,
    });
    count++;
  }

  const activityTypes = new Set<string>();
  for (const m of bucket) {
    if (m.activityType) activityTypes.add(m.activityType);
  }
  for (const a of activityTypes) {
    reinforceEpisodicCue(_db, hippo, {
      episodeId,
      feature: {
        featureType: 'taskMode' as FeatureFamily,
        featureValue: a,
      },
      activation: 0.7,
    });
    count++;
  }

  return count;
}

function clampInt(value: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(max, n));
}
