#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  ensureDir,
  getConfig,
  getConfigDir,
  getConfigPath,
  getDefaultDbPath,
  writeDefaultConfig,
} from './config.js';

const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
const MCP_CONFIG_PATH = join(homedir(), '.mcp.json');

interface HookEntry {
  readonly type: string;
  readonly command: string;
  readonly timeout?: number;
}

interface HookConfig {
  readonly matcher: string;
  readonly hooks: readonly HookEntry[];
}

interface ClaudeSettings {
  hooks?: Record<string, readonly HookConfig[]>;
  [key: string]: unknown;
}

interface McpConfig {
  mcpServers?: Record<string, unknown>;
}

function isMemrosettaHook(command: string): boolean {
  return command.includes('memrosetta') && (
    command.includes('on-stop') || command.includes('on-prompt')
  );
}

// --- File I/O helpers ---

function readClaudeSettings(): ClaudeSettings {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8')) as ClaudeSettings;
  } catch {
    return {};
  }
}

function writeClaudeSettings(settings: ClaudeSettings): void {
  const dir = join(homedir(), '.claude');
  if (!existsSync(dir)) {
    throw new Error('~/.claude directory does not exist. Is Claude Code installed?');
  }
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

function readMcpConfig(): McpConfig {
  if (!existsSync(MCP_CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(MCP_CONFIG_PATH, 'utf-8')) as McpConfig;
  } catch {
    return {};
  }
}

function writeMcpConfig(config: McpConfig): void {
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

// --- Commands ---

async function initCommand(): Promise<void> {
  const claudeDir = join(homedir(), '.claude');
  const hasClaudeCode = existsSync(claudeDir);

  // 1. Create ~/.memrosetta/ directory and default config
  ensureDir();
  writeDefaultConfig();

  let hookRegistered = false;
  let mcpRegistered = false;

  // 2. Register Stop hook in ~/.claude/settings.json (save on session end)
  if (hasClaudeCode) {
    const settings = readClaudeSettings();
    if (!settings.hooks) {
      settings.hooks = {};
    }

    // Remove any existing memrosetta hooks
    for (const [eventType, hookConfigs] of Object.entries(settings.hooks)) {
      const filtered = (hookConfigs as readonly HookConfig[]).filter(
        (hc) => !hc.hooks.some((h) => isMemrosettaHook(h.command)),
      );
      (settings.hooks as Record<string, unknown>)[eventType] = filtered;
    }

    // Add Stop hook only (search is handled by MCP, not hooks)
    const stopHookConfigs = (settings.hooks['Stop'] || []) as HookConfig[];
    (settings.hooks as Record<string, unknown>)['Stop'] = [
      ...stopHookConfigs,
      {
        matcher: '*',
        hooks: [
          {
            type: 'command',
            command: 'npx -y -p @memrosetta/claude-code memrosetta-on-stop',
            timeout: 15,
          },
        ],
      },
    ];

    writeClaudeSettings(settings);
    hookRegistered = true;
  }

  // 3. Add memory instructions to ~/.claude/CLAUDE.md
  let claudeMdUpdated = false;
  if (hasClaudeCode) {
    const claudeMdPath = join(claudeDir, 'CLAUDE.md');
    const marker = '## MemRosetta (Long-term Memory)';
    const existing = existsSync(claudeMdPath)
      ? readFileSync(claudeMdPath, 'utf-8')
      : '';

    if (!existing.includes(marker)) {
      const memorySection = `

${marker}

MCP server \`memory-service\` provides long-term memory across sessions.

### userId
Use your system username (run \`whoami\` if unsure). All projects share one memory pool.
Use keywords to distinguish projects when storing.

### Search (mcp__memory-service__memrosetta_search)
When you need information not in the current context, search past memories.

### Store (mcp__memory-service__memrosetta_store)
Every response, check if there is something worth storing. If yes, store immediately.
- **decision**: tech choices, architecture decisions
- **fact**: key facts about projects or systems
- **preference**: user preferences
- **event**: completed work, incidents

Do NOT store:
- Code itself (that belongs in git)
- Intermediate steps, debugging attempts
- Simple confirmations ("yes", "go ahead")
- Content already in CLAUDE.md

Always include keywords — they directly affect search quality.
`;
      writeFileSync(claudeMdPath, existing + memorySection, 'utf-8');
      claudeMdUpdated = true;
    }
  }

  // 4. Register MCP server in ~/.mcp.json (search across sessions)
  const mcpConfig = readMcpConfig();
  if (!mcpConfig.mcpServers) {
    mcpConfig.mcpServers = {};
  }
  mcpConfig.mcpServers['memory-service'] = {
    command: 'npx',
    args: ['-y', '@memrosetta/mcp'],
    env: {
      MEMROSETTA_EMBEDDINGS: 'false',
    },
  };
  writeMcpConfig(mcpConfig);
  mcpRegistered = true;

  // 5. Print summary
  process.stdout.write('\nMemRosetta initialized successfully.\n\n');
  process.stdout.write('  What was set up:\n');
  process.stdout.write('  ----------------------------------------\n');
  process.stdout.write(`  Config:     ${getConfigPath()}\n`);
  process.stdout.write(`  Database:   ${getDefaultDbPath()}\n`);

  if (hookRegistered) {
    process.stdout.write('  Stop Hook:  ~/.claude/settings.json (auto-save on session end)\n');
  } else {
    process.stdout.write('  Stop Hook:  SKIPPED (Claude Code not found at ~/.claude)\n');
    process.stdout.write('              Install Claude Code first, then run "memrosetta init" again.\n');
  }

  if (claudeMdUpdated) {
    process.stdout.write('  CLAUDE.md:  ~/.claude/CLAUDE.md (memory instructions for Claude)\n');
  } else if (hasClaudeCode) {
    process.stdout.write('  CLAUDE.md:  already configured\n');
  }

  if (mcpRegistered) {
    process.stdout.write('  MCP Server: ~/.mcp.json (search past memories)\n');
  }

  process.stdout.write('\n');
  process.stdout.write('  How it works:\n');
  process.stdout.write('  ----------------------------------------\n');
  process.stdout.write('  1. You chat with Claude Code as usual\n');
  process.stdout.write('  2. When the session ends, conversations are saved automatically\n');
  process.stdout.write('  3. In future sessions, Claude can search past memories via MCP\n');
  process.stdout.write('\n');

  if (hookRegistered) {
    process.stdout.write('  Restart Claude Code to activate.\n');
  }
}

async function statusCommand(): Promise<void> {
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  const config = getConfig();

  process.stdout.write('MemRosetta Status\n');
  process.stdout.write(`${'='.repeat(40)}\n\n`);

  // Config
  process.stdout.write(`Config: ${configDir}\n`);
  process.stdout.write(`  Exists: ${existsSync(configDir) ? 'yes' : 'no'}\n`);
  process.stdout.write(`  Config file: ${existsSync(configPath) ? 'yes' : 'no'}\n`);
  process.stdout.write('\n');

  // Database
  process.stdout.write(`Database: ${config.dbPath}\n`);
  process.stdout.write(`  Exists: ${existsSync(config.dbPath) ? 'yes' : 'no'}\n`);
  if (existsSync(config.dbPath)) {
    try {
      const { SqliteMemoryEngine } = await import('@memrosetta/core');
      const engine = new SqliteMemoryEngine({ dbPath: config.dbPath });
      await engine.initialize();
      process.stdout.write('  Status: connected\n');
      await engine.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`  Status: error (${message})\n`);
    }
  }
  process.stdout.write('\n');

  // Stop Hook
  process.stdout.write('Stop Hook (auto-save):\n');
  const settings = readClaudeSettings();
  const stopHooks = (settings.hooks?.['Stop'] || []) as readonly HookConfig[];
  const hasStopHook = stopHooks.some((hc) =>
    hc.hooks.some((h) => isMemrosettaHook(h.command)),
  );
  process.stdout.write(`  Status: ${hasStopHook ? 'registered' : 'not registered'}\n`);
  process.stdout.write('\n');

  // MCP Server
  process.stdout.write('MCP Server (search):\n');
  const mcpConfig = readMcpConfig();
  const hasMcp = !!mcpConfig.mcpServers?.['memory-service'];
  process.stdout.write(`  Status: ${hasMcp ? 'registered' : 'not registered'}\n`);
}

async function resetCommand(): Promise<void> {
  // Remove hooks from settings.json
  const settings = readClaudeSettings();
  if (settings.hooks) {
    for (const [eventType, hookConfigs] of Object.entries(settings.hooks)) {
      const filtered = (hookConfigs as readonly HookConfig[]).filter(
        (hc) => !hc.hooks.some((h) => isMemrosettaHook(h.command)),
      );
      (settings.hooks as Record<string, unknown>)[eventType] = filtered;
    }
    writeClaudeSettings(settings);
    process.stdout.write(`Removed hooks from ${CLAUDE_SETTINGS_PATH}\n`);
  }

  // Remove MCP server from .mcp.json
  const mcpConfig = readMcpConfig();
  if (mcpConfig.mcpServers?.['memory-service']) {
    delete mcpConfig.mcpServers['memory-service'];
    writeMcpConfig(mcpConfig);
    process.stdout.write(`Removed MCP server from ${MCP_CONFIG_PATH}\n`);
  }

  process.stdout.write(
    `\nNote: ~/.memrosetta/ directory preserved. Delete manually if needed:\n` +
    `  rm -rf ${getConfigDir()}\n`,
  );
}

function printHelp(): void {
  process.stdout.write(
    'memrosetta - Long-term memory for Claude Code\n\n' +
    'Usage:\n' +
    '  memrosetta init     Set up hooks + MCP server (one command, done)\n' +
    '  memrosetta status   Show current configuration\n' +
    '  memrosetta reset    Remove all memrosetta integrations\n' +
    '  memrosetta --help   Show this help message\n',
  );
}

async function main(): Promise<void> {
  const { positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
    },
  });

  const command = positionals[0];

  switch (command) {
    case 'init':
      await initCommand();
      break;
    case 'status':
      await statusCommand();
      break;
    case 'reset':
      await resetCommand();
      break;
    default:
      printHelp();
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
