import type Database from 'better-sqlite3';
import { nowIso } from './utils.js';

/**
 * Dual Representation helpers (Fuzzy Trace Theory, v4 §4).
 *
 * Memory text field contract (Codex Step 4 review):
 *   - content: legacy + current retrieval/FTS-facing text. Remains the
 *     primary input for search/keyword paths until Step 7+ migrates
 *     retrieval onto the dual-representation pair.
 *   - verbatim_content: immutable raw trace. Never mutated after insert.
 *     Backfilled to equal content on v12 migration; new rows accept an
 *     explicit verbatim override via MemoryInput.verbatim.
 *   - gist_content: mutable abstraction layer. Updated by
 *     setMemoryGist; every rewrite archives the previous gist into
 *     memory_gists_versions for reconsolidation audit.
 *
 * The verbatim trace is immutable once written. Gist is a derived,
 * compressed form and can be rewritten by the background consolidation
 * loop. Every rewrite is archived in `memory_gists_versions` so recall
 * can still answer "what gist did the system believe at time T?"
 * without freezing the current gist as permanent.
 */

export interface GistUpdate {
  readonly memoryId: string;
  readonly gistContent: string;
  readonly gistConfidence?: number;
  readonly extractedModel?: string;
  readonly reason?: string;
}

export interface GistVersionRow {
  readonly memoryId: string;
  readonly version: number;
  readonly gistContent: string;
  readonly gistConfidence?: number;
  readonly extractedAt: string;
  readonly extractedModel?: string;
  readonly reason?: string;
}

interface RawGistVersionRow {
  readonly memory_id: string;
  readonly version: number;
  readonly gist_content: string;
  readonly gist_confidence: number | null;
  readonly extracted_at: string;
  readonly extracted_model: string | null;
  readonly reason: string | null;
}

interface CurrentGistRow {
  readonly gist_content: string | null;
  readonly gist_confidence: number | null;
  readonly gist_extracted_at: string | null;
  readonly gist_extracted_model: string | null;
}

export interface GistStatements {
  readonly getCurrentGist: Database.Statement;
  readonly updateCurrentGist: Database.Statement;
  readonly insertVersion: Database.Statement;
  readonly nextVersion: Database.Statement;
  readonly getVersions: Database.Statement;
  readonly getVerbatim: Database.Statement;
}

export function createGistStatements(db: Database.Database): GistStatements {
  return {
    getCurrentGist: db.prepare(
      `SELECT gist_content, gist_confidence, gist_extracted_at, gist_extracted_model
       FROM memories WHERE memory_id = ?`,
    ),
    updateCurrentGist: db.prepare(
      `UPDATE memories
       SET gist_content = ?, gist_confidence = ?,
           gist_extracted_at = ?, gist_extracted_model = ?
       WHERE memory_id = ?`,
    ),
    insertVersion: db.prepare(
      `INSERT INTO memory_gists_versions
         (memory_id, version, gist_content, gist_confidence,
          extracted_at, extracted_model, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    nextVersion: db.prepare(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM memory_gists_versions WHERE memory_id = ?`,
    ),
    getVersions: db.prepare(
      `SELECT memory_id, version, gist_content, gist_confidence,
              extracted_at, extracted_model, reason
       FROM memory_gists_versions
       WHERE memory_id = ?
       ORDER BY version ASC`,
    ),
    getVerbatim: db.prepare(
      'SELECT verbatim_content FROM memories WHERE memory_id = ?',
    ),
  };
}

/**
 * Replace the current gist with a new one, archiving the previous
 * current-gist row into memory_gists_versions. Wraps the two writes
 * in a transaction so the history never diverges from the live row.
 */
export function setMemoryGist(
  db: Database.Database,
  stmts: GistStatements,
  update: GistUpdate,
): void {
  // Codex Step 4 review: reject empty/whitespace gist so accidental
  // no-op writes never bump timestamps or create empty history rows.
  if (!update.gistContent || update.gistContent.trim().length === 0) {
    throw new Error('setMemoryGist: gistContent must be non-empty');
  }

  const now = nowIso();

  const writeTxn = db.transaction(() => {
    const current = stmts.getCurrentGist.get(update.memoryId) as
      | CurrentGistRow
      | undefined;

    // If there is already a gist, archive it before overwriting.
    if (current?.gist_content) {
      const { next_version } = stmts.nextVersion.get(update.memoryId) as {
        next_version: number;
      };
      stmts.insertVersion.run(
        update.memoryId,
        next_version,
        current.gist_content,
        current.gist_confidence,
        current.gist_extracted_at ?? now,
        current.gist_extracted_model,
        update.reason ?? null,
      );
    }

    stmts.updateCurrentGist.run(
      update.gistContent,
      update.gistConfidence ?? null,
      now,
      update.extractedModel ?? null,
      update.memoryId,
    );
  });

  writeTxn();
}

export function getCurrentGist(
  stmts: GistStatements,
  memoryId: string,
): CurrentGistRow | null {
  const row = stmts.getCurrentGist.get(memoryId) as CurrentGistRow | undefined;
  return row ?? null;
}

export function getGistVersions(
  stmts: GistStatements,
  memoryId: string,
): readonly GistVersionRow[] {
  const rows = stmts.getVersions.all(memoryId) as readonly RawGistVersionRow[];
  return rows.map((r) => ({
    memoryId: r.memory_id,
    version: r.version,
    gistContent: r.gist_content,
    gistConfidence: r.gist_confidence ?? undefined,
    extractedAt: r.extracted_at,
    extractedModel: r.extracted_model ?? undefined,
    reason: r.reason ?? undefined,
  }));
}

export function getVerbatim(
  stmts: GistStatements,
  memoryId: string,
): string | null {
  const row = stmts.getVerbatim.get(memoryId) as
    | { verbatim_content: string | null }
    | undefined;
  return row?.verbatim_content ?? null;
}
