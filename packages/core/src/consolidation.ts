import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { nowIso } from './utils.js';

/**
 * Background Consolidation Loop scaffolding (v4 §10.2, Codex Step 2+7
 * review alignment).
 *
 * Split into two logical subqueues:
 *
 *   - Abstraction queue: gist refinement, prototype induction, schema
 *     induction, alias generation. Expensive steps that may call LLMs
 *     or heavy heuristics. Run only on close-episode / idle / nightly
 *     triggers.
 *
 *   - Maintenance queue: novelty rescoring, Hebbian reinforcement,
 *     stale construct detection, cue-alias learning, pattern-separation
 *     cleanup. Cheap, can run every hour.
 *
 * Layer B flag-gates enqueue and explicit maintenance execution.
 * This module provides the persistent queue, job-shape types, and
 * runner semantics.
 */

export type AbstractionJobKind =
  | 'gist_refinement'
  | 'prototype_induction'
  | 'schema_induction'
  | 'alias_generation';

export type MaintenanceJobKind =
  | 'novelty_rescoring'
  | 'hebbian_reinforcement'
  | 'stale_construct_detection'
  | 'cue_alias_learning'
  | 'pattern_separation_cleanup';

export type JobKind = AbstractionJobKind | MaintenanceJobKind;

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface ConsolidationJob<TPayload = Record<string, unknown>> {
  readonly id: string;
  readonly kind: JobKind;
  readonly queue: 'abstraction' | 'maintenance';
  readonly payload: TPayload;
  readonly userId: string;
  readonly dedupKey?: string;
  readonly enqueuedAt: string;
  readonly generationVersion: number;
  readonly status: JobStatus;
  readonly lastError?: string;
  readonly attempts: number;
}

export type JobHandler<TPayload = Record<string, unknown>> = (
  db: Database.Database,
  job: ConsolidationJob<TPayload>,
) => Promise<void>;

interface ConsolidationJobRow {
  readonly id: string;
  readonly kind: string;
  readonly payload: string;
  readonly status: JobStatus;
  readonly created_at: string;
  readonly updated_at: string;
  readonly attempts: number;
  readonly last_error: string | null;
  readonly user_id: string;
  readonly dedup_key: string | null;
}

export class ConsolidationQueue {
  private db: Database.Database | null;
  private readonly handlers = new Map<JobKind, JobHandler>();

  constructor(db?: Database.Database) {
    this.db = db ?? null;
  }

  attach(db: Database.Database): void {
    this.db = db;
  }

  detach(): void {
    this.db = null;
  }

