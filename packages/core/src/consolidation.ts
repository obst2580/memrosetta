import type Database from 'better-sqlite3';

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
 * Layer B flag-gates the actual execution. This module only provides
 * the queue scaffolding, job-shape types, and the in-memory runner
 * so tests can validate enqueue/dequeue semantics.
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

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ConsolidationJob<TPayload = Record<string, unknown>> {
  readonly id: string;
  readonly kind: JobKind;
  readonly queue: 'abstraction' | 'maintenance';
  readonly payload: TPayload;
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

/**
 * In-memory queue. Persistent backing is a future Layer B followup
 * (`consolidation_jobs` table) — Step 8 scaffolding ships the
 * interface so the engine / tests have something to attach to.
 */
export class ConsolidationQueue {
  private readonly jobs: ConsolidationJob[] = [];
  private readonly handlers = new Map<JobKind, JobHandler>();
  private nextId = 1;

  register(kind: JobKind, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  enqueue<T extends Record<string, unknown>>(input: {
    readonly kind: JobKind;
    readonly payload: T;
    readonly generationVersion?: number;
  }): ConsolidationJob<T> {
    const queue: 'abstraction' | 'maintenance' = isMaintenanceKind(input.kind)
      ? 'maintenance'
      : 'abstraction';
    const job: ConsolidationJob<T> = {
      id: `job-${this.nextId++}`,
      kind: input.kind,
      queue,
      payload: input.payload,
      enqueuedAt: new Date().toISOString(),
      generationVersion: input.generationVersion ?? 1,
      status: 'pending',
      attempts: 0,
    };
    this.jobs.push(job as ConsolidationJob);
    return job;
  }

  pending(queue?: 'abstraction' | 'maintenance'): readonly ConsolidationJob[] {
    return this.jobs.filter(
      (j) => j.status === 'pending' && (!queue || j.queue === queue),
    );
  }

  size(): number {
    return this.jobs.length;
  }

  /**
   * Idempotent runner. Each job runs once; on success it transitions
   * to 'completed'. On failure it transitions to 'failed' and records
   * the error. Re-running is the caller's responsibility so Layer B
   * can pick resume/retry policies per kind.
   */
  async runNext(
    db: Database.Database,
    queue: 'abstraction' | 'maintenance',
  ): Promise<ConsolidationJob | null> {
    const idx = this.jobs.findIndex(
      (j) => j.status === 'pending' && j.queue === queue,
    );
    if (idx === -1) return null;

    const job = this.jobs[idx];
    const handler = this.handlers.get(job.kind);
    if (!handler) {
      const failed: ConsolidationJob = {
        ...job,
        status: 'failed',
        lastError: `no handler registered for kind=${job.kind}`,
        attempts: job.attempts + 1,
      };
      this.jobs[idx] = failed;
      return failed;
    }

    const running: ConsolidationJob = {
      ...job,
      status: 'running',
      attempts: job.attempts + 1,
    };
    this.jobs[idx] = running;

    try {
      await handler(db, running);
      const done: ConsolidationJob = { ...running, status: 'completed' };
      this.jobs[idx] = done;
      return done;
    } catch (err) {
      const failed: ConsolidationJob = {
        ...running,
        status: 'failed',
        lastError: err instanceof Error ? err.message : String(err),
      };
      this.jobs[idx] = failed;
      return failed;
    }
  }

  clear(): void {
    this.jobs.length = 0;
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
