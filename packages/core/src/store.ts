import type Database from 'better-sqlite3';
import type { Memory, MemoryInput } from '@memrosetta/types';
import type { Embedder } from '@memrosetta/embeddings';
import { generateMemoryId, nowIso, keywordsToString } from './utils.js';
import { rowToMemory, serializeEmbedding, type MemoryRow } from './mapper.js';
import {
  createSourceStatements,
  insertSourceAttestations,
  type SourceStatements,
} from './source.js';
import {
  bindMemoryToEpisode,
  createEpisodeStatements,
  type EpisodeStatements,
} from './episodes.js';
import {
  createGoalStatements,
  linkMemoryToGoal,
  type GoalStatements,
} from './goals.js';
import { createGistStatements, type GistStatements } from './gists.js';
import {
  createMemoryAliasStatements,
  resolveMemoryAxes,
  type MemoryAliasStatements,
} from './types.js';
import {
  createHippocampalStatements,
  reinforceEpisodicCue,
  type HippocampalStatements,
} from './hippocampal.js';

export interface PreparedStatements {
  readonly insertMemory: Database.Statement;
  readonly getById: Database.Statement;
  readonly getByMemoryId: Database.Statement;
  readonly countByUser: Database.Statement;
  readonly source: SourceStatements;
  readonly episode: EpisodeStatements;
  readonly goal: GoalStatements;
  readonly gist: GistStatements;
  readonly alias: MemoryAliasStatements;
  readonly hippocampal: HippocampalStatements;
}

