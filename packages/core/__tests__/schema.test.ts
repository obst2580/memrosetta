import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ensureSchema } from '../src/schema.js';

describe('ensureSchema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  it('creates all tables on fresh database', () => {
    ensureSchema(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('schema_version');
    expect(tableNames).toContain('memories');
    expect(tableNames).toContain('memory_relations');
  });

  it('creates FTS5 virtual table', () => {
    ensureSchema(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'")
      .all();
    expect(tables.length).toBe(1);
  });

  it('creates indexes on memories table', () => {
    ensureSchema(db);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memories'")
      .all() as { name: string }[];
    const indexNames = indexes.map(i => i.name);

    expect(indexNames).toContain('idx_memories_user_id');
    expect(indexNames).toContain('idx_memories_namespace');
    expect(indexNames).toContain('idx_memories_memory_type');
    expect(indexNames).toContain('idx_memories_is_latest');
    expect(indexNames).toContain('idx_memories_source_id');
    expect(indexNames).toContain('idx_memories_learned_at');
    expect(indexNames).toContain('idx_memories_event_date');
    expect(indexNames).toContain('idx_memories_invalidated');
    expect(indexNames).toContain('idx_memories_tier');
    expect(indexNames).toContain('idx_memories_activation');
  });

  it('sets schema version to 18 for fresh database', () => {
    ensureSchema(db);

    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(18);
  });

  it('creates consolidation_jobs at v17', () => {
    ensureSchema(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='consolidation_jobs'")
      .all() as readonly { name: string }[];
    expect(tables).toHaveLength(1);

    const cols = db
      .prepare('PRAGMA table_info(consolidation_jobs)')
      .all() as readonly { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('kind');
    expect(colNames).toContain('payload');
    expect(colNames).toContain('status');
    expect(colNames).toContain('user_id');
    expect(colNames).toContain('dedup_key');
  });

  it('creates v7 brain-inspired tables (memory_coaccess + encoding context columns)', () => {
    ensureSchema(db);

    // memory_coaccess table exists
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_coaccess'")
      .all() as readonly { name: string }[];
    expect(tables).toHaveLength(1);

    // project + activity_type columns exist on memories
    const cols = db
      .prepare('PRAGMA table_info(memories)')
      .all() as readonly { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('project');
    expect(colNames).toContain('activity_type');

    // Indexes exist
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_memory_coaccess%'")
      .all() as readonly { name: string }[];
    expect(indexes.length).toBeGreaterThanOrEqual(2);
  });

  it('creates migration_version and memory_legacy_scope tables at v6', () => {
    ensureSchema(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as readonly { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('migration_version');
    expect(names).toContain('memory_legacy_scope');

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_memory_legacy_scope%'")
      .all() as readonly { name: string }[];
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('idx_memory_legacy_scope_user');
    expect(indexNames).toContain('idx_memory_legacy_scope_user_ns');
  });

  it('is idempotent - running twice does not error', () => {
    ensureSchema(db);
    expect(() => ensureSchema(db)).not.toThrow();

    const row = db.prepare('SELECT version FROM schema_version').get() as { version: number };
    expect(row.version).toBe(18);
  });

  it('FTS5 syncs with memories table on insert', () => {
    ensureSchema(db);

    db.prepare(`
      INSERT INTO memories (memory_id, user_id, memory_type, content, learned_at, keywords)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('mem-test1', 'user-1', 'fact', 'TypeScript is a typed JavaScript', '2025-01-01T00:00:00.000Z', 'typescript javascript');

    const results = db
      .prepare("SELECT * FROM memories_fts WHERE memories_fts MATCH 'typescript'")
      .all();
    expect(results.length).toBe(1);
  });

  it('FTS5 syncs with memories table on update', () => {
    ensureSchema(db);

    db.prepare(`
      INSERT INTO memories (memory_id, user_id, memory_type, content, learned_at, keywords)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('mem-test1', 'user-1', 'fact', 'TypeScript is great', '2025-01-01T00:00:00.000Z', 'typescript');

    db.prepare(`
      UPDATE memories SET content = ?, keywords = ? WHERE memory_id = ?
    `).run('Python is great', 'python', 'mem-test1');

    const tsResults = db
      .prepare("SELECT * FROM memories_fts WHERE memories_fts MATCH 'typescript'")
      .all();
    expect(tsResults.length).toBe(0);

    const pyResults = db
      .prepare("SELECT * FROM memories_fts WHERE memories_fts MATCH 'python'")
      .all();
    expect(pyResults.length).toBe(1);
  });

  it('FTS5 syncs with memories table on delete', () => {
    ensureSchema(db);

    db.prepare(`
      INSERT INTO memories (memory_id, user_id, memory_type, content, learned_at, keywords)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('mem-test1', 'user-1', 'fact', 'TypeScript is great', '2025-01-01T00:00:00.000Z', 'typescript');

    db.prepare('DELETE FROM memories WHERE memory_id = ?').run('mem-test1');

    const results = db
      .prepare("SELECT * FROM memories_fts WHERE memories_fts MATCH 'typescript'")
      .all();
    expect(results.length).toBe(0);
  });

  it('memory_type CHECK constraint enforces valid types', () => {
    ensureSchema(db);

    expect(() => {
      db.prepare(`
        INSERT INTO memories (memory_id, user_id, memory_type, content, learned_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('mem-bad', 'user-1', 'invalid_type', 'test', '2025-01-01T00:00:00.000Z');
    }).toThrow();
  });

  it('relation_type CHECK constraint enforces valid types', () => {
    ensureSchema(db);

    // Insert two memories first
    const insert = db.prepare(`
      INSERT INTO memories (memory_id, user_id, memory_type, content, learned_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    insert.run('mem-a', 'user-1', 'fact', 'Memory A', '2025-01-01T00:00:00.000Z');
    insert.run('mem-b', 'user-1', 'fact', 'Memory B', '2025-01-01T00:00:00.000Z');

    expect(() => {
      db.prepare(`
        INSERT INTO memory_relations (src_memory_id, dst_memory_id, relation_type, created_at)
        VALUES (?, ?, ?, ?)
      `).run('mem-a', 'mem-b', 'invalid_relation', '2025-01-01T00:00:00.000Z');
    }).toThrow();
  });

  it('relation_type CHECK constraint accepts deterministic graph relation types', () => {
    ensureSchema(db);

    const insert = db.prepare(`
      INSERT INTO memories (memory_id, user_id, memory_type, content, learned_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    insert.run('mem-a', 'user-1', 'fact', 'Memory A', '2025-01-01T00:00:00.000Z');
    insert.run('mem-b', 'user-1', 'fact', 'Memory B', '2025-01-01T00:00:00.000Z');

    expect(() => {
      db.prepare(`
        INSERT INTO memory_relations (src_memory_id, dst_memory_id, relation_type, created_at)
        VALUES (?, ?, ?, ?)
      `).run('mem-a', 'mem-b', 'uses', '2025-01-01T00:00:00.000Z');
    }).not.toThrow();
  });

  // v0.11: embedding_dimension column removed along with vec_memories
  // and the HF embedder path. Previous tests covering those fields are
  // removed; schema_version now only carries `version`.
});
