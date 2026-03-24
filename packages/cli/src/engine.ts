import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';

const DEFAULT_DB = join(homedir(), '.memrosetta', 'memories.db');

let cachedEngine: Awaited<ReturnType<typeof createEngineInstance>> | null =
  null;
let cachedDbPath: string | null = null;

interface EngineOptions {
  readonly db?: string;
  readonly noEmbeddings?: boolean;
}

async function createEngineInstance(options: EngineOptions) {
  const dbPath = options.db ?? DEFAULT_DB;

  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const { SqliteMemoryEngine } = await import('@memrosetta/core');

  let embedder;
  if (!options.noEmbeddings) {
    try {
      const { HuggingFaceEmbedder } = await import('@memrosetta/embeddings');
      embedder = new HuggingFaceEmbedder();
      await embedder.initialize();
    } catch {
      // Embeddings not available, proceed with FTS-only
    }
  }

  const engine = new SqliteMemoryEngine({ dbPath, embedder });
  await engine.initialize();
  return engine;
}

export async function getEngine(options: EngineOptions) {
  const dbPath = options.db ?? DEFAULT_DB;

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

export async function closeEngine(): Promise<void> {
  if (cachedEngine) {
    await cachedEngine.close();
    cachedEngine = null;
    cachedDbPath = null;
  }
}
