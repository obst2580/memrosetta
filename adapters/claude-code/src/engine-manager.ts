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
 * the given timeout in milliseconds. Used by the on-prompt hook to
 * avoid blocking Claude Code if embedding model loading is slow.
 */
export async function getEngineWithTimeout(
  timeoutMs: number,
): Promise<SqliteMemoryEngine | null> {
  const enginePromise = getEngine();
  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), timeoutMs),
  );
  return Promise.race([enginePromise, timeoutPromise]);
}
