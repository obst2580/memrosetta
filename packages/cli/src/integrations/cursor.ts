import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolveMcpCommand } from './resolve-command.js';

const SERVER_NAME = 'memory-service';
const CURSOR_RULES_PATH_GETTER = () => join(homedir(), '.cursorrules');
const MEMROSETTA_CURSOR_RULES_MARKER = '## MemRosetta (Long-term Memory)';

const MEMROSETTA_CURSOR_RULES = `

${MEMROSETTA_CURSOR_RULES_MARKER}

MCP server \`memory-service\` provides persistent memory across sessions.
userId defaults to the system username -- no need to specify it.

### When to search (memrosetta_search)
When you need information not in the current context, search past memories.
No need to specify userId -- it defaults to the system username.

### When to store (memrosetta_store)

**After EVERY response, run this checklist (zero extra cost):**
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
- Implementation details (HOW you did it -- only WHAT)

This checklist ensures nothing important is lost, including the last response before session ends.
No need to specify userId -- it defaults to the system username.

### When to relate (memrosetta_relate)
When new information updates or contradicts existing memories, create a relation.

### Working memory (memrosetta_working_memory)
Call this at the start of complex tasks to load relevant context.
No need to specify userId -- it defaults to the system username.
`;

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
  const { command, args } = resolveMcpCommand();
  return { command, args };
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
 * Register MCP server in ~/.cursor/mcp.json and update .cursorrules.
 */
export function registerCursorMCP(): void {
  const path = getCursorMcpPath();
  const config = readCursorConfig(path);
  const servers = config.mcpServers ?? {};
  writeCursorConfig(path, {
    ...config,
    mcpServers: { ...servers, [SERVER_NAME]: mcpServerEntry() },
  });
  updateCursorRules();
}

/**
 * Remove MemRosetta from ~/.cursor/mcp.json and .cursorrules.
 */
export function removeCursorMCP(): boolean {
  const path = getCursorMcpPath();
  if (!existsSync(path)) return false;

  const config = readCursorConfig(path);
  if (!config.mcpServers?.[SERVER_NAME]) return false;

  const { [SERVER_NAME]: _, ...rest } = config.mcpServers;
  writeCursorConfig(path, { ...config, mcpServers: rest });
  removeCursorRulesSection();
  return true;
}

export function getCursorMcpConfigPath(): string {
  return getCursorMcpPath();
}

export function getCursorRulesPath(): string {
  return CURSOR_RULES_PATH_GETTER();
}

/**
 * Append MemRosetta instructions to ~/.cursorrules.
 * Returns true if instructions were added, false if already present.
 */
export function updateCursorRules(): boolean {
  const rulesPath = CURSOR_RULES_PATH_GETTER();
  const existing = existsSync(rulesPath)
    ? readFileSync(rulesPath, 'utf-8')
    : '';

  if (existing.includes(MEMROSETTA_CURSOR_RULES_MARKER)) return false;

  writeFileSync(rulesPath, existing + MEMROSETTA_CURSOR_RULES, 'utf-8');
  return true;
}

/**
 * Remove the MemRosetta section from ~/.cursorrules.
 * Returns true if section was removed, false if not found.
 */
export function removeCursorRulesSection(): boolean {
  const rulesPath = CURSOR_RULES_PATH_GETTER();
  if (!existsSync(rulesPath)) return false;

  const content = readFileSync(rulesPath, 'utf-8');
  const markerIdx = content.indexOf(MEMROSETTA_CURSOR_RULES_MARKER);

  if (markerIdx === -1) return false;

  // Find the next top-level heading (## at the start of a line) after the marker
  const afterMarker = content.slice(
    markerIdx + MEMROSETTA_CURSOR_RULES_MARKER.length,
  );
  const nextHeadingMatch = afterMarker.match(/\n## (?!MemRosetta)/);
  const endIdx = nextHeadingMatch
    ? markerIdx +
      MEMROSETTA_CURSOR_RULES_MARKER.length +
      (nextHeadingMatch.index ?? afterMarker.length)
    : content.length;

  const before = content.slice(0, markerIdx).replace(/\n+$/, '');
  const after = content.slice(endIdx);
  const updated = (before + after).trimEnd() + '\n';

  writeFileSync(rulesPath, updated, 'utf-8');
  return true;
}
