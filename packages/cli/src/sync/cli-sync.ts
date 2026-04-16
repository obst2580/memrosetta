/**
 * Shared sync glue for CLI commands.
 *
 * Each CLI subcommand (store / relate / invalidate / feedback) is a
 * short-lived process, so we cannot keep a long-lived SyncClient around the
 * way the MCP adapter does. Instead we spin up a SyncClient when sync is
 * enabled in config, record the op into the outbox after the engine write
 * succeeds, and close the dedicated DB handle on exit.
 *
 * Enqueue failures are non-fatal — the local SQLite write has already
 * committed by the time we get here, and the primary guarantee is
 * local-first.
 */

import { createHash, randomUUID } from 'node:crypto';
import type {
  Memory,
  MemoryRelation,
  SyncOp,
} from '@memrosetta/types';
import { getConfig, resolveCanonicalUserId, type MemRosettaConfig } from '../hooks/config.js';

/**
 * Deterministic opId helper used by backfill: same (kind, key) always
 * hashes to the same id so re-running backfill does not inflate the
 * outbox or the server log.
 */
export function deterministicOpId(kind: string, key: string): string {
  const hash = createHash('sha256').update(`${kind}:${key}`).digest('hex');
  // Format as op-<16-hex> so it is visually distinct from uuid-v4 ops.
  return `op-${hash.slice(0, 16)}`;
}

export interface CliSyncContext {
  readonly enabled: boolean;
  readonly userId: string;
  readonly deviceId: string;
  enqueue(op: SyncOp): void;
  close(): void;
}

const DISABLED: CliSyncContext = {
  enabled: false,
  userId: '',
  deviceId: '',
  enqueue(): void {},
  close(): void {},
};

/**
 * Load sync config and, if enabled, open a SyncClient bound to the same
 * SQLite file the engine uses. Returns a `DISABLED` no-op context when sync
 * is not configured so callers can treat the return value uniformly.
 */
export async function openCliSyncContext(dbPath: string): Promise<CliSyncContext> {
  const config = getConfig() as MemRosettaConfig;

  if (!config.syncEnabled || !config.syncServerUrl || !config.syncApiKey || !config.syncDeviceId) {
    return DISABLED;
  }

  const userId = resolveCanonicalUserId();
  const deviceId = config.syncDeviceId;

  try {
    const { default: Database } = await import('better-sqlite3');
    const { SyncClient, ensureSyncSchema } = await import('@memrosetta/sync-client');

    const db = new Database(dbPath);
    ensureSyncSchema(db);

    const client = new SyncClient(db, {
      serverUrl: config.syncServerUrl,
      apiKey: config.syncApiKey,
      deviceId,
      userId,
    });
    const outbox = client.getOutbox();

    return {
      enabled: true,
      userId,
      deviceId,
      enqueue(op): void {
        try {
          outbox.addOp(op);
        } catch (err) {
          process.stderr.write(
            `[sync] enqueue failed: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      },
      close(): void {
        try {
          db.close();
        } catch {
          // ignore
        }
      },
    };
  } catch (err) {
    // If anything in the sync bootstrap fails we log once and degrade to
    // DISABLED so the CLI command still finishes.
    process.stderr.write(
      `[sync] disabled for this command: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return DISABLED;
  }
}

// ---------------------------------------------------------------------------
// Op builders
// ---------------------------------------------------------------------------

export function buildMemoryCreatedOp(
  ctx: CliSyncContext,
  memory: Memory,
): SyncOp {
  return {
    opId: randomUUID(),
    opType: 'memory_created',
    deviceId: ctx.deviceId,
    userId: ctx.userId,
    createdAt: new Date().toISOString(),
    payload: {
      memoryId: memory.memoryId,
      userId: memory.userId,
      namespace: memory.namespace,
      memoryType: memory.memoryType,
      content: memory.content,
      rawText: memory.rawText,
      documentDate: memory.documentDate,
      sourceId: memory.sourceId,
      confidence: memory.confidence,
      salience: memory.salience,
      keywords: memory.keywords,
      eventDateStart: memory.eventDateStart,
      eventDateEnd: memory.eventDateEnd,
      invalidatedAt: memory.invalidatedAt,
      learnedAt: memory.learnedAt,
    },
  };
}

export function buildRelationCreatedOp(
  ctx: CliSyncContext,
  relation: MemoryRelation,
): SyncOp {
  return {
    opId: randomUUID(),
    opType: 'relation_created',
    deviceId: ctx.deviceId,
    userId: ctx.userId,
    createdAt: new Date().toISOString(),
    payload: {
      srcMemoryId: relation.srcMemoryId,
      dstMemoryId: relation.dstMemoryId,
      relationType: relation.relationType,
      reason: relation.reason,
      createdAt: relation.createdAt,
    },
  };
}

export function buildMemoryInvalidatedOp(
  ctx: CliSyncContext,
  memoryId: string,
  invalidatedAt: string,
  reason?: string,
): SyncOp {
  return {
    opId: randomUUID(),
    opType: 'memory_invalidated',
    deviceId: ctx.deviceId,
    userId: ctx.userId,
    createdAt: invalidatedAt,
    payload: { memoryId, invalidatedAt, reason },
  };
}

export function buildFeedbackGivenOp(
  ctx: CliSyncContext,
  memoryId: string,
  helpful: boolean,
  recordedAt: string,
): SyncOp {
  return {
    opId: randomUUID(),
    opType: 'feedback_given',
    deviceId: ctx.deviceId,
    userId: ctx.userId,
    createdAt: recordedAt,
    payload: { memoryId, helpful, recordedAt },
  };
}
