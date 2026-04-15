/**
 * Standalone entry point for Azure App Service / Docker / direct deployment.
 *
 * Reads DATABASE_URL, creates PostgresSyncStorage, runs migrations,
 * and starts the Hono sync server.
 *
 * Usage:
 *   node dist/standalone.js
 *
 * Required env:
 *   DATABASE_URL   - PostgreSQL connection string
 *
 * Optional env:
 *   PORT                        - Server port (default: 8081)
 *   HOST                        - Bind address (default: 0.0.0.0)
 *   MEMROSETTA_API_KEYS         - Comma-separated API keys
 *   PG_SSL_REJECT_UNAUTHORIZED  - SSL setting (default: false)
 *   PG_POOL_SIZE                - Connection pool size (default: 10)
 *   CORS_ORIGINS                - Comma-separated allowed origins
 */

import { serve } from '@hono/node-server';
import { PostgresSyncStorage } from '@memrosetta/postgres';
import { createApp } from './app.js';

const PORT = parseInt(process.env.PORT ?? process.env.SYNC_PORT ?? '8081', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATABASE_URL = process.env.DATABASE_URL ?? '';

async function main(): Promise<void> {
  if (!DATABASE_URL) {
    process.stderr.write(
      '[sync-server] ERROR: DATABASE_URL is required.\n' +
      '[sync-server] Example: DATABASE_URL=postgresql://user:pass@host:5432/memrosetta_sync\n',
    );
    process.exit(1);
  }

  process.stdout.write('[sync-server] Initializing PostgreSQL storage...\n');

  const storage = new PostgresSyncStorage({
    databaseUrl: DATABASE_URL,
    sslRejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED === 'true',
    maxPoolSize: parseInt(process.env.PG_POOL_SIZE ?? '10', 10),
  });

  await storage.initialize();
  process.stdout.write('[sync-server] Migrations applied. Storage ready.\n');

  const app = createApp(storage);

  process.stdout.write(`[sync-server] Listening on http://${HOST}:${PORT}\n`);
  serve({ fetch: app.fetch, port: PORT, hostname: HOST });

  const shutdown = async (): Promise<void> => {
    process.stdout.write('[sync-server] Shutting down...\n');
    await storage.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[sync-server] Failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
