import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { ensureSchema } from '../src/schema.js';
import {
  applyCoAccessBoost,
  applyContextBoost,
  searchMemories,
  type SearchContextFilters,
} from '../src/search.js';
import type { Memory, SearchResult } from '@memrosetta/types';

function makeMemory(id: string, overrides: Partial<Memory> = {}): Memory {
  return {
    memoryId: id,
    userId: 'user1',
    memoryType: 'fact',
    content: `content ${id}`,
    learnedAt: '2026-04-16T00:00:00.000Z',
    confidence: 1.0,
    salience: 1.0,
    isLatest: true,
    keywords: [],
    ...overrides,
  };
}

function makeResult(id: string, score: number, overrides: Partial<Memory> = {}): SearchResult {
  return {
    memory: makeMemory(id, overrides),
    score,
    matchType: 'fts',
  };
}

function insertMemory(
  db: Database.Database,
  memoryId: string,
  content: string,
  namespace: string | null = null,
  project: string | null = null,
): void {
  const hasProject = db.prepare(`PRAGMA table_info(memories)`).all()
    .some((row: { name: string }) => row.name === 'project');

  if (hasProject) {
    db.prepare(`
      INSERT INTO memories (
        memory_id, user_id, namespace, project, memory_type, content, raw_text,
        document_date, learned_at, source_id, confidence, salience, is_latest,
        embedding, keywords, event_date_start, event_date_end, invalidated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      memoryId,
      'user1',
      namespace,
      project,
      'fact',
      content,
      null,
      null,
      '2026-04-16T00:00:00.000Z',
      null,
      1.0,
      1.0,
      1,
      null,
      null,
      null,
      null,
      null,
    );
    return;
  }

  db.prepare(`
    INSERT INTO memories (
      memory_id, user_id, namespace, memory_type, content, raw_text,
      document_date, learned_at, source_id, confidence, salience, is_latest,
      embedding, keywords, event_date_start, event_date_end, invalidated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    memoryId,
    'user1',
    namespace,
    'fact',
    content,
    null,
    null,
    '2026-04-16T00:00:00.000Z',
    null,
    1.0,
    1.0,
    1,
    null,
    null,
    null,
    null,
    null,
  );

  if (project) {
    db.exec('ALTER TABLE memories ADD COLUMN project TEXT');
    db.prepare('UPDATE memories SET project = ? WHERE memory_id = ?').run(project, memoryId);
  }
}

describe('context and co-access ranking', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureSchema(db);
    const columns = db.prepare(`PRAGMA table_info(memories)`).all() as readonly { name: string }[];
    if (!columns.some(row => row.name === 'project')) {
      db.exec('ALTER TABLE memories ADD COLUMN project TEXT');
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_coaccess (
        memory_a_id TEXT NOT NULL,
        memory_b_id TEXT NOT NULL,
        co_access_count INTEGER NOT NULL DEFAULT 1,
        last_co_accessed_at TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 1.0,
        PRIMARY KEY (memory_a_id, memory_b_id)
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('applyContextBoost lifts same-project memories above a slightly higher baseline', () => {
    insertMemory(db, 'mem-alpha', 'typescript notes', 'session-1', 'alpha');
    insertMemory(db, 'mem-beta', 'typescript notes', 'session-2', 'beta');

    const results: readonly SearchResult[] = [
      makeResult('mem-beta', 1.0),
      makeResult('mem-alpha', 0.9),
    ];

    const boosted = applyContextBoost(db, results, { project: 'alpha' });

    expect(boosted[0].memory.memoryId).toBe('mem-alpha');
    expect(boosted[0].score).toBeCloseTo(1.15, 6);
  });

  it('applyContextBoost stacks namespace and session boosts when both match', () => {
    insertMemory(db, 'mem-same', 'release notes', 'session-42', 'alpha');
    insertMemory(db, 'mem-other', 'release notes', 'session-99', 'alpha');

    const results: readonly SearchResult[] = [
      makeResult('mem-other', 1.0),
      makeResult('mem-same', 0.8),
    ];

    const filters: SearchContextFilters = {
      namespace: 'session-42',
      sessionId: 'session-42',
    };
    const boosted = applyContextBoost(db, results, filters);

    expect(boosted[0].memory.memoryId).toBe('mem-same');
    expect(boosted[0].score).toBeCloseTo(1.05, 6);
  });

  it('applyCoAccessBoost lifts candidates strongly connected to a top seed', () => {
    insertMemory(db, 'mem-seed', 'seed memory', null, 'alpha');
    insertMemory(db, 'mem-neighbor', 'neighbor memory', null, 'alpha');
    insertMemory(db, 'mem-other', 'other memory', null, 'alpha');
    insertMemory(db, 'mem-fill-1', 'fill 1', null, 'alpha');
    insertMemory(db, 'mem-fill-2', 'fill 2', null, 'alpha');
    insertMemory(db, 'mem-fill-3', 'fill 3', null, 'alpha');

    db.prepare(`
      INSERT INTO memory_coaccess (
        memory_a_id, memory_b_id, co_access_count, last_co_accessed_at, strength
      ) VALUES (?, ?, ?, ?, ?)
    `).run('mem-seed', 'mem-neighbor', 8, '2026-04-16T00:00:00.000Z', 3.0);

    const results: readonly SearchResult[] = [
      makeResult('mem-seed', 1.0),
      makeResult('mem-fill-1', 0.99),
      makeResult('mem-fill-2', 0.98),
      makeResult('mem-fill-3', 0.97),
      makeResult('mem-other', 0.96),
      makeResult('mem-neighbor', 0.60),
    ];

    const boosted = applyCoAccessBoost(db, results);

    expect(boosted[0].memory.memoryId).toBe('mem-neighbor');
    expect(boosted[0].score).toBeCloseTo(1.05, 6);
  });

  it('searchMemories behaves as before when context is omitted', () => {
    insertMemory(db, 'mem-ts-1', 'TypeScript architecture guide', null, 'alpha');
    insertMemory(db, 'mem-ts-2', 'TypeScript architecture deep dive', null, 'beta');

    const result = searchMemories(db, {
      userId: 'user1',
      query: 'typescript architecture',
    });

    expect(result.results.length).toBe(2);
    expect(result.results.map(r => r.memory.memoryId)).toEqual(['mem-ts-1', 'mem-ts-2']);
  });

  it('searchMemories does not throw when memory_coaccess is absent', () => {
    db.exec('DROP TABLE memory_coaccess');
    insertMemory(db, 'mem-safe', 'typescript compiler internals', null, 'alpha');

    const result = searchMemories(
      db,
      { userId: 'user1', query: 'typescript' },
      undefined,
      true,
      true,
      { project: 'alpha' },
    );

    expect(result.results.length).toBe(1);
    expect(result.results[0].memory.memoryId).toBe('mem-safe');
  });
});
