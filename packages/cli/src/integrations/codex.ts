import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolveMcpCommand } from './resolve-command.js';

const SERVER_NAME = 'memory-service';
// Older versions of memrosetta init wrote the section under a different
// name. We still need to clean those up on reset / re-init so the user
// does not end up with two MCP server entries pointing at the same binary.
const LEGACY_SERVER_NAMES = ['memrosetta'] as const;
const CODEX_CONFIG_PATH_GETTER = () => join(homedir(), '.codex', 'config.toml');
const AGENTS_MD_MARKER = '## MemRosetta (Long-term Memory)';

const MEMROSETTA_AGENTS_MD = `

${AGENTS_MD_MARKER}

MCP server \`memory-service\` provides persistent memory across sessions.
userId defaults to the system username -- no need to specify it.

### When to search (mcp__memory-service__memrosetta_search)
When you need information not in the current context, search past memories.

### When to store (mcp__memory-service__memrosetta_store)

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

### When to relate (mcp__memory-service__memrosetta_relate)
When new information updates or contradicts existing memories, create a relation.

### Working memory (mcp__memory-service__memrosetta_working_memory)
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

/**
 * Quote a value as a TOML literal string (single quotes).
 *
 * TOML basic strings ("...") apply backslash escapes, which mangles
 * Windows paths like `C:\Users\jhlee13\...` because `\U` is interpreted
 * as a Unicode escape and double-escaping leaves `\\` in the parsed
 * value. TOML literal strings ('...') take the value verbatim and have
 * no escape processing — exactly what we want for filesystem paths.
 *
 * The only character a literal string cannot contain is a single quote
 * itself; if that ever appears in a path we fall back to a basic string
 * with full backslash + quote escaping.
 */
function tomlLiteral(s: string): string {
  if (!s.includes("'")) {
    return `'${s}'`;
  }
  // Fallback: basic string with proper escapes.
  const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function buildMcpServerToml(): string {
  const { command, args } = resolveMcpCommand();
  const argsLine =
    args.length > 0
      ? `\nargs = [${args.map(tomlLiteral).join(', ')}]`
      : '';
  return `\n[mcp_servers.${SERVER_NAME}]\ncommand = ${tomlLiteral(command)}${argsLine}\n`;
}

function hasMcpServer(content: string): boolean {
  return content.includes(`[mcp_servers.${SERVER_NAME}]`);
}

/**
 * Strip a single `[mcp_servers.<name>]` block (and everything until the
 * next top-level section or EOF) from a TOML document. Idempotent — if
 * the marker is missing the input is returned unchanged.
 */
function stripSection(content: string, name: string): string {
  const marker = `[mcp_servers.${name}]`;
  const idx = content.indexOf(marker);
  if (idx === -1) return content;

  const afterMarker = content.slice(idx + marker.length);
  const nextSectionMatch = afterMarker.match(/\n\[/);
  const endIdx = nextSectionMatch
    ? idx + marker.length + (nextSectionMatch.index ?? afterMarker.length)
    : content.length;

  const trimmedHead = content.slice(0, idx).trimEnd();
  const tail = content.slice(endIdx);
  return `${trimmedHead}\n${tail}`.trim() + '\n';
}

function removeMcpServerSection(content: string): string {
  let next = stripSection(content, SERVER_NAME);
  // Also clean up any legacy server names that older `memrosetta init`
  // versions may have written. Without this, reset / re-init silently
  // leaves duplicated [mcp_servers.memrosetta] blocks behind.
  for (const legacy of LEGACY_SERVER_NAMES) {
    next = stripSection(next, legacy);
  }
  return next;
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

  let content = readCodexConfig(configPath);

  // Always strip both the current section and any legacy section names
  // before re-inserting, so older installs that wrote `[mcp_servers.memrosetta]`
  // get cleaned up automatically on re-init.
  content = removeMcpServerSection(content);

  writeFileSync(configPath, content + buildMcpServerToml(), 'utf-8');

  return updateAgentsMd();
}

/**
 * Remove MemRosetta from ~/.codex/config.toml and AGENTS.md.
 *
 * Cleans up both the current `[mcp_servers.memory-service]` block and
 * any legacy `[mcp_servers.memrosetta]` blocks that older versions of
 * `memrosetta init --codex` may have written.
 */
export function removeCodexMCP(): boolean {
  const configPath = getCodexConfigPath();
  if (!existsSync(configPath)) return false;

  const original = readCodexConfig(configPath);
  const cleaned = removeMcpServerSection(original);

  if (cleaned === original) {
    // Nothing to remove. Still try to clean AGENTS.md so reset is
    // idempotent across the two files.
    removeAgentsMdSection();
    return false;
  }

  writeFileSync(configPath, cleaned, 'utf-8');
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
