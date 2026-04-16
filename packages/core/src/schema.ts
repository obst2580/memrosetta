import type Database from 'better-sqlite3';

const SCHEMA_V1 = `
-- memories table
CREATE TABLE memories (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id       TEXT NOT NULL UNIQUE,
  user_id         TEXT NOT NULL,
  namespace       TEXT,
  memory_type     TEXT NOT NULL CHECK(memory_type IN ('fact', 'preference', 'decision', 'event')),
  content         TEXT NOT NULL,
  raw_text        TEXT,
  document_date   TEXT,
  learned_at      TEXT NOT NULL,
  source_id       TEXT,
  confidence      REAL DEFAULT 1.0,
  salience        REAL DEFAULT 1.0,
  is_latest       INTEGER NOT NULL DEFAULT 1,
  embedding       BLOB,
  keywords        TEXT,
  event_date_start TEXT,
  event_date_end   TEXT,
  invalidated_at   TEXT,
  tier             TEXT DEFAULT 'warm' CHECK(tier IN ('hot', 'warm', 'cold')),
  activation_score REAL DEFAULT 1.0,
  access_count     INTEGER DEFAULT 0,
  last_accessed_at TEXT,
  compressed_from  TEXT,
  use_count        INTEGER DEFAULT 0,
  success_count    INTEGER DEFAULT 0
);

CREATE INDEX idx_memories_user_id ON memories(user_id);
CREATE INDEX idx_memories_namespace ON memories(user_id, namespace);
CREATE INDEX idx_memories_memory_type ON memories(memory_type);
CREATE INDEX idx_memories_is_latest ON memories(is_latest);
CREATE INDEX idx_memories_source_id ON memories(source_id);
CREATE INDEX idx_memories_learned_at ON memories(learned_at);
CREATE INDEX idx_memories_event_date ON memories(event_date_start, event_date_end);
CREATE INDEX idx_memories_invalidated ON memories(invalidated_at);
CREATE INDEX idx_memories_tier ON memories(tier);
CREATE INDEX idx_memories_activation ON memories(activation_score);

-- relations table
CREATE TABLE memory_relations (
  src_memory_id   TEXT NOT NULL,
  dst_memory_id   TEXT NOT NULL,
  relation_type   TEXT NOT NULL CHECK(relation_type IN ('updates', 'extends', 'derives', 'contradicts', 'supports', 'duplicates')),
  created_at      TEXT NOT NULL,
  reason          TEXT,
  PRIMARY KEY (src_memory_id, dst_memory_id, relation_type),
  FOREIGN KEY (src_memory_id) REFERENCES memories(memory_id),
  FOREIGN KEY (dst_memory_id) REFERENCES memories(memory_id)
);

-- FTS5 full-text search (content-sync mode)
CREATE VIRTUAL TABLE memories_fts USING fts5(
  content,
  keywords,
  content='memories',
  content_rowid='id'
);

-- FTS sync triggers
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, keywords) VALUES (new.id, new.content, new.keywords);
END;

CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, keywords) VALUES ('delete', old.id, old.content, old.keywords);
END;

CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, keywords) VALUES ('delete', old.id, old.content, old.keywords);
  INSERT INTO memories_fts(rowid, content, keywords) VALUES (new.id, new.content, new.keywords);
END;
`;

const SCHEMA_V5 = `
ALTER TABLE memories ADD COLUMN use_count INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN success_count INTEGER DEFAULT 0;
`;

/**
 * v6: supporting tables for v0.5.2 legacy user_id migration.
 *
 * `migration_version` is a lightweight audit log so repeatable
 * one-shot data fixups (not schema DDL) can be marked as applied
 * without piggy-backing on `schema_version`.
 *
 * `memory_legacy_scope` preserves the original `user_id` that was
 * written when `resolveUserId(cwd)` derived `personal/<dir>` or
 * `work/<dir>` style partitions from the current working directory.
 * When `memrosetta migrate legacy-user-ids` rewrites `memories.user_id`
 * to the canonical user, this table remembers what the row used to
 * look like so future tooling can re-derive project scope without
 * touching the `namespace` column (which already holds `session-XXXX`).
 */
const SCHEMA_V6 = `
CREATE TABLE IF NOT EXISTS migration_version (
  name        TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_legacy_scope (
  memory_id         TEXT PRIMARY KEY,
  legacy_user_id    TEXT NOT NULL,
  legacy_namespace  TEXT,
  migrated_at       TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(memory_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_legacy_scope_user
  ON memory_legacy_scope(legacy_user_id);

CREATE INDEX IF NOT EXISTS idx_memory_legacy_scope_user_ns
  ON memory_legacy_scope(legacy_user_id, legacy_namespace);
`;

