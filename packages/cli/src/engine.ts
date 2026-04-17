import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';
import { getConfig } from './hooks/config.js';

const DEFAULT_DB = join(homedir(), '.memrosetta', 'memories.db');

let cachedEngine: Awaited<ReturnType<typeof createEngineInstance>> | null =
  null;
let cachedDbPath: string | null = null;

interface EngineOptions {
  readonly db?: string;
  /**
   * @deprecated v0.11: kept for backwards-compatible CLI flag parsing.
   * HF embedder + sqlite-vec paths were removed; this flag is now a
   * no-op. Retained so `--no-embeddings` does not break existing usage.
   */
  readonly noEmbeddings?: boolean;
}

async function createEngineInstance(options: EngineOptions) {
  const config = getConfig();
  const dbPath = options.db ?? config.dbPath ?? DEFAULT_DB;

  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const { SqliteMemoryEngine } = await import('@memrosetta/core');

  const engine = new SqliteMemoryEngine({ dbPath });
  await engine.initialize();
  return engine;
}

export async function getEngine(options: EngineOptions) {
  const config = getConfig();
  const dbPath = options.db ?? config.dbPath ?? DEFAULT_DB;

  if (cachedEngine && cachedDbPath === dbPath) {
    return cachedEngine;
  }

  cachedEngine = await createEngineInstance(options);
  cachedDbPath = dbPath;
  return cachedEngine;
}

export function getDefaultDbPath(): string {
  return DEFAULT_DB;
}

export function resolveDbPath(dbOverride?: string): string {
  const config = getConfig();
  return dbOverride ?? config.dbPath ?? DEFAULT_DB;
}

export async function closeEngine(): Promise<void> {
  if (cachedEngine) {
    await cachedEngine.close();
    cachedEngine = null;
    cachedDbPath = null;
  }
}
