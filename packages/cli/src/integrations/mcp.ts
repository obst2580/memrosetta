import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolveMcpCommand } from './resolve-command.js';

const MCP_CONFIG_PATH = join(homedir(), '.mcp.json');
const SERVER_NAME = 'memory-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface McpConfig {
  mcpServers?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readMcpConfig(path: string): McpConfig {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as McpConfig;
  } catch {
    return {};
  }
}

function writeMcpConfig(path: string, config: McpConfig): void {
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
}

function mcpServerEntry(): Record<string, unknown> {
  const { command, args } = resolveMcpCommand();
  return { command, args };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if the generic MCP config (~/.mcp.json) has MemRosetta registered.
 */
export function isGenericMCPConfigured(): boolean {
  const config = readMcpConfig(MCP_CONFIG_PATH);
  return !!config.mcpServers?.[SERVER_NAME];
}

/**
 * Register MCP server in ~/.mcp.json (used by Claude Code and other tools).
 */
export function registerGenericMCP(): void {
  const config = readMcpConfig(MCP_CONFIG_PATH);
  const servers = config.mcpServers ?? {};
  writeMcpConfig(MCP_CONFIG_PATH, {
    ...config,
    mcpServers: { ...servers, [SERVER_NAME]: mcpServerEntry() },
  });
}

/**
 * Remove MemRosetta from ~/.mcp.json.
 */
export function removeGenericMCP(): boolean {
  if (!existsSync(MCP_CONFIG_PATH)) return false;

  const config = readMcpConfig(MCP_CONFIG_PATH);
  if (!config.mcpServers?.[SERVER_NAME]) return false;

  const { [SERVER_NAME]: _, ...rest } = config.mcpServers;
  writeMcpConfig(MCP_CONFIG_PATH, { ...config, mcpServers: rest });
  return true;
}

export function getGenericMCPPath(): string {
  return MCP_CONFIG_PATH;
}