export function createPreparedStatements(db: Database.Database): PreparedStatements {
  return {
    // Insert includes Step 4 dual-representation columns (verbatim +
    // gist metadata) and Step 5 Tulving 2-axis columns (memory_system
    // + memory_role). Axes default from the legacy memory_type mapping
    // when the caller does not supply them.
    insertMemory: db.prepare(`
      INSERT INTO memories (
        memory_id, user_id, namespace, memory_type, content, raw_text,
        document_date, learned_at, source_id, confidence, salience,
        is_latest, embedding, keywords, event_date_start, event_date_end,
        invalidated_at, tier, activation_score, access_count,
        last_accessed_at, compressed_from, use_count, success_count,
        project, activity_type,
        verbatim_content, gist_content, gist_confidence,
        gist_extracted_at, gist_extracted_model,
        memory_system, memory_role
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getById: db.prepare('SELECT * FROM memories WHERE id = ?'),
    getByMemoryId: db.prepare('SELECT * FROM memories WHERE memory_id = ?'),
    countByUser: db.prepare('SELECT COUNT(*) as count FROM memories WHERE user_id = ?'),
    source: createSourceStatements(db),
    episode: createEpisodeStatements(db),
    goal: createGoalStatements(db),
    gist: createGistStatements(db),
    alias: createMemoryAliasStatements(db),
    hippocampal: createHippocampalStatements(db),
  };
}

/**
 * Codex Step 6 review must-fix: register memory cues into the
 * hippocampal index at store time. Without this, Step 7 pattern
 * completion has nothing to match against except manually-registered
 * cues. Requires an episodeId; cues without an episode anchor are
 * silently dropped because the index is episode-scoped.
 */
function maybeRegisterCues(
  db: Database.Database,
  stmts: PreparedStatements,
  input: MemoryInput,
): void {
  if (!input.episodeId || !input.cues || input.cues.length === 0) return;
  for (const cue of input.cues) {
    reinforceEpisodicCue(db, stmts.hippocampal, {
      episodeId: input.episodeId,
      feature: {
        featureType: cue.featureType,
        featureValue: cue.featureValue,
        polarity: cue.polarity,
      },
      activation: cue.activation ?? 0.7,
    });
  }
}

function maybeBindEpisode(
  stmts: PreparedStatements,
  memoryId: string,
  input: MemoryInput,
): void {
  if (!input.episodeId) return;
  bindMemoryToEpisode(stmts.episode, {
    memoryId,
    episodeId: input.episodeId,
    segmentId: input.segmentId,
    segmentPosition: input.segmentPosition,
    bindingStrength: input.bindingStrength,
  });
}

function maybeLinkGoal(
  stmts: PreparedStatements,
  memoryId: string,
  input: MemoryInput,
): void {
  if (!input.goalId) return;
  linkMemoryToGoal(stmts.goal, {
    goalId: input.goalId,
    memoryId,
    linkRole: input.goalLinkRole,
    linkWeight: input.goalLinkWeight,
  });
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

  const axes = resolveMemoryAxes(input);

  // Atomic: memory row, source attestations, and episodic binding must
  // persist together so the audit trail cannot diverge if the process
  // is interrupted between the inserts.
  const writeTxn = db.transaction(() => {
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
      'warm', // tier
      1.0, // activation_score
      0, // access_count
      null, // last_accessed_at
      null, // compressed_from
      0, // use_count
      0, // success_count
      input.project ?? null,
      input.activityType ?? null,
      input.verbatim ?? input.content, // verbatim_content defaults to content
      input.gist ?? null,
      input.gistConfidence ?? null,
      input.gist ? learnedAt : null, // gist_extracted_at
      input.gistExtractedModel ?? null,
      axes.memorySystem,
      axes.memoryRole,
    );

    insertSourceAttestations(stmts.source, memoryId, input.sources);
    maybeBindEpisode(stmts, memoryId, input);
    maybeLinkGoal(stmts, memoryId, input);
    maybeRegisterCues(db, stmts, input);
  });
  writeTxn();

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
  const axesAsync = resolveMemoryAxes(input);

  // Compute embedding if embedder available
  let embeddingBlob: Buffer | null = null;
  let embeddingVec: Float32Array | null = null;
  if (embedder) {
    embeddingVec = await embedder.embed(input.content);
    embeddingBlob = serializeEmbedding(embeddingVec);
  }

  // Atomic: memory row + vec index + attestations share one transaction.
  const writeTxn = db.transaction(() => {
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
      'warm', // tier
      1.0, // activation_score
      0, // access_count
      null, // last_accessed_at
      null, // compressed_from
      0, // use_count
      0, // success_count
      input.project ?? null,
      input.activityType ?? null,
      input.verbatim ?? input.content,
      input.gist ?? null,
      input.gistConfidence ?? null,
      input.gist ? learnedAt : null,
      input.gistExtractedModel ?? null,
      axesAsync.memorySystem,
      axesAsync.memoryRole,
    );

    if (embeddingVec && info.lastInsertRowid) {
      const rowid = Number(info.lastInsertRowid);
      db.prepare('INSERT INTO vec_memories(rowid, embedding) VALUES (CAST(? AS INTEGER), ?)').run(
        rowid,
        Buffer.from(embeddingVec.buffer, embeddingVec.byteOffset, embeddingVec.byteLength),
      );
    }

    insertSourceAttestations(stmts.source, memoryId, input.sources);
    maybeBindEpisode(stmts, memoryId, input);
    maybeLinkGoal(stmts, memoryId, input);
    maybeRegisterCues(db, stmts, input);
  });
  writeTxn();

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
      const axes = resolveMemoryAxes(input);

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
        'warm', // tier
        1.0, // activation_score
        0, // access_count
        null, // last_accessed_at
        null, // compressed_from
        0, // use_count
        0, // success_count
        input.project ?? null,
        input.activityType ?? null,
        input.verbatim ?? input.content,
        input.gist ?? null,
        input.gistConfidence ?? null,
        input.gist ? learnedAt : null,
        input.gistExtractedModel ?? null,
        axes.memorySystem,
        axes.memoryRole,
      );

      if (info.lastInsertRowid) {
        db.prepare('INSERT INTO vec_memories(rowid, embedding) VALUES (CAST(? AS INTEGER), ?)').run(
          Number(info.lastInsertRowid),
          Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength),
        );
      }

      insertSourceAttestations(stmts.source, memoryId, input.sources);
      maybeBindEpisode(stmts, memoryId, input);
      maybeLinkGoal(stmts, memoryId, input);
      maybeRegisterCues(db, stmts, input);

      const row = stmts.getByMemoryId.get(memoryId) as MemoryRow;
      results.push(rowToMemory(row));
    }
  });

  transaction();
  return results;
}
