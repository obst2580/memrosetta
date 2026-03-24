#!/usr/bin/env node

import { parseGlobalArgs } from './parser.js';
import { outputError } from './output.js';
import { closeEngine } from './engine.js';

const HELP_TEXT = `memrosetta - AI long-term memory engine CLI

Usage: memrosetta <command> [options]

Commands:
  store       Store a memory
  search      Search memories
  ingest      Ingest conversation from JSONL transcript
  get         Get memory by ID
  count       Count memories for a user
  clear       Clear all memories for a user
  relate      Create a relation between memories
  status      Show database status
  init        Initialize database

Global Options:
  --db <path>         Database path (default: ~/.memrosetta/memories.db)
  --format <type>     Output format: json (default), text
  --no-embeddings     Disable vector embeddings (FTS-only search)
  --help, -h          Show help
  --version, -v       Show version

Examples:
  memrosetta init
  memrosetta store --user obst --content "Prefers TypeScript" --type preference
  memrosetta search --user obst --query "language preference" --format text
  memrosetta ingest --user obst --file session.jsonl
  memrosetta count --user obst
  memrosetta status
`;

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const { command, global: opts, rest } = parseGlobalArgs(rawArgs);

  if (opts.version) {
    process.stdout.write('0.1.0\n');
    return;
  }

  if (opts.help || !command) {
    process.stdout.write(HELP_TEXT);
    if (!command && !opts.help) {
      process.exitCode = 1;
    }
    return;
  }

  const commandOptions = {
    args: rest,
    format: opts.format,
    db: opts.db,
    noEmbeddings: opts.noEmbeddings,
  };

  try {
    switch (command) {
      case 'store': {
        const mod = await import('./commands/store.js');
        await mod.run(commandOptions);
        break;
      }
      case 'search': {
        const mod = await import('./commands/search.js');
        await mod.run(commandOptions);
        break;
      }
      case 'ingest': {
        const mod = await import('./commands/ingest.js');
        await mod.run(commandOptions);
        break;
      }
      case 'get': {
        const mod = await import('./commands/get.js');
        await mod.run(commandOptions);
        break;
      }
      case 'count': {
        const mod = await import('./commands/count.js');
        await mod.run(commandOptions);
        break;
      }
      case 'clear': {
        const mod = await import('./commands/clear.js');
        await mod.run(commandOptions);
        break;
      }
      case 'relate': {
        const mod = await import('./commands/relate.js');
        await mod.run(commandOptions);
        break;
      }
      case 'status': {
        const mod = await import('./commands/status.js');
        await mod.run(commandOptions);
        break;
      }
      case 'init': {
        const mod = await import('./commands/init.js');
        await mod.run(commandOptions);
        break;
      }
      default:
        outputError(`Unknown command: ${command}`, opts.format);
        process.exitCode = 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outputError(message, opts.format);
    process.exitCode = 1;
  } finally {
    await closeEngine();
  }
}

main();
