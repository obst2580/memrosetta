import Database from 'better-sqlite3';
import type {
  IMemoryEngine,
  Memory,
  MemoryInput,
  SearchQuery,
  SearchResponse,
  MemoryRelation,
  RelationType,
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
import { searchMemories } from './search.js';
import {
  createRelationStatements,
  createRelation,
  getRelationsByMemory,
  type RelationStatements,
} from './relations.js';
import { rowToMemory, type MemoryRow } from './mapper.js';

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

    ensureSchema(this.db, { vectorEnabled: this.vectorEnabled });

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

    return memory;
  }

  async storeBatch(
    inputs: readonly MemoryInput[],
  ): Promise<readonly Memory[]> {
    this.ensureInitialized();
    if (this.options.embedder) {
      return storeBatchAsync(this.db!, this.stmts!, inputs, this.options.embedder);
    }
    return storeBatchInTransaction(this.db!, this.stmts!, inputs);
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