/**
 * v7: Brain-inspired retrieval enhancements (v0.7.0).
 *
 * 1. Encoding context columns on `memories` — stores the project and
 *    activity type at encoding time so context-dependent retrieval
 *    (Tulving 1973) can boost memories whose encoding context matches
 *    the current search context.
 *
 * 2. `memory_coaccess` table — Hebbian co-access graph. When two
 *    memories appear together in search results, their co-access
 *    strength is incremented. Future searches boost co-accessed
 *    neighbors. This builds an implicit associative layer on top of
 *    the sparse explicit relation graph.
 */
const SCHEMA_V7 = `
ALTER TABLE memories ADD COLUMN project TEXT;
ALTER TABLE memories ADD COLUMN activity_type TEXT;

CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);

CREATE TABLE IF NOT EXISTS memory_coaccess (
  memory_a_id         TEXT NOT NULL,
  memory_b_id         TEXT NOT NULL,
  co_access_count     INTEGER NOT NULL DEFAULT 1,
  last_co_accessed_at TEXT NOT NULL,
  strength            REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (memory_a_id, memory_b_id),
  FOREIGN KEY (memory_a_id) REFERENCES memories(memory_id),
  FOREIGN KEY (memory_b_id) REFERENCES memories(memory_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_coaccess_a
  ON memory_coaccess(memory_a_id, strength DESC);
CREATE INDEX IF NOT EXISTS idx_memory_coaccess_b
  ON memory_coaccess(memory_b_id, strength DESC);
`;

/**
 * v8: allow explicit duplicate relations for the destructive dedupe pass.
 *
 * SQLite cannot ALTER an existing CHECK constraint, so we rebuild the
 * `memory_relations` table in-place for upgraded databases.
 */
const SCHEMA_V8 = `
CREATE TABLE memory_relations_v8 (
  src_memory_id   TEXT NOT NULL,
  dst_memory_id   TEXT NOT NULL,
  relation_type   TEXT NOT NULL CHECK(relation_type IN ('updates', 'extends', 'derives', 'contradicts', 'supports', 'duplicates')),
  created_at      TEXT NOT NULL,
  reason          TEXT,
  PRIMARY KEY (src_memory_id, dst_memory_id, relation_type),
  FOREIGN KEY (src_memory_id) REFERENCES memories(memory_id),
  FOREIGN KEY (dst_memory_id) REFERENCES memories(memory_id)
);

INSERT INTO memory_relations_v8 (src_memory_id, dst_memory_id, relation_type, created_at, reason)
SELECT src_memory_id, dst_memory_id, relation_type, created_at, reason
FROM memory_relations;

DROP TABLE memory_relations;
ALTER TABLE memory_relations_v8 RENAME TO memory_relations;
`;

export interface SchemaOptions {
  readonly vectorEnabled?: boolean;
  readonly embeddingDimension?: number;
}

function schemaV2(dim: number): string {
  return `CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(embedding float[${dim}]);`;
}

const SCHEMA_V3 = `
ALTER TABLE memories ADD COLUMN event_date_start TEXT;
ALTER TABLE memories ADD COLUMN event_date_end TEXT;
ALTER TABLE memories ADD COLUMN invalidated_at TEXT;

CREATE INDEX idx_memories_event_date ON memories(event_date_start, event_date_end);
CREATE INDEX idx_memories_invalidated ON memories(invalidated_at);
`;

const SCHEMA_V4 = `
ALTER TABLE memories ADD COLUMN tier TEXT DEFAULT 'warm' CHECK(tier IN ('hot', 'warm', 'cold'));
ALTER TABLE memories ADD COLUMN activation_score REAL DEFAULT 1.0;
ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN last_accessed_at TEXT;
ALTER TABLE memories ADD COLUMN compressed_from TEXT;

CREATE INDEX idx_memories_tier ON memories(tier);
CREATE INDEX idx_memories_activation ON memories(activation_score);
`;

