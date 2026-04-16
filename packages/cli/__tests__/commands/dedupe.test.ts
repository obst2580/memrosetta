import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ensureSchema } from '@memrosetta/core';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { run } from '../../src/commands/dedupe.js';

describe('dedupe command', () => {
  let dbPath: string;
  let db: Database.Database;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dbPath = join(tmpdir(), `memrosetta-dedupe-${randomUUID()}.db`);
    db = new Database(dbPath);
    ensureSchema(db, { vectorEnabled: false });

    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const insert = db.prepare(`
      INSERT INTO memories (
        memory_id, user_id, namespace, memory_type, content, learned_at, is_latest,
        use_count, success_count
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    insert.run('mem-canonical', 'obst', 'session-a', 'fact', 'same content', '2026-04-16T00:00:00.000Z', 5, 4);
    insert.run('mem-legacy', 'personal/memrosetta', 'session-a', 'fact', 'same content', '2026-04-15T00:00:00.000Z', 1, 1);
    insert.run('mem-other', 'obst', 'session-b', 'fact', 'different content', '2026-04-16T00:00:00.000Z', 0, 0);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    if (db.open) db.close();
    rmSync(dbPath, { force: true });
  });

  it('reports duplicate groups in dry-run mode without mutating data', async () => {
    await run({
      args: ['--dry-run', '--canonical', 'obst'],
      format: 'json',
      db: dbPath,
      noEmbeddings: true,
    });

    const payload = JSON.parse(stdoutSpy.mock.calls.at(-1)?.[0] as string) as {
      groups: number;
      invalidated: number;
      relationsCreated: number;
    };
    expect(payload.groups).toBe(1);
    expect(payload.invalidated).toBe(1);
    expect(payload.relationsCreated).toBe(1);

    const invalidated = db.prepare(
      `SELECT invalidated_at FROM memories WHERE memory_id = 'mem-legacy'`,
    ).get() as { invalidated_at: string | null };
    expect(invalidated.invalidated_at).toBeNull();
  });

  it('invalidates losers and creates duplicates relations', async () => {
    db.close();

    await run({
      args: ['--canonical', 'obst'],
      format: 'json',
      db: dbPath,
      noEmbeddings: true,
    });

    db = new Database(dbPath);

    const invalidated = db.prepare(
      `SELECT invalidated_at FROM memories WHERE memory_id = 'mem-legacy'`,
    ).get() as { invalidated_at: string | null };
    expect(invalidated.invalidated_at).toBeTruthy();

    const relation = db.prepare(
      `SELECT relation_type, src_memory_id, dst_memory_id
       FROM memory_relations
       WHERE src_memory_id = 'mem-legacy' AND dst_memory_id = 'mem-canonical'`,
    ).get() as { relation_type: string; src_memory_id: string; dst_memory_id: string } | undefined;

    expect(relation).toEqual({
      relation_type: 'duplicates',
      src_memory_id: 'mem-legacy',
      dst_memory_id: 'mem-canonical',
    });
  });
});
