#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'node:module';
import { SqliteMemoryEngine } from '@memrosetta/core';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
import { HuggingFaceEmbedder } from '@memrosetta/embeddings';
import { registerTools } from './tools.js';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

function readConfig(): Record<string, unknown> {
  const configPath = join(homedir(), '.memrosetta', 'config.json');
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  } catch { return {}; }
}

const config = readConfig();

const DB_PATH =
  process.env.MEMROSETTA_DB ??
  (config.dbPath as string | undefined) ??
  join(homedir(), '.memrosetta', 'memories.db');

const ENABLE_EMBEDDINGS =
  process.env.MEMROSETTA_EMBEDDINGS !== 'false' &&
  config.enableEmbeddings !== false;

const EMBEDDING_PRESET =
  (config.embeddingPreset as string | undefined) ?? 'en';

async function main(): Promise<void> {
  // Ensure DB directory exists
  mkdirSync(dirname(DB_PATH), { recursive: true });

  // Initialize embedder (optional)
  let embedder: HuggingFaceEmbedder | undefined;
  if (ENABLE_EMBEDDINGS) {
    embedder = new HuggingFaceEmbedder({ preset: EMBEDDING_PRESET as 'en' | 'multilingual' | 'ko' });
    await embedder.initialize();
  }

  // Initialize engine
  const engine = new SqliteMemoryEngine({
    dbPath: DB_PATH,
    embedder,
  });
  await engine.initialize();

  // Create MCP server
  const server = new Server(
    { name: 'memrosetta', version: pkg.version },
    { capabilities: { tools: {} } },
  );

  // Register tools
  registerTools(server, engine);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MemRosetta MCP error: ${String(err)}\n`);
  process.exit(1);
});