  register(kind: JobKind, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  enqueue<T extends Record<string, unknown>>(input: {
    readonly userId?: string;
    readonly kind: JobKind;
    readonly payload: T;
    readonly dedupKey?: string;
    readonly generationVersion?: number;
  }): ConsolidationJob<T> {
    const db = this.requireDb();
    const userId = input.userId ?? 'system';
    if (input.dedupKey) {
      const existing = db
        .prepare(
          `SELECT * FROM consolidation_jobs
           WHERE user_id = ?
             AND kind = ?
             AND dedup_key = ?
             AND status IN ('pending', 'running')
           ORDER BY created_at ASC
           LIMIT 1`,
        )
        .get(userId, input.kind, input.dedupKey) as ConsolidationJobRow | undefined;
      if (existing) return rowToJob<T>(existing);
    }

    const now = nowIso();
    const id = `job-${nanoid(10)}`;
    db.prepare(
      `INSERT INTO consolidation_jobs
         (id, kind, payload, status, created_at, updated_at,
          attempts, last_error, user_id, dedup_key)
       VALUES (?, ?, ?, 'pending', ?, ?, 0, NULL, ?, ?)`,
    ).run(
      id,
      input.kind,
      JSON.stringify(input.payload),
      now,
      now,
      userId,
      input.dedupKey ?? null,
    );

    const row = this.getRow(id);
    if (!row) throw new Error(`ConsolidationQueue.enqueue: inserted job ${id} not found`);
    return rowToJob<T>(row);
  }

  pending(queue?: 'abstraction' | 'maintenance'): readonly ConsolidationJob[] {
    const db = this.requireDb();
    const rows = db
      .prepare(
        `SELECT * FROM consolidation_jobs
         WHERE status = 'pending'
           ${queueClause(queue)}
         ORDER BY created_at ASC`,
      )
      .all(...queueParams(queue)) as readonly ConsolidationJobRow[];
    return rows.map(rowToJob);
  }

  size(): number {
    const db = this.requireDb();
    const row = db.prepare('SELECT COUNT(*) AS count FROM consolidation_jobs').get() as {
      count: number;
    };
    return row.count;
  }

  dequeue(input: {
    readonly userId?: string;
    readonly queue?: 'abstraction' | 'maintenance';
    readonly maxAttempts?: number;
  } = {}): ConsolidationJob | null {
    const db = this.requireDb();
    const params: unknown[] = [input.maxAttempts ?? 3];
    let userClause = '';
    if (input.userId) {
      userClause = 'AND user_id = ?';
      params.push(input.userId);
    }
    params.push(...queueParams(input.queue));
    const row = db
      .prepare(
        `SELECT * FROM consolidation_jobs
         WHERE status = 'pending'
           AND attempts < ?
           ${userClause}
           ${queueClause(input.queue)}
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get(...params) as ConsolidationJobRow | undefined;
    return row ? rowToJob(row) : null;
  }

  markRunning(id: string): ConsolidationJob | null {
    const db = this.requireDb();
    db.prepare(
      `UPDATE consolidation_jobs
       SET status = 'running',
           attempts = attempts + 1,
           updated_at = ?
       WHERE id = ? AND status = 'pending'`,
    ).run(nowIso(), id);
    const row = this.getRow(id);
    return row ? rowToJob(row) : null;
  }

  markDone(id: string): ConsolidationJob | null {
    const db = this.requireDb();
    db.prepare(
      `UPDATE consolidation_jobs
       SET status = 'done',
           last_error = NULL,
           updated_at = ?
       WHERE id = ?`,
    ).run(nowIso(), id);
    const row = this.getRow(id);
    return row ? rowToJob(row) : null;
  }

  markFailed(
    id: string,
    error: string,
    maxAttempts = 3,
  ): ConsolidationJob | null {
    const db = this.requireDb();
    const current = this.getRow(id);
    if (!current) return null;
    const status: JobStatus = current.attempts >= maxAttempts ? 'failed' : 'pending';
    db.prepare(
      `UPDATE consolidation_jobs
       SET status = ?,
           last_error = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(status, error, nowIso(), id);
    const row = this.getRow(id);
    return row ? rowToJob(row) : null;
  }

  /**
   * Idempotent runner. On success the job transitions to done. Handler
   * failures retry by returning to pending until maxAttempts is reached.
   */
  async runNext(
    db: Database.Database,
    queue: 'abstraction' | 'maintenance',
    options: {
      readonly userId?: string;
      readonly maxAttempts?: number;
    } = {},
  ): Promise<ConsolidationJob | null> {
    if (!this.db) this.attach(db);
    const maxAttempts = options.maxAttempts ?? 3;
    const job = this.dequeue({ queue, userId: options.userId, maxAttempts });
    if (!job) return null;

    const running = this.markRunning(job.id);
    if (!running) return null;

    const handler = this.handlers.get(job.kind);
    if (!handler) {
      return this.markFailed(
        running.id,
        `no handler registered for kind=${job.kind}`,
        1,
      );
    }

    try {
      await handler(db, running);
      return this.markDone(running.id);
    } catch (err) {
      return this.markFailed(
        running.id,
        err instanceof Error ? err.message : String(err),
        maxAttempts,
      );
    }
  }

  clear(): void {
    const db = this.requireDb();
    db.prepare('DELETE FROM consolidation_jobs').run();
  }

  private requireDb(): Database.Database {
    if (!this.db) {
      throw new Error('ConsolidationQueue requires an attached SQLite database');
    }
    return this.db;
  }

  private getRow(id: string): ConsolidationJobRow | null {
    const db = this.requireDb();
    const row = db.prepare('SELECT * FROM consolidation_jobs WHERE id = ?').get(id) as
      | ConsolidationJobRow
      | undefined;
    return row ?? null;
  }
}

function isMaintenanceKind(kind: JobKind): kind is MaintenanceJobKind {
  return (
    kind === 'novelty_rescoring' ||
    kind === 'hebbian_reinforcement' ||
    kind === 'stale_construct_detection' ||
    kind === 'cue_alias_learning' ||
    kind === 'pattern_separation_cleanup'
  );
}

function queueForKind(kind: JobKind): 'abstraction' | 'maintenance' {
  return isMaintenanceKind(kind) ? 'maintenance' : 'abstraction';
}

function queueClause(queue: 'abstraction' | 'maintenance' | undefined): string {
  if (!queue) return '';
  const placeholders = queueKinds(queue).map(() => '?').join(', ');
  return `AND kind IN (${placeholders})`;
}

function queueParams(queue: 'abstraction' | 'maintenance' | undefined): readonly string[] {
  return queue ? queueKinds(queue) : [];
}

function queueKinds(queue: 'abstraction' | 'maintenance'): readonly JobKind[] {
  return queue === 'maintenance'
    ? [
        'novelty_rescoring',
        'hebbian_reinforcement',
        'stale_construct_detection',
        'cue_alias_learning',
        'pattern_separation_cleanup',
      ]
    : [
        'gist_refinement',
        'prototype_induction',
        'schema_induction',
        'alias_generation',
      ];
}

function rowToJob<TPayload = Record<string, unknown>>(
  row: ConsolidationJobRow,
): ConsolidationJob<TPayload> {
  return {
    id: row.id,
    kind: row.kind as JobKind,
    queue: queueForKind(row.kind as JobKind),
    payload: JSON.parse(row.payload) as TPayload,
    userId: row.user_id,
    dedupKey: row.dedup_key ?? undefined,
    enqueuedAt: row.created_at,
    generationVersion: 1,
    status: row.status,
    lastError: row.last_error ?? undefined,
    attempts: row.attempts,
  };
}
