import type Database from 'better-sqlite3';
import type { Memory, MemoryInput } from '@memrosetta/types';
import type { Embedder } from '@memrosetta/embeddings';
import { generateMemoryId, nowIso, keywordsToString } from './utils.js';
import { rowToMemory, serializeEmbedding, type MemoryRow } from './mapper.js';

export interface PreparedStatements {
  readonly insertMemory: Database.Statement;
  readonly getById: Database.Statement;
  readonly getByMemoryId: Database.Statement;
  readonly countByUser: Database.Statement;
}

export function createPreparedStatements(db: Database.Database): PreparedStatements {
  return {
    insertMemory: db.prepare(`
      INSERT INTO memories (memory_id, user_id, namespace, memory_type, content, raw_text, document_date, learned_at, source_id, confidence, salience, is_latest, embedding, keywords, event_date_start, event_date_end, invalidated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getById: db.prepare('SELECT * FROM memories WHERE id = ?'),
    getByMemoryId: db.prepare('SELECT * FROM memories WHERE memory_id = ?'),
    countByUser: db.prepare('SELECT COUNT(*) as count FROM memories WHERE user_id = ?'),
  };
}

/**
 * Store a single memory (sync, no embedding).
 * Backward-compatible with Phase 1 usage.
 */
export function storeMemory(
  db: Database.Database,
  stmts: PreparedStatements,
  input: MemoryInput,
): Memory {
  const memoryId = generateMemoryId();
  const learnedAt = nowIso();
  const keywords = keywordsToString(input.keywords);

  stmts.insertMemory.run(
    memoryId,
    input.userId,
    input.namespace ?? null,
    input.memoryType,
    input.content,
    input.rawText ?? null,
    input.documentDate ?? null,
    learnedAt,
    input.sourceId ?? null,
    input.confidence ?? 1.0,
    input.salience ?? 1.0,
    1, // is_latest
    null, // embedding
    keywords,
    input.eventDateStart ?? null,
    input.eventDateEnd ?? null,
    input.invalidatedAt ?? null,
  );

  // Read back the stored row to get the canonical representation
  const row = stmts.getByMemoryId.get(memoryId) as MemoryRow;
  return rowToMemory(row);
}

/**
 * Store a single memory with optional embedding computation.
 * When an embedder is provided, the embedding is computed and stored
 * both in the memories table (BLOB) and vec_memories table (for KNN search).
 */
export async function storeMemoryAsync(
  db: Database.Database,
  stmts: PreparedStatements,
  input: MemoryInput,
  embedder?: Embedder,
): Promise<Memory> {
  const memoryId = generateMemoryId();
  const learnedAt = nowIso();
  const keywords = keywordsToString(input.keywords);

  // Compute embedding if embedder available
  let embeddingBlob: Buffer | null = null;
  let embeddingVec: Float32Array | null = null;
  if (embedder) {
    embeddingVec = await embedder.embed(input.content);
    embeddingBlob = serializeEmbedding(embeddingVec);
  }

  const info = stmts.insertMemory.run(
    memoryId,
    input.userId,
    input.namespace ?? null,
    input.memoryType,
    input.content,
    input.rawText ?? null,
    input.documentDate ?? null,
    learnedAt,
    input.sourceId ?? null,
    input.confidence ?? 1.0,
    input.salience ?? 1.0,
    1, // is_latest
    embeddingBlob,
    keywords,
    input.eventDateStart ?? null,
    input.eventDateEnd ?? null,
    input.invalidatedAt ?? null,
  );

  // Insert into vec_memories if embedding was computed
  if (embeddingVec && info.lastInsertRowid) {
    const rowid = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO vec_memories(rowid, embedding) VALUES (CAST(? AS INTEGER), ?)').run(
      rowid,
      Buffer.from(embeddingVec.buffer, embeddingVec.byteOffset, embeddingVec.byteLength),
    );
  }

  const row = stmts.getByMemoryId.get(memoryId) as MemoryRow;
  return rowToMemory(row);
}

export function storeBatchInTransaction(
  db: Database.Database,
  stmts: PreparedStatements,
  inputs: readonly MemoryInput[],
): readonly Memory[] {
  const results: Memory[] = [];

  const transaction = db.transaction((items: readonly MemoryInput[]) => {
    for (const input of items) {
      results.push(storeMemory(db, stmts, input));
    }
  });

  transaction(inputs);
  return results;
}

/**
 * Store a batch of memories with optional embedding computation.
 * Embeddings are computed asynchronously first, then all inserts
 * happen in a single synchronous transaction for atomicity.
 */
export async function storeBatchAsync(
  db: Database.Database,
  stmts: PreparedStatements,
  inputs: readonly MemoryInput[],
  embedder?: Embedder,
): Promise<readonly Memory[]> {
  if (!embedder) {
    return storeBatchInTransaction(db, stmts, inputs);
  }

  // Pre-compute all embeddings (async)
  const embeddings: Float32Array[] = [];
  for (const input of inputs) {
    embeddings.push(await embedder.embed(input.content));
  }

  // Insert everything in a transaction (sync)
  const results: Memory[] = [];

  const transaction = db.transaction(() => {
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const vec = embeddings[i];
      const memoryId = generateMemoryId();
      const learnedAt = nowIso();
      const keywords = keywordsToString(input.keywords);
      const embeddingBlob = serializeEmbedding(vec);

      const info = stmts.insertMemory.run(
        memoryId,
        input.userId,
        input.namespace ?? null,
        input.memoryType,
        input.content,
        input.rawText ?? null,
        input.documentDate ?? null,
        learnedAt,
        input.sourceId ?? null,
        input.confidence ?? 1.0,
        input.salience ?? 1.0,
        1, // is_latest
        embeddingBlob,
        keywords,
        input.eventDateStart ?? null,
        input.eventDateEnd ?? null,
        input.invalidatedAt ?? null,
      );

      if (info.lastInsertRowid) {
        db.prepare('INSERT INTO vec_memories(rowid, embedding) VALUES (CAST(? AS INTEGER), ?)').run(
          Number(info.lastInsertRowid),
          Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength),
        );
      }

      const row = stmts.getByMemoryId.get(memoryId) as MemoryRow;
      results.push(rowToMemory(row));
    }
  });

  transaction();
  return results;
}
