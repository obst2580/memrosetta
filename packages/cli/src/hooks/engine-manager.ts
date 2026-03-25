import { SqliteMemoryEngine } from '@memrosetta/core';
import { getConfig, ensureDir } from './config.js';

let engineInstance: SqliteMemoryEngine | null = null;

export async function getEngine(): Promise<SqliteMemoryEngine> {
  if (engineInstance) return engineInstance;

  const config = getConfig();
  ensureDir();

  let embedder;
  if (config.enableEmbeddings) {
    try {
      const { HuggingFaceEmbedder } = await import('@memrosetta/embeddings');
      embedder = new HuggingFaceEmbedder();
      await embedder.initialize();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[memrosetta] Failed to load embeddings, continuing without: ${message}\n`,
      );
    }
  }

  engineInstance = new SqliteMemoryEngine({
    dbPath: config.dbPath,
    embedder,
  });
  await engineInstance.initialize();
  return engineInstance;
}

export async function closeEngine(): Promise<void> {
  if (engineInstance) {
    await engineInstance.close();
    engineInstance = null;
  }
}

/**
 * Get engine with a timeout. Returns null if initialization exceeds
 * the given timeout in milliseconds.
 */
export async function getEngineWithTimeout(
  timeoutMs: number,
): Promise<SqliteMemoryEngine | null> {
  let timer: ReturnType<typeof setTimeout>;
  const enginePromise = getEngine();
  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const result = await Promise.race([enginePromise, timeoutPromise]);
  clearTimeout(timer!);
  return result;
}
