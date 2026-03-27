import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolveMcpCommand } from './resolve-command.js';

const SERVER_NAME = 'memrosetta';
const CODEX_CONFIG_PATH_GETTER = () => join(homedir(), '.codex', 'config.toml');
const AGENTS_MD_MARKER = '## MemRosetta (Long-term Memory)';

const MEMROSETTA_AGENTS_MD = `

${AGENTS_MD_MARKER}

MCP server \`memrosetta\` provides persistent memory across sessions.
userId defaults to the system username -- no need to specify it.

### When to search (memrosetta_search)
When you need information not in the current context, search past memories.

### When to store (memrosetta_store)

**After EVERY response, run this checklist:**
1. Did I encounter a DECISION? (tech choice, approach selection) -> store as "decision"
2. Did I learn a new FACT? (config, architecture, project info) -> store as "fact"
3. Did the user state a PREFERENCE? (style, tool choice, pattern) -> store as "preference"
4. Did we COMPLETE something? (deploy, migration, fix) -> store as "event"
5. None of the above? -> skip, do not store.

Always include 2-3 keywords. Example:
  content: "Decided to use OAuth2 with PKCE for auth"
  type: "decision"
  keywords: "auth, oauth2, pkce"

Do NOT store:
- Code itself (belongs in git)
- File operations ("Created file X", "Modified Y")
- Debugging steps and attempts
- Simple confirmations or acknowledgments

### When to relate (memrosetta_relate)
When new information updates or contradicts existing memories, create a relation.

### Working memory (memrosetta_working_memory)
Call this at the start of complex tasks to load relevant context.
`;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getCodexConfigDir(): string {
  return join(homedir(), '.codex');
}

function getCodexConfigPath(): string {
  return CODEX_CONFIG_PATH_GETTER();
}

function readCodexConfig(path: string): string {
  if (!existsSync(path)) return '';
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

function escapeTomlString(s: string): string {
  // Escape backslashes for TOML (Windows paths: C:\Users\... → C:\\Users\\...)
  return s.replace(/\\/g, '\\\\');
}

function buildMcpServerToml(): string {
  const { command, args } = resolveMcpCommand();
  const escapedCommand = escapeTomlString(command);
  const argsLine =
    args.length > 0
      ? `\nargs = [${args.map((a) => `"${escapeTomlString(a)}"`).join(', ')}]`
      : '';
  return `\n[mcp_servers.${SERVER_NAME}]\ncommand = "${escapedCommand}"${argsLine}\n`;
}

function hasMcpServer(content: string): boolean {
  return content.includes(`[mcp_servers.${SERVER_NAME}]`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if Codex is installed (~/.codex directory exists).
 */
export function isCodexInstalled(): boolean {
  return existsSync(getCodexConfigDir());
}

/**
 * Check if MemRosetta MCP is already configured in Codex.
 */
export function isCodexConfigured(): boolean {
  const content = readCodexConfig(getCodexConfigPath());
  return hasMcpServer(content);
}

/**
 * Register MCP server in ~/.codex/config.toml and update AGENTS.md.
 * Returns true if AGENTS.md was updated (new), false if already present.
 */
export function registerCodexMCP(): boolean {
  const configPath = getCodexConfigPath();
  const dir = getCodexConfigDir();

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = readCodexConfig(configPath);

  if (!hasMcpServer(content)) {
    writeFileSync(configPath, content + buildMcpServerToml(), 'utf-8');
  }

  return updateAgentsMd();
}

/**
 * Remove MemRosetta from ~/.codex/config.toml and AGENTS.md.
 */
export function removeCodexMCP(): boolean {
  const configPath = getCodexConfigPath();
  if (!existsSync(configPath)) return false;

  const content = readCodexConfig(configPath);
  if (!hasMcpServer(content)) return false;

  // Remove the [mcp_servers.memrosetta] section
  const lines = content.split('\n');
  const filtered: string[] = [];
  let skipping = false;

  for (const line of lines) {
    if (line.trim() === `[mcp_servers.${SERVER_NAME}]`) {
      skipping = true;
      continue;
    }
    // Stop skipping at the next section header
    if (skipping && line.trim().startsWith('[')) {
      skipping = false;
    }
    if (!skipping) {
      filtered.push(line);
    }
  }

  writeFileSync(configPath, filtered.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', 'utf-8');
  removeAgentsMdSection();
  return true;
}

export function getCodexConfigFilePath(): string {
  return getCodexConfigPath();
}

export function getAgentsMdPath(): string {
  return join(process.cwd(), 'AGENTS.md');
}

/**
 * Append MemRosetta instructions to AGENTS.md in current directory.
 * Returns true if instructions were added, false if already present.
 */
export function updateAgentsMd(): boolean {
  const agentsPath = getAgentsMdPath();
  const existing = existsSync(agentsPath)
    ? readFileSync(agentsPath, 'utf-8')
    : '';

  if (existing.includes(AGENTS_MD_MARKER)) return false;

  writeFileSync(agentsPath, existing + MEMROSETTA_AGENTS_MD, 'utf-8');
  return true;
}

/**
 * Remove the MemRosetta section from AGENTS.md.
 */
export function removeAgentsMdSection(): boolean {
  const agentsPath = getAgentsMdPath();
  if (!existsSync(agentsPath)) return false;

  const content = readFileSync(agentsPath, 'utf-8');
  const markerIdx = content.indexOf(AGENTS_MD_MARKER);
  if (markerIdx === -1) return false;

  const afterMarker = content.slice(markerIdx + AGENTS_MD_MARKER.length);
  const nextHeadingMatch = afterMarker.match(/\n## (?!MemRosetta)/);
  const endIdx = nextHeadingMatch
    ? markerIdx + AGENTS_MD_MARKER.length + (nextHeadingMatch.index ?? afterMarker.length)
    : content.length;

  const before = content.slice(0, markerIdx).replace(/\n+$/, '');
  const after = content.slice(endIdx);
  const updated = (before + after).trimEnd() + '\n';

  writeFileSync(agentsPath, updated, 'utf-8');
  return true;
}
