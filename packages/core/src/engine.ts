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


export interface SqliteEngineOptions {
  readonly dbPath: string; // ':memory:' for in-memory, or file path
  readonly embedder?: Embedder;  // Optional: enables vector search
  readonly contradictionDetector?: ContradictionDetector;  // Optional: enables NLI-based contradiction detection
  readonly contradictionThreshold?: number;  // Default: 0.7. Min NLI score to auto-create contradicts relation.
}

export class SqliteMemoryEngine implements IMemoryEngine {
  private db: Database.Database | null = null;
  private stmts: PreparedStatements | null = null;
  private relStmts: RelationStatements | null = null;
  private readonly options: SqliteEngineOptions;
  private vectorEnabled = false;

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

    return memory;
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

    // Run contradiction check on each memory if detector is available
    // Only for small batches (<=50) to avoid excessive slowdown
    if (this.options.contradictionDetector && this.options.embedder && memories.length <= 50) {
      for (const memory of memories) {
        try {
          await this.checkContradictions(memory);
        } catch {
          // Contradiction check failure should not block storage
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
    return searchMemories(this.db!, query, queryVec, this.vectorEnabled);
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

    // Find cold memories with very low activation
    const coldMemories = db.prepare(`
      SELECT * FROM memories
      WHERE user_id = ? AND tier = 'cold' AND activation_score < 0.1 AND is_latest = 1
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
    if (!newMemory.keywords || newMemory.keywords.length === 0) return;

    try {
      const keywordList = newMemory.keywords;

      const existing = this.db!.prepare(`
        SELECT memory_id, keywords FROM memories
        WHERE user_id = ? AND is_latest = 1 AND memory_id != ?
        AND invalidated_at IS NULL
        ORDER BY learned_at DESC LIMIT 10
      `).all(newMemory.userId, newMemory.memoryId) as readonly {
        memory_id: string;
        keywords: string | null;
      }[];

      for (const row of existing) {
        if (!row.keywords) continue;
        const existingKeywords = row.keywords.split(' ').map(k => k.trim().toLowerCase());
        const overlap = keywordList.filter(k => existingKeywords.includes(k.toLowerCase()));

        if (overlap.length >= 3) {
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
              `Auto: ${overlap.length} shared keywords (${overlap.join(', ')})`,
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
