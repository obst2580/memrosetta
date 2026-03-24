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
  invalidated_at   TEXT
);

CREATE INDEX idx_memories_user_id ON memories(user_id);
CREATE INDEX idx_memories_namespace ON memories(user_id, namespace);
CREATE INDEX idx_memories_memory_type ON memories(memory_type);
CREATE INDEX idx_memories_is_latest ON memories(is_latest);
CREATE INDEX idx_memories_source_id ON memories(source_id);
CREATE INDEX idx_memories_learned_at ON memories(learned_at);
CREATE INDEX idx_memories_event_date ON memories(event_date_start, event_date_end);
CREATE INDEX idx_memories_invalidated ON memories(invalidated_at);

-- relations table
CREATE TABLE memory_relations (
  src_memory_id   TEXT NOT NULL,
  dst_memory_id   TEXT NOT NULL,
  relation_type   TEXT NOT NULL CHECK(relation_type IN ('updates', 'extends', 'derives', 'contradicts', 'supports')),
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

export interface SchemaOptions {
  readonly vectorEnabled?: boolean;
}

const SCHEMA_V2 = `
CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
  embedding float[384]
);
`;

const SCHEMA_V3 = `
ALTER TABLE memories ADD COLUMN event_date_start TEXT;
ALTER TABLE memories ADD COLUMN event_date_end TEXT;
ALTER TABLE memories ADD COLUMN invalidated_at TEXT;

CREATE INDEX idx_memories_event_date ON memories(event_date_start, event_date_end);
CREATE INDEX idx_memories_invalidated ON memories(invalidated_at);
`;

export function ensureSchema(db: Database.Database, options?: SchemaOptions): void {
  const hasVersionTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get();

  if (!hasVersionTable) {
    db.exec('CREATE TABLE schema_version (version INTEGER NOT NULL)');
    db.exec(SCHEMA_V1);

    let version = 1;
    if (options?.vectorEnabled) {
      db.exec(SCHEMA_V2);
      version = 2;
    }
    // Fresh databases already include v3 columns in SCHEMA_V1
    version = 3;
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
    return;
  }

  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  const currentVersion = row?.version ?? 0;

  if (currentVersion < 1) {
    db.exec(SCHEMA_V1);
    db.prepare('UPDATE schema_version SET version = ?').run(1);
  }

  if (currentVersion < 2 && options?.vectorEnabled) {
    db.exec(SCHEMA_V2);
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
}
