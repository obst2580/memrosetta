#!/usr/bin/env node

import { parseGlobalArgs } from './parser.js';
import { outputError } from './output.js';
import { closeEngine } from './engine.js';

const HELP_TEXT = `memrosetta - AI long-term memory engine CLI

Usage: memrosetta <command> [options]

Commands:
  init             Initialize database and integrations
  status           Show database and integration status
  reset            Remove integrations
  store            Store a memory
  search           Search memories
  ingest           Ingest conversation from JSONL transcript
  get              Get memory by ID
  count            Count memories for a user
  clear            Clear all memories for a user
  relate           Create a relation between memories
  invalidate       Mark a memory as invalidated
  working-memory   Show working memory for a user
  maintain         Run maintenance (recompute scores, update tiers, compress)
  compress         Run compression only

Init Options:
  --claude-code       Set up Claude Code hooks + MCP + CLAUDE.md
  --cursor            Set up Cursor MCP config (~/.cursor/mcp.json)
  --mcp               Set up generic MCP server (~/.mcp.json)

Reset Options:
  --claude-code       Remove Claude Code hooks + MCP + CLAUDE.md section
  --cursor            Remove Cursor MCP config
  --mcp               Remove generic MCP config
  --all               Remove all integrations

Global Options:
  --db <path>         Database path (default: ~/.memrosetta/memories.db)
  --format <type>     Output format: json (default), text
  --no-embeddings     Disable vector embeddings (FTS-only search)
  --help, -h          Show help
  --version, -v       Show version

Examples:
  memrosetta init                          # Initialize DB only
  memrosetta init --claude-code            # DB + Claude Code hooks + MCP
  memrosetta init --cursor                 # DB + Cursor MCP
  memrosetta init --mcp                    # DB + generic MCP
  memrosetta status --format text          # Show all status
  memrosetta reset --claude-code           # Remove Claude Code integration
  memrosetta reset --all                   # Remove all integrations
  memrosetta store --user obst --content "Prefers TypeScript" --type preference
  memrosetta search --user obst --query "language preference" --format text
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
      case 'invalidate': {
        const mod = await import('./commands/invalidate.js');
        await mod.run(commandOptions);
        break;
      }
      case 'working-memory': {
        const mod = await import('./commands/working-memory.js');
        await mod.run(commandOptions);
        break;
      }
      case 'maintain': {
        const mod = await import('./commands/maintain.js');
        await mod.run(commandOptions);
        break;
      }
      case 'compress': {
        const mod = await import('./commands/compress.js');
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
      case 'reset': {
        const mod = await import('./commands/reset.js');
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
