import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import type { ISyncStorage } from './storage.js';

const SYNC_PORT = parseInt(process.env.SYNC_PORT ?? '8081', 10);
const DATABASE_URL = process.env.DATABASE_URL ?? '';

async function main(): Promise<void> {
  if (!DATABASE_URL) {
    process.stderr.write('[sync-server] DATABASE_URL is not set. Provide a storage implementation.\n');
    process.exit(1);
  }

  // Storage must be provided externally (e.g. from @memrosetta/postgres)
  // For standalone usage, import and instantiate a concrete ISyncStorage here.
  //
  // Example:
  //   import { PostgresSyncStorage } from '@memrosetta/postgres';
  //   const storage = new PostgresSyncStorage({ connectionString: DATABASE_URL });
  //
  // For now, we require the caller to use createApp() programmatically.
  process.stderr.write(
    '[sync-server] No built-in storage. Use createApp(storage) programmatically,\n' +
    '              or set up a concrete ISyncStorage and update this entry point.\n',
  );
  process.exit(1);
}

export async function startServer(storage: ISyncStorage): Promise<void> {
  await storage.initialize();
  process.stdout.write(`[sync-server] Storage initialized\n`);

  const app = createApp(storage);

  process.stdout.write(`[sync-server] Sync server running on http://localhost:${SYNC_PORT}\n`);
  serve({
    fetch: app.fetch,
    port: SYNC_PORT,
    hostname: process.env.HOST ?? '127.0.0.1',
  });
}

// If run directly (not imported), attempt standalone boot
const isDirectRun = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isDirectRun) {
  main().catch((err: unknown) => {
    process.stderr.write(`[sync-server] Failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

export { createApp } from './app.js';
export type { SyncAppContext } from './app.js';
export type { ISyncStorage } from './storage.js';
