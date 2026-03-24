#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  ensureDir,
  getConfig,
  getConfigDir,
  getConfigPath,
  getDefaultDbPath,
  writeDefaultConfig,
} from './config.js';

const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');

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

function getPackageDir(): string {
  return join(fileURLToPath(new URL('.', import.meta.url)), '..');
}

function getHookPaths(): { readonly onStop: string; readonly onPrompt: string } {
  const packageDir = getPackageDir();
  return {
    onStop: join(packageDir, 'dist', 'hooks', 'on-stop.js'),
    onPrompt: join(packageDir, 'dist', 'hooks', 'on-prompt.js'),
  };
}

function readClaudeSettings(): ClaudeSettings {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) {
    return {};
  }

  try {
    const raw = readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
    return JSON.parse(raw) as ClaudeSettings;
  } catch {
    return {};
  }
}

function writeClaudeSettings(settings: ClaudeSettings): void {
  const dir = join(homedir(), '.claude');
  if (!existsSync(dir)) {
    throw new Error(`~/.claude directory does not exist. Is Claude Code installed?`);
  }
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

function isMemrosettaHook(command: string): boolean {
  return command.includes('memrosetta') && (
    command.includes('on-stop') || command.includes('on-prompt')
  );
}

async function initCommand(): Promise<void> {
  // 1. Create ~/.memrosetta/ directory and default config
  ensureDir();
  writeDefaultConfig();
  process.stdout.write(`Created config at ${getConfigPath()}\n`);

  // 2. Resolve hook script paths
  const hooks = getHookPaths();

  if (!existsSync(hooks.onStop)) {
    process.stderr.write(
      `Warning: on-stop.js not found at ${hooks.onStop}\n` +
      `Run 'pnpm build' in the @memrosetta/claude-code package first.\n`,
    );
  }
  if (!existsSync(hooks.onPrompt)) {
    process.stderr.write(
      `Warning: on-prompt.js not found at ${hooks.onPrompt}\n` +
      `Run 'pnpm build' in the @memrosetta/claude-code package first.\n`,
    );
  }

  // 3. Read and update Claude settings
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

  // Add Stop hook
  const stopHookConfigs = (settings.hooks['Stop'] || []) as HookConfig[];
  const newStopHooks: readonly HookConfig[] = [
    ...stopHookConfigs,
    {
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: `node ${hooks.onStop}`,
          timeout: 15,
        },
      ],
    },
  ];
  (settings.hooks as Record<string, unknown>)['Stop'] = newStopHooks;

  // Add UserPromptSubmit hook
  const promptHookConfigs = (settings.hooks['UserPromptSubmit'] || []) as HookConfig[];
  const newPromptHooks: readonly HookConfig[] = [
    ...promptHookConfigs,
    {
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: `node ${hooks.onPrompt}`,
          timeout: 5,
        },
      ],
    },
  ];
  (settings.hooks as Record<string, unknown>)['UserPromptSubmit'] = newPromptHooks;

  // 4. Write updated settings
  writeClaudeSettings(settings);

  process.stdout.write(`Registered hooks in ${CLAUDE_SETTINGS_PATH}\n`);
  process.stdout.write(`\nMemRosetta initialized successfully.\n`);
  process.stdout.write(`  DB path: ${getDefaultDbPath()}\n`);
  process.stdout.write(`  Config: ${getConfigPath()}\n`);
  process.stdout.write(`  Stop hook: ${hooks.onStop}\n`);
  process.stdout.write(`  Prompt hook: ${hooks.onPrompt}\n`);
}

async function statusCommand(): Promise<void> {
  // Check config
  const configDir = getConfigDir();
  const configPath = getConfigPath();
  const config = getConfig();

  process.stdout.write(`MemRosetta Status\n`);
  process.stdout.write(`${'='.repeat(40)}\n\n`);

  // Config
  process.stdout.write(`Config directory: ${configDir}\n`);
  process.stdout.write(`  Exists: ${existsSync(configDir) ? 'yes' : 'no'}\n`);
  process.stdout.write(`  Config file: ${existsSync(configPath) ? 'yes' : 'no'}\n`);
  process.stdout.write(`  Embeddings: ${config.enableEmbeddings ? 'enabled' : 'disabled'}\n`);
  process.stdout.write(`\n`);

  // Database
  process.stdout.write(`Database: ${config.dbPath}\n`);
  process.stdout.write(`  Exists: ${existsSync(config.dbPath) ? 'yes' : 'no'}\n`);

  if (existsSync(config.dbPath)) {
    try {
      const { SqliteMemoryEngine } = await import('@memrosetta/core');
      const engine = new SqliteMemoryEngine({ dbPath: config.dbPath });
      await engine.initialize();
      // Count all memories (approximate by checking a known user or general count)
      process.stdout.write(`  Status: connected\n`);
      await engine.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`  Status: error (${message})\n`);
    }
  }
  process.stdout.write(`\n`);

  // Hooks
  process.stdout.write(`Claude Code Hooks:\n`);
  const settings = readClaudeSettings();

  const stopHooks = (settings.hooks?.['Stop'] || []) as readonly HookConfig[];
  const hasStopHook = stopHooks.some((hc) =>
    hc.hooks.some((h) => isMemrosettaHook(h.command)),
  );
  process.stdout.write(`  Stop hook: ${hasStopHook ? 'registered' : 'not registered'}\n`);

  const promptHooks = (settings.hooks?.['UserPromptSubmit'] || []) as readonly HookConfig[];
  const hasPromptHook = promptHooks.some((hc) =>
    hc.hooks.some((h) => isMemrosettaHook(h.command)),
  );
  process.stdout.write(`  Prompt hook: ${hasPromptHook ? 'registered' : 'not registered'}\n`);
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
  } else {
    process.stdout.write(`No hooks found in settings.\n`);
  }

  process.stdout.write(
    `\nNote: ~/.memrosetta/ directory preserved. Delete manually if needed:\n` +
    `  rm -rf ${getConfigDir()}\n`,
  );
}

function printHelp(): void {
  process.stdout.write(
    `memrosetta - Long-term memory for Claude Code\n\n` +
    `Usage:\n` +
    `  memrosetta init     Register hooks in ~/.claude/settings.json\n` +
    `  memrosetta status   Show current configuration and status\n` +
    `  memrosetta reset    Remove hooks from settings.json\n` +
    `  memrosetta --help   Show this help message\n`,
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
