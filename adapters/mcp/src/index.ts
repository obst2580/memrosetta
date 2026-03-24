#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SqliteMemoryEngine } from '@memrosetta/core';
import { HuggingFaceEmbedder } from '@memrosetta/embeddings';
import { registerTools } from './tools.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

const DB_PATH =
  process.env.MEMROSETTA_DB ??
  `${homedir()}/.memrosetta/memories.db`;

const ENABLE_EMBEDDINGS = process.env.MEMROSETTA_EMBEDDINGS !== 'false';

async function main(): Promise<void> {
  // Ensure DB directory exists
  mkdirSync(dirname(DB_PATH), { recursive: true });

  // Initialize embedder (optional)
  let embedder: HuggingFaceEmbedder | undefined;
  if (ENABLE_EMBEDDINGS) {
    embedder = new HuggingFaceEmbedder();
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
    { name: 'memrosetta', version: '0.1.0' },
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
