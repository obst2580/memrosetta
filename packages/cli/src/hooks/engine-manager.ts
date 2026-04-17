import { SqliteMemoryEngine } from '@memrosetta/core';
import { getConfig, ensureDir } from './config.js';

let engineInstance: SqliteMemoryEngine | null = null;

export async function getEngine(): Promise<SqliteMemoryEngine> {
  if (engineInstance) return engineInstance;

  const config = getConfig();
  ensureDir();

  engineInstance = new SqliteMemoryEngine({
    dbPath: config.dbPath,
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