export function ensureSchema(db: Database.Database, options?: SchemaOptions): void {
  const hasVersionTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get();

  const dim = options?.embeddingDimension ?? 384;

  if (!hasVersionTable) {
    db.exec('CREATE TABLE schema_version (version INTEGER NOT NULL, embedding_dimension INTEGER DEFAULT 384)');
    db.exec(SCHEMA_V1);

    let version = 1;
    if (options?.vectorEnabled) {
      db.exec(schemaV2(dim));
      version = 2;
    }
    // Fresh databases already include v3 + v4 + v5 columns in SCHEMA_V1.
    // v6 adds migration tables, v7 adds brain-inspired retrieval tables,
    // v8 expands relation_type to include duplicates.
    db.exec(SCHEMA_V6);
    db.exec(SCHEMA_V7);
    version = 8;
    db.prepare('INSERT INTO schema_version (version, embedding_dimension) VALUES (?, ?)').run(version, dim);
    return;
  }

  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  const currentVersion = row?.version ?? 0;

  if (currentVersion < 1) {
    db.exec(SCHEMA_V1);
    db.prepare('UPDATE schema_version SET version = ?').run(1);
  }

  if (currentVersion < 2 && options?.vectorEnabled) {
    db.exec(schemaV2(dim));
    db.prepare('UPDATE schema_version SET version = ?').run(2);
  }

  if (currentVersion < 3) {
    // Only run ALTER TABLE for pre-v3 databases.
    // Fresh databases already have these columns in SCHEMA_V1.
    if (currentVersion >= 1) {
      db.exec(SCHEMA_V3);
    }
    db.prepare('UPDATE schema_version SET version = ?').run(3);
  }

  if (currentVersion < 4) {
    // Only run ALTER TABLE for pre-v4 databases.
    // Fresh databases already have these columns in SCHEMA_V1.
    if (currentVersion >= 1) {
      db.exec(SCHEMA_V4);
    }
    db.prepare('UPDATE schema_version SET version = ?').run(4);
  }

  if (currentVersion < 5) {
    // Only run ALTER TABLE for pre-v5 databases.
    // Fresh databases already have these columns in SCHEMA_V1.
    if (currentVersion >= 1) {
      db.exec(SCHEMA_V5);
    }
    db.prepare('UPDATE schema_version SET version = ?').run(5);
  }

  if (currentVersion < 6) {
    db.exec(SCHEMA_V6);
    db.prepare('UPDATE schema_version SET version = ?').run(6);
  }

  if (currentVersion < 7) {
    // v7 adds encoding context columns (project, activity_type) to
    // memories and the memory_coaccess Hebbian co-access table.
    // ALTER TABLE for pre-v7 databases only; fresh installs already
    // have these from SCHEMA_V1 + SCHEMA_V7 in the fresh-install
    // path above.
    if (currentVersion >= 1) {
      try {
        db.exec(SCHEMA_V7);
      } catch {
        // Columns/tables may already exist from a partial upgrade
        // or manual intervention — safe to ignore.
      }
    }
    db.prepare('UPDATE schema_version SET version = ?').run(7);
  }

  if (currentVersion < 8) {
    db.exec(SCHEMA_V8);
    db.prepare('UPDATE schema_version SET version = ?').run(8);
  }

  // Ensure vec_memories exists when vector is enabled (handles DB created without vectors)
  if (options?.vectorEnabled) {
    const hasVecTable = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='vec_memories'"
    ).get();

    if (!hasVecTable) {
      try {
        db.exec(schemaV2(dim));
      } catch {
        // sqlite-vec module not available -- fall back to no vector search
        process.stderr.write('[memrosetta] sqlite-vec not available, vector search disabled\n');
      }
    }

    // Ensure embedding_dimension column exists and handle dimension mismatch
    const hasDimCol = (db.prepare('PRAGMA table_info(schema_version)').all() as readonly { name: string }[])
      .some((col) => col.name === 'embedding_dimension');

    if (!hasDimCol) {
      db.exec('ALTER TABLE schema_version ADD COLUMN embedding_dimension INTEGER DEFAULT 384');
    }

    const storedDim = (db.prepare('SELECT embedding_dimension FROM schema_version').get() as { embedding_dimension: number | null })
      ?.embedding_dimension ?? 384;

    if (storedDim !== dim) {
      process.stderr.write(
        `[memrosetta] Embedding dimension changed (${storedDim} -> ${dim}). Recreating vector index...\n`,
      );
      try { db.exec('DROP TABLE IF EXISTS vec_memories'); } catch { /* ignore */ }
      try {
        db.exec(schemaV2(dim));
        db.prepare('UPDATE schema_version SET embedding_dimension = ?').run(dim);
      } catch {
        process.stderr.write('[memrosetta] sqlite-vec not available, vector search disabled\n');
      }
    }
  }
}
