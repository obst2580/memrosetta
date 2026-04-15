#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SqliteMemoryEngine } from '@memrosetta/core';
import { HuggingFaceEmbedder } from '@memrosetta/embeddings';
import { SyncClient, ensureSyncSchema } from '@memrosetta/sync-client';
import { registerTools } from './tools.js';
import type { SyncRecorder } from './sync-recorder.js';
import type { Memory, MemoryRelation, SyncOp } from '@memrosetta/types';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const VERSION = '0.3.0';

interface MemRosettaConfig {
  readonly dbPath?: string;
  readonly enableEmbeddings?: boolean;
  readonly embeddingPreset?: string;
  readonly syncEnabled?: boolean;
  readonly syncServerUrl?: string;
  readonly syncApiKey?: string;
  readonly syncDeviceId?: string;
}

function readConfig(): MemRosettaConfig {
  const configPath = join(homedir(), '.memrosetta', 'config.json');
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as MemRosettaConfig;
  } catch { return {}; }
}

function writeConfig(config: MemRosettaConfig): void {
  const configDir = join(homedir(), '.memrosetta');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify(config, null, 2),
    'utf-8',
  );
}

function ensureDeviceId(config: MemRosettaConfig): { readonly config: MemRosettaConfig; readonly deviceId: string } {
  if (config.syncDeviceId) {
    return { config, deviceId: config.syncDeviceId };
  }
  const deviceId = `device-${randomUUID().slice(0, 8)}`;
  const updated = { ...config, syncDeviceId: deviceId };
  writeConfig(updated);
  return { config: updated, deviceId };
}

function createSyncRecorder(syncClient: SyncClient, deviceId: string): SyncRecorder {
  const userId = process.env.USER ?? process.env.USERNAME ?? 'unknown';
  const outbox = syncClient.getOutbox();

  function enqueue(op: SyncOp): void {
    try {
      outbox.addOp(op);
    } catch (err) {
      process.stderr.write(`[sync] enqueue failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  return {
    recordMemoryCreated(memory: Memory): void {
      enqueue({
        opId: randomUUID(),
        opType: 'memory_created',
        deviceId,
        userId,
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
      });
    },

    recordRelationCreated(relation: MemoryRelation): void {
      enqueue({
        opId: randomUUID(),
        opType: 'relation_created',
        deviceId,
        userId,
        createdAt: new Date().toISOString(),
        payload: {
          srcMemoryId: relation.srcMemoryId,
          dstMemoryId: relation.dstMemoryId,
          relationType: relation.relationType,
          reason: relation.reason,
          createdAt: relation.createdAt,
        },
      });
    },

    recordMemoryInvalidated(memoryId: string, invalidatedAt: string, reason?: string): void {
      enqueue({
        opId: randomUUID(),
        opType: 'memory_invalidated',
        deviceId,
        userId,
        createdAt: invalidatedAt,
        payload: { memoryId, invalidatedAt, reason },
      });
    },

    recordFeedbackGiven(memoryId: string, helpful: boolean, recordedAt: string): void {
      enqueue({
        opId: randomUUID(),
        opType: 'feedback_given',
        deviceId,
        userId,
        createdAt: recordedAt,
        payload: { memoryId, helpful, recordedAt },
      });
    },
  };
}

const config = readConfig();

const DB_PATH =
  process.env.MEMROSETTA_DB ??
  config.dbPath ??
  join(homedir(), '.memrosetta', 'memories.db');

const ENABLE_EMBEDDINGS =
  process.env.MEMROSETTA_EMBEDDINGS !== 'false' &&
  config.enableEmbeddings !== false;

const EMBEDDING_PRESET =
  config.embeddingPreset ?? 'en';

async function main(): Promise<void> {
  mkdirSync(dirname(DB_PATH), { recursive: true });

  // Initialize embedder (optional)
  let embedder: HuggingFaceEmbedder | undefined;
  if (ENABLE_EMBEDDINGS) {
    embedder = new HuggingFaceEmbedder({ preset: EMBEDDING_PRESET as 'en' | 'multilingual' | 'ko' });
    await embedder.initialize();
  }

  // Initialize engine
  const engine = new SqliteMemoryEngine({ dbPath: DB_PATH, embedder });
  await engine.initialize();

  // Initialize sync (optional)
  let syncRecorder: SyncRecorder | undefined;
  const syncEnabled = config.syncEnabled && config.syncServerUrl && config.syncApiKey;

  if (syncEnabled) {
    const { deviceId } = ensureDeviceId(config);

    // Open a second connection to the same SQLite file for sync tables
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(DB_PATH);
    ensureSyncSchema(db);

    const syncClient = new SyncClient(db, {
      serverUrl: config.syncServerUrl!,
      apiKey: config.syncApiKey!,
      deviceId,
    });

    syncRecorder = createSyncRecorder(syncClient, deviceId);

    // Background push every 5 minutes
    setInterval(async () => {
      try {
        const result = await syncClient.push();
        if (result.pushed > 0) {
          process.stderr.write(`[sync] Pushed ${result.pushed} ops\n`);
        }
      } catch (err) {
        process.stderr.write(`[sync] Push failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }, 5 * 60 * 1000);

    process.stderr.write(`[sync] Enabled. Server: ${config.syncServerUrl}, Device: ${deviceId}\n`);
  }

  // Create MCP server
  const server = new Server(
    { name: 'memrosetta', version: VERSION },
    { capabilities: { tools: {} } },
  );

  registerTools(server, engine, syncRecorder);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MemRosetta MCP error: ${String(err)}\n`);
  process.exit(1);
});
