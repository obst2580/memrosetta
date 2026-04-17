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
} from '@memrosetta/types';
import type { Embedder, ContradictionDetector } from '@memrosetta/embeddings';
import { ensureSchema } from './schema.js';
import {
  createPreparedStatements,
  storeMemory,
  storeBatchInTransaction,
  storeMemoryAsync,
  storeBatchAsync,
  type PreparedStatements,
} from './store.js';
import { searchMemories, bruteForceVectorSearch } from './search.js';
import { recordCoAccess } from './coaccess.js';
import {
  createRelationStatements,
  createRelation,
  getRelationsByMemory,
  type RelationStatements,
} from './relations.js';
import { rowToMemory, type MemoryRow } from './mapper.js';
import { generateMemoryId, nowIso, keywordsToString } from './utils.js';
import { computeActivation, computeEbbinghaus } from './activation.js';
import { determineTier, estimateTokens } from './tiers.js';
import { computeNoveltyScore } from './novelty.js';
import { ConsolidationQueue } from './consolidation.js';
import {
  reconstructRecall as reconstructRecallInternal,
  RecallHookRegistry,
} from './recall.js';
import {
  createConstructStatements,
  recordConstructReuse,
  type ConstructStatements,
} from './constructs.js';


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
}

export interface SqliteEngineOptions {
  readonly dbPath: string; // ':memory:' for in-memory, or file path
  readonly embedder?: Embedder;  // Optional: enables vector search
  readonly contradictionDetector?: ContradictionDetector;  // Optional: enables NLI-based contradiction detection
  readonly contradictionThreshold?: number;  // Default: 0.7. Min NLI score to auto-create contradicts relation.
  /** Layer B runtime flags (default all OFF). */
  readonly layerB?: LayerBConfig;
}

interface AutoRelateCandidateRow {
  readonly memory_id: string;
  readonly keywords: string | null;
  readonly embedding: Buffer | null;
}

export class SqliteMemoryEngine implements IMemoryEngine {
  private db: Database.Database | null = null;
  private stmts: PreparedStatements | null = null;
  private relStmts: RelationStatements | null = null;
  private constructStmts: ConstructStatements | null = null;
  private readonly options: SqliteEngineOptions;
  private vectorEnabled = false;
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

