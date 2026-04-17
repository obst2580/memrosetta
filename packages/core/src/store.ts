import type Database from 'better-sqlite3';
import type { Memory, MemoryInput } from '@memrosetta/types';
import { generateMemoryId, nowIso, keywordsToString } from './utils.js';
import { rowToMemory, type MemoryRow } from './mapper.js';
import {
  createSourceStatements,
  insertSourceAttestations,
  type SourceStatements,
} from './source.js';
import {
  bindMemoryToEpisode,
  createEpisodeStatements,
  getOpenEpisodeForUser,
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
    // + memory_role). v0.11 dropped the embedding BLOB column and
    // the sqlite-vec / HF embedder paths along with it.
    insertMemory: db.prepare(`
      INSERT INTO memories (
        memory_id, user_id, namespace, memory_type, content, raw_text,
        document_date, learned_at, source_id, confidence, salience,
        is_latest, keywords, event_date_start, event_date_end,
        invalidated_at, tier, activation_score, access_count,
        last_accessed_at, compressed_from, use_count, success_count,
        project, activity_type,
        verbatim_content, gist_content, gist_confidence,
        gist_extracted_at, gist_extracted_model,
        memory_system, memory_role
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
 * Resolve which episode this memory should bind to at store time.
 *
 * Priority:
 *   1. Explicit `input.episodeId` — caller knows exactly where this
 *      memory belongs.
 *   2. Open episode for the user — a session-level anchor set up by
 *      an earlier call to `openEpisode()`. This is the Layer A
 *      Event-Segmentation write-side integration: without it, a
 *      producer that calls `store()` in a long-running session
 *      creates orphan memories that `recall` can never find.
 *   3. `undefined` — no binding, memory is orphan (pre-v0.12 default).
 *
 * Opt-out: `input.autoBindEpisode === false` disables the open-episode
 * fallback while still honoring an explicit `episodeId`. This is for
 * ingestion paths (e.g. bulk backfill) that manage episodes externally.
 */
function resolveEpisodeTarget(
  stmts: PreparedStatements,
  input: MemoryInput,
): string | undefined {
  if (input.episodeId) return input.episodeId;
  if (input.autoBindEpisode === false) return undefined;
  const open = getOpenEpisodeForUser(stmts.episode, input.userId);
  return open?.episodeId;
}

function maybeRegisterCues(
  db: Database.Database,
  stmts: PreparedStatements,
  input: MemoryInput,
  episodeId: string | undefined,
): void {
  if (!episodeId || !input.cues || input.cues.length === 0) return;
  for (const cue of input.cues) {
    reinforceEpisodicCue(db, stmts.hippocampal, {
      episodeId,
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
  episodeId: string | undefined,
): void {
  if (!episodeId) return;
  bindMemoryToEpisode(stmts.episode, {
    memoryId,
    episodeId,
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
 *
 * v0.11: HF embedder and sqlite-vec paths were removed. There is no
 * longer a storeMemoryAsync variant — store is fully synchronous
 * from the caller's point of view.
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
    const targetEpisodeId = resolveEpisodeTarget(stmts, input);
    maybeBindEpisode(stmts, memoryId, input, targetEpisodeId);
    maybeLinkGoal(stmts, memoryId, input);
    maybeRegisterCues(db, stmts, input, targetEpisodeId);
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
