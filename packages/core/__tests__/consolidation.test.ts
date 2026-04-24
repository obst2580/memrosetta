import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ensureSchema } from '../src/schema.js';
import { ConsolidationQueue } from '../src/consolidation.js';

describe('Persistent ConsolidationQueue', () => {
  let dir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memrosetta-consolidation-'));
    dbPath = join(dir, 'memories.db');
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    ensureSchema(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps pending jobs after close and reopen', () => {
    const q = new ConsolidationQueue(db);
    q.enqueue({
      userId: 'u1',
      kind: 'gist_refinement',
      payload: { memoryId: 'm1' },
    });
    db.close();

    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    const reopened = new ConsolidationQueue(db);

    expect(reopened.pending('abstraction')).toHaveLength(1);
    expect(reopened.pending('abstraction')[0].status).toBe('pending');
  });

  it('dedupes active jobs by user, kind, and dedupKey', () => {
    const q = new ConsolidationQueue(db);

    const first = q.enqueue({
      userId: 'u1',
      kind: 'gist_refinement',
      dedupKey: 'memory:m1',
      payload: { memoryId: 'm1' },
    });
    const second = q.enqueue({
      userId: 'u1',
      kind: 'gist_refinement',
      dedupKey: 'memory:m1',
      payload: { memoryId: 'm1', duplicate: true },
    });

    expect(second.id).toBe(first.id);
    expect(q.pending('abstraction')).toHaveLength(1);
  });

  it('persists relation_discovery jobs in the maintenance queue', () => {
    const q = new ConsolidationQueue(db);
    q.enqueue({
      userId: 'u1',
      kind: 'relation_discovery',
      dedupKey: 'relation_discovery:u1',
      payload: { recentDays: 7, threshold: 2 },
    });

    const pending = q.pending('maintenance');
    expect(pending).toHaveLength(1);
    expect(pending[0].kind).toBe('relation_discovery');
  });

  it('persists prototype_induction jobs in the abstraction queue', () => {
    const q = new ConsolidationQueue(db);
    q.enqueue({
      userId: 'u1',
      kind: 'prototype_induction',
      dedupKey: 'prototype_induction:u1',
      payload: { minClusterSize: 5 },
    });

    const pending = q.pending('abstraction');
    expect(pending).toHaveLength(1);
    expect(pending[0].kind).toBe('prototype_induction');
  });

  it('retries failed jobs up to max attempts', async () => {
    const q = new ConsolidationQueue(db);
    q.register('gist_refinement', async () => {
      throw new Error('boom');
    });
    q.enqueue({
      userId: 'u1',
      kind: 'gist_refinement',
      payload: { memoryId: 'm1' },
    });

    const first = await q.runNext(db, 'abstraction');
    const second = await q.runNext(db, 'abstraction');
    const third = await q.runNext(db, 'abstraction');

    expect(first?.status).toBe('pending');
    expect(first?.attempts).toBe(1);
    expect(second?.status).toBe('pending');
    expect(second?.attempts).toBe(2);
    expect(third?.status).toBe('failed');
    expect(third?.attempts).toBe(3);
    expect(await q.runNext(db, 'abstraction')).toBeNull();
  });
});
