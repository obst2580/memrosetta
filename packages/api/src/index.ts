import { serve } from '@hono/node-server';
import { SqliteMemoryEngine } from '@memrosetta/core';
import { createApp } from './app.js';

const PORT = parseInt(process.env.PORT ?? '3100', 10);
const DB_PATH = process.env.DB_PATH ?? './memrosetta.db';

function getApiKeysFromEnv(): string[] {
  const raw = process.env.MEMROSETTA_API_KEYS || process.env.SERVICE_KEY || '';
  return raw.split(',').map(key => key.trim()).filter(Boolean);
}

async function main(): Promise<void> {
  // v0.11: HF embedder removed. Core is LLM-free.
  const engine = new SqliteMemoryEngine({ dbPath: DB_PATH });
  await engine.initialize();
  process.stdout.write(`Database initialized: ${DB_PATH}\n`);

  // Create and start server
  const apiKeys = getApiKeysFromEnv();
  if (apiKeys.length > 0) {
    process.stdout.write(`API key auth enabled with ${apiKeys.length} configured key(s)\n`);
  }
  const app = createApp(engine, { apiKeys });

  process.stdout.write(`MemRosetta API running on http://localhost:${PORT}\n`);
  serve({
    fetch: app.fetch,
    port: PORT,
    hostname: process.env.HOST ?? '127.0.0.1',
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`Failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

export { createApp } from './app.js';
export type { AppContext } from './app.js';
