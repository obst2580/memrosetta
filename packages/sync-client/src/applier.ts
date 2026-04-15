import type Database from 'better-sqlite3';
import type { SyncPulledOp } from './types.js';

/**
 * Applies pulled sync ops to the local SQLite `memories` + `memory_relations`
 * tables.
 *
 * Intentionally separate from `SyncClient` / `Inbox` so the transport layer
 * stays ignorant of the engine schema. Anything that pulls ops from an inbox
 * can call `applyInboxOps(db, ops)` to fold them into the local memory graph.
 *
 * All writes are idempotent:
 *   - `memory_created`  INSERT OR IGNORE on `memory_id`
 *   - `relation_created` INSERT OR IGNORE on the (src, dst, type) PK
 *   - `memory_invalidated` UPDATE of `invalidated_at`
 *   - `feedback_given`  additive UPDATE of `use_count` / `success_count`
 *   - `memory_tier_set` UPDATE of `tier`
 */

export interface ApplyResult {
  readonly applied: readonly string[];
  readonly skipped: readonly { readonly opId: string; readonly reason: string }[];
}

interface MemoryCreatedPayload {
  readonly memoryId: string;
  readonly userId: string;
  readonly namespace?: string;
  readonly memoryType: string;
  readonly content: string;
  readonly rawText?: string;
  readonly documentDate?: string;
  readonly sourceId?: string;
  readonly confidence?: number;
  readonly salience?: number;
  readonly keywords?: readonly string[];
  readonly eventDateStart?: string;
  readonly eventDateEnd?: string;
  readonly invalidatedAt?: string;
  readonly learnedAt: string;
}

interface RelationCreatedPayload {
  readonly srcMemoryId: string;
  readonly dstMemoryId: string;
  readonly relationType: string;
  readonly reason?: string;
  readonly createdAt: string;
}

interface MemoryInvalidatedPayload {
  readonly memoryId: string;
  readonly invalidatedAt: string;
  readonly reason?: string;
}

interface FeedbackGivenPayload {
  readonly memoryId: string;
  readonly helpful: boolean;
  readonly recordedAt: string;
}

interface MemoryTierSetPayload {
  readonly memoryId: string;
  readonly tier: 'hot' | 'warm' | 'cold';
  readonly recordedAt: string;
}

function parsePayload<T>(payload: unknown): T {
  if (typeof payload === 'string') {
    return JSON.parse(payload) as T;
  }
  return payload as T;
}

function applyMemoryCreated(db: Database.Database, op: SyncPulledOp): void {
  const p = parsePayload<MemoryCreatedPayload>(op.payload);
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO memories (
       memory_id, user_id, namespace, memory_type, content, raw_text,
       document_date, learned_at, source_id, confidence, salience,
       is_latest, keywords, event_date_start, event_date_end,
       invalidated_at, tier, activation_score, access_count,
       use_count, success_count
     ) VALUES (
       @memory_id, @user_id, @namespace, @memory_type, @content, @raw_text,
       @document_date, @learned_at, @source_id, @confidence, @salience,
       1, @keywords, @event_date_start, @event_date_end,
       @invalidated_at, 'warm', 1.0, 0,
       0, 0
     )`,
  );
  stmt.run({
    memory_id: p.memoryId,
    user_id: p.userId,
    namespace: p.namespace ?? null,
    memory_type: p.memoryType,
    content: p.content,
    raw_text: p.rawText ?? null,
    document_date: p.documentDate ?? null,
    learned_at: p.learnedAt,
    source_id: p.sourceId ?? null,
    confidence: p.confidence ?? 1.0,
    salience: p.salience ?? 1.0,
    keywords: p.keywords ? JSON.stringify(p.keywords) : null,
    event_date_start: p.eventDateStart ?? null,
    event_date_end: p.eventDateEnd ?? null,
    invalidated_at: p.invalidatedAt ?? null,
  });
}

function applyRelationCreated(db: Database.Database, op: SyncPulledOp): void {
  const p = parsePayload<RelationCreatedPayload>(op.payload);
  db.prepare(
    `INSERT OR IGNORE INTO memory_relations (
       src_memory_id, dst_memory_id, relation_type, created_at, reason
     ) VALUES (?, ?, ?, ?, ?)`,
  ).run(p.srcMemoryId, p.dstMemoryId, p.relationType, p.createdAt, p.reason ?? null);

  // `updates` relations also flip the destination's is_latest flag, matching
  // what `engine.relate()` does when called locally.
  if (p.relationType === 'updates') {
    db.prepare('UPDATE memories SET is_latest = 0 WHERE memory_id = ?').run(
      p.dstMemoryId,
    );
  }
}

function applyMemoryInvalidated(db: Database.Database, op: SyncPulledOp): void {
  const p = parsePayload<MemoryInvalidatedPayload>(op.payload);
  db.prepare(
    'UPDATE memories SET invalidated_at = ? WHERE memory_id = ?',
  ).run(p.invalidatedAt, p.memoryId);
}

function applyFeedbackGiven(db: Database.Database, op: SyncPulledOp): void {
  const p = parsePayload<FeedbackGivenPayload>(op.payload);
  if (p.helpful) {
    db.prepare(
      'UPDATE memories SET use_count = use_count + 1, success_count = success_count + 1 WHERE memory_id = ?',
    ).run(p.memoryId);
  } else {
    db.prepare(
      'UPDATE memories SET use_count = use_count + 1 WHERE memory_id = ?',
    ).run(p.memoryId);
  }
}

function applyMemoryTierSet(db: Database.Database, op: SyncPulledOp): void {
  const p = parsePayload<MemoryTierSetPayload>(op.payload);
  db.prepare('UPDATE memories SET tier = ? WHERE memory_id = ?').run(
    p.tier,
    p.memoryId,
  );
}

/**
 * Apply a batch of pulled ops into the local memories/relations tables.
 *
 * The caller is responsible for passing only ops that have not been applied
 * yet. `Inbox.getPending()` returns exactly that set.
 */
export function applyInboxOps(
  db: Database.Database,
  ops: readonly SyncPulledOp[],
): ApplyResult {
  const applied: string[] = [];
  const skipped: { opId: string; reason: string }[] = [];

  const runAll = db.transaction((batch: readonly SyncPulledOp[]) => {
    for (const op of batch) {
      try {
        switch (op.opType) {
          case 'memory_created':
            applyMemoryCreated(db, op);
            break;
          case 'relation_created':
            applyRelationCreated(db, op);
            break;
          case 'memory_invalidated':
            applyMemoryInvalidated(db, op);
            break;
          case 'feedback_given':
            applyFeedbackGiven(db, op);
            break;
          case 'memory_tier_set':
            applyMemoryTierSet(db, op);
            break;
          default:
            skipped.push({ opId: op.opId, reason: `unknown op type: ${op.opType}` });
            continue;
        }
        applied.push(op.opId);
      } catch (err) {
        // A bad payload should not abort the whole batch; record the skip
        // and continue so the good ops still land.
        skipped.push({
          opId: op.opId,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  runAll(ops);

  return { applied, skipped };
}
