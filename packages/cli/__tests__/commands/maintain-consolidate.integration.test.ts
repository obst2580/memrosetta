import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ensureSchema } from '@memrosetta/core';
import { run } from '../../src/commands/maintain.js';
import { closeEngine } from '../../src/engine.js';

vi.mock('@memrosetta/core', async () => import('../../../core/src/index.js'));

describe('maintain --consolidate integration', () => {
  let dir: string;
  let dbPath: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memrosetta-cli-consolidate-'));
    dbPath = join(dir, 'memories.db');
    const db = new Database(dbPath);
    ensureSchema(db);
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO consolidation_jobs
        (id, kind, payload, status, created_at, updated_at, attempts, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('job-pending', 'gist_refinement', '{}', 'pending', now, now, 0, 'u1');
    db.prepare(`
      INSERT INTO consolidation_jobs
        (id, kind, payload, status, created_at, updated_at, attempts, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('job-done', 'gist_refinement', '{}', 'done', now, now, 1, 'u1');
    db.prepare(`
      INSERT INTO consolidation_jobs
        (id, kind, payload, status, created_at, updated_at, attempts, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('job-other-user', 'gist_refinement', '{}', 'pending', now, now, 0, 'u2');
    db.close();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    await closeEngine();
    stdoutSpy?.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it('processes only pending jobs for the selected user', async () => {
    await run({
      args: ['--consolidate', '--user', 'u1'],
      format: 'json',
      db: dbPath,
      noEmbeddings: true,
    });

    const db = new Database(dbPath);
    const rows = db.prepare(
      'SELECT id, status, attempts FROM consolidation_jobs ORDER BY id ASC',
    ).all() as readonly {
      readonly id: string;
      readonly status: string;
      readonly attempts: number;
    }[];
    db.close();

    expect(rows).toEqual([
      { id: 'job-done', status: 'done', attempts: 1 },
      { id: 'job-other-user', status: 'pending', attempts: 0 },
      { id: 'job-pending', status: 'failed', attempts: 1 },
    ]);
  });
});
