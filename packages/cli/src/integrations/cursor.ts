import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SERVER_NAME = 'memory-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CursorMcpConfig {
  mcpServers?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getCursorConfigDir(): string {
  return join(homedir(), '.cursor');
}

function getCursorMcpPath(): string {
  return join(getCursorConfigDir(), 'mcp.json');
}

function readCursorConfig(path: string): CursorMcpConfig {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CursorMcpConfig;
  } catch {
    return {};
  }
}

function writeCursorConfig(path: string, config: CursorMcpConfig): void {
  const dir = getCursorConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
}

function mcpServerEntry(): Record<string, unknown> {
  return {
    command: 'npx',
    args: ['-y', '@memrosetta/mcp'],
    env: {
      MEMROSETTA_EMBEDDINGS: 'false',
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if Cursor MCP is configured at ~/.cursor/mcp.json.
 */
export function isCursorConfigured(): boolean {
  const path = getCursorMcpPath();
  const config = readCursorConfig(path);
  return !!config.mcpServers?.[SERVER_NAME];
}

/**
 * Register MCP server in ~/.cursor/mcp.json.
 */
export function registerCursorMCP(): void {
  const path = getCursorMcpPath();
  const config = readCursorConfig(path);
  const servers = config.mcpServers ?? {};
  writeCursorConfig(path, {
    ...config,
    mcpServers: { ...servers, [SERVER_NAME]: mcpServerEntry() },
  });
}

/**
 * Remove MemRosetta from ~/.cursor/mcp.json.
 */
export function removeCursorMCP(): boolean {
  const path = getCursorMcpPath();
  if (!existsSync(path)) return false;

  const config = readCursorConfig(path);
  if (!config.mcpServers?.[SERVER_NAME]) return false;

  const { [SERVER_NAME]: _, ...rest } = config.mcpServers;
  writeCursorConfig(path, { ...config, mcpServers: rest });
  return true;
}

export function getCursorMcpConfigPath(): string {
  return getCursorMcpPath();
}