    // Load sqlite-vec extension if embedder is provided
    if (this.options.embedder) {
      try {
        const sqliteVec = await import('sqlite-vec');
        sqliteVec.load(this.db);
        this.vectorEnabled = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[memrosetta] sqlite-vec not available, falling back to JS cosine similarity: ${message}\n`,
        );
        this.vectorEnabled = false;
      }
    }

    ensureSchema(this.db, {
      vectorEnabled: this.vectorEnabled,
      embeddingDimension: this.options.embedder?.dimension ?? 384,
    });

    this.stmts = createPreparedStatements(this.db);
    this.relStmts = createRelationStatements(this.db);
    this.constructStmts = createConstructStatements(this.db);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.stmts = null;
      this.relStmts = null;
    }
  }

  async store(input: MemoryInput): Promise<Memory> {
    this.ensureInitialized();

    let memory: Memory;
    if (this.options.embedder) {
      memory = await storeMemoryAsync(this.db!, this.stmts!, input, this.options.embedder);
    } else {
      memory = storeMemory(this.db!, this.stmts!, input);
    }

    // Check for contradictions if detector is available
    if (this.options.contradictionDetector && this.options.embedder) {
      await this.checkContradictions(memory);
    }

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
        kind: 'gist_refinement',
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
    let memories: readonly Memory[];
    if (this.options.embedder) {
      memories = await storeBatchAsync(this.db!, this.stmts!, inputs, this.options.embedder);
    } else {
      memories = storeBatchInTransaction(this.db!, this.stmts!, inputs);
    }

    // Run post-store checks for small batches (<=50)
    if (memories.length <= 50) {
      for (const memory of memories) {
        // Contradiction detection (requires embedder + detector)
        if (this.options.embedder && this.options.contradictionDetector) {
          try {
            await this.checkContradictions(memory);
          } catch {
            // Failure should not block storage
          }
        }

        // Duplicate detection (requires embedder)
        if (this.options.embedder) {
          try {
            await this.checkDuplicates(memory);
          } catch {
            // Failure should not block storage
          }
        }

        // Auto-relate by shared keywords (no embedder needed)
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
    let queryVec: Float32Array | undefined;
    if (this.options.embedder) {
      queryVec = await this.options.embedder.embed(query.query);
    }
    const response = searchMemories(this.db!, query, queryVec, this.vectorEnabled);

    // Hebbian co-access: record that these memories were retrieved
    // together so future searches can boost co-accessed neighbors.
    // Only top results (up to 10) to avoid flooding the table.
    if (response.results.length >= 2) {
      const topIds = response.results.slice(0, 10).map((r) => r.memory.memoryId);
      recordCoAccess(this.db!, topIds);
    }

    return response;
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

      // 2. Delete from vec_memories if vector table exists
      if (this.vectorEnabled) {
        try {
          db.prepare(`
            DELETE FROM vec_memories WHERE rowid IN (
              SELECT id FROM memories WHERE user_id = ?
            )
          `).run(uid);
        } catch {
          // vec_memories may not exist, ignore
        }
      }

      // 3. Delete memories (FTS sync triggers handle FTS cleanup)
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

      if (this.vectorEnabled) {
        try {
          db.prepare(`
            DELETE FROM vec_memories WHERE rowid IN (
              SELECT id FROM memories WHERE user_id = ? AND namespace = ?
            )
          `).run(uid, ns);
        } catch {
          // vec_memories may not exist
        }
      }

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
          null, // embedding
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
   * Check the newly stored memory against existing similar memories
   * for contradictions using the NLI model.
   *
   * If a contradiction is found above the configured threshold,
   * a 'contradicts' relation is automatically created.
   *
   * Graceful degradation: any error during NLI check is silently
   * swallowed so that memory storage is never blocked.
   */
  private async checkContradictions(newMemory: Memory): Promise<void> {
    const detector = this.options.contradictionDetector;
    if (!detector || !this.options.embedder) return;

    const threshold = this.options.contradictionThreshold ?? 0.7;

    try {
      // Compute query vector from the new memory's content
      const queryVec = await this.options.embedder.embed(newMemory.content);

      // Search for similar existing memories (top 5, same user, only latest)
      // skipAccessTracking=true: internal check should not inflate access counts
      const similar = searchMemories(
        this.db!,
        {
          userId: newMemory.userId,
          query: newMemory.content,
          limit: 5,
          filters: { onlyLatest: true },
        },
        queryVec,
        this.vectorEnabled,
        true, // skipAccessTracking
      );

      for (const result of similar.results) {
        // Skip self
        if (result.memory.memoryId === newMemory.memoryId) continue;

        try {
          const nliResult = await detector.detect(
            result.memory.content,
            newMemory.content,
          );

          if (
            nliResult.label === 'contradiction' &&
            nliResult.score >= threshold
          ) {
            await this.relate(
              newMemory.memoryId,
              result.memory.memoryId,
              'contradicts',
              `NLI confidence: ${nliResult.score.toFixed(3)}`,
            );
          }
        } catch {
          // NLI check failed for this pair, continue with next
        }
      }
    } catch {
      // Entire contradiction check failed, memory is still stored
    }
  }

  /**
   * Check for near-duplicate memories after storing.
   * Uses direct cosine similarity (not the combined search score) to avoid
   * false positives from the multi-factor reranking.
   * If cosine similarity > 0.95, auto-create an 'updates' relation (new supersedes old).
   * Only runs for single store() calls, not storeBatch() (too slow for bulk).
   */
  private async checkDuplicates(newMemory: Memory): Promise<void> {
    if (!this.options.embedder) return;

    try {
      const queryVec = await this.options.embedder.embed(newMemory.content);

      // Use raw vector search (not reranked searchMemories) to find candidates
      // by pure cosine similarity, avoiding recency/salience bias
      const candidates = bruteForceVectorSearch(
        this.db!,
        queryVec,
        newMemory.userId,
        10,
        { onlyLatest: true },
      );

      for (const candidate of candidates) {
        if (candidate.memory.memoryId === newMemory.memoryId) continue;

        // distance is 1 - cosine_similarity for brute force
        const similarity = 1 - candidate.distance;

        if (similarity > 0.95) {
          // Very high cosine similarity: likely an update
          try {
            await this.relate(
              newMemory.memoryId,
              candidate.memory.memoryId,
              'updates',
              `Auto-detected duplicate: cosine similarity ${similarity.toFixed(3)}`,
            );
          } catch {
            // Relation may already exist, ignore
          }
        }
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
    if ((!newMemory.keywords || newMemory.keywords.length === 0) && !newMemory.embedding) return;

    try {
      const keywordList = (newMemory.keywords ?? []).map((keyword) => keyword.toLowerCase());
      const newEmbedding = newMemory.embedding ? new Float32Array(newMemory.embedding) : null;

      const existing = newMemory.namespace
        ? this.db!.prepare(`
          SELECT memory_id, keywords, embedding FROM memories
          WHERE user_id = ? AND namespace = ? AND is_latest = 1 AND memory_id != ?
          AND invalidated_at IS NULL
          ORDER BY learned_at DESC LIMIT 50
        `).all(newMemory.userId, newMemory.namespace, newMemory.memoryId) as readonly AutoRelateCandidateRow[]
        : this.db!.prepare(`
          SELECT memory_id, keywords, embedding FROM memories
          WHERE user_id = ? AND is_latest = 1 AND memory_id != ?
          AND invalidated_at IS NULL
          ORDER BY learned_at DESC LIMIT 50
        `).all(newMemory.userId, newMemory.memoryId) as readonly AutoRelateCandidateRow[];

      for (const row of existing) {
        const existingKeywords = row.keywords
          ? row.keywords.split(' ').map((keyword) => keyword.trim().toLowerCase()).filter(Boolean)
          : [];
        const overlap = keywordList.filter((keyword) => existingKeywords.includes(keyword));
        const similarity = newEmbedding && row.embedding
          ? cosineSimilarity(
            newEmbedding,
            new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4),
          )
          : 0;

        if (overlap.length >= 2 || similarity > 0.7) {
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
            await this.relate(
              newMemory.memoryId,
              row.memory_id,
              'extends',
              overlap.length >= 2
                ? `Auto: ${overlap.length} shared keywords (${overlap.join(', ')})`
                : `Auto: cosine similarity ${similarity.toFixed(3)}`,
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

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Factory function for convenience
export function createEngine(
  options: SqliteEngineOptions,
): SqliteMemoryEngine {
  return new SqliteMemoryEngine(options);
}
