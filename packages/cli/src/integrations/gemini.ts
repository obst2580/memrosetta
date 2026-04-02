import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolveMcpCommand } from './resolve-command.js';

const SERVER_NAME = 'memory-service';
const GEMINI_CONFIG_PATH_GETTER = () => join(homedir(), '.gemini', 'settings.json');
const GEMINI_MD_MARKER = '## MemRosetta (Long-term Memory)';

const MEMROSETTA_GEMINI_MD = `

${GEMINI_MD_MARKER}

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

### Feedback (memrosetta_feedback)
After using a retrieved memory, report whether it was helpful:
- Memory was accurate and useful -> feedback(memoryId, helpful=true)
- Memory was outdated or wrong -> feedback(memoryId, helpful=false)
This improves future search ranking automatically.
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GeminiSettings {
  mcpServers?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getGeminiConfigDir(): string {
  return join(homedir(), '.gemini');
}

function getGeminiSettingsPath(): string {
  return GEMINI_CONFIG_PATH_GETTER();
}

function readGeminiSettings(path: string): GeminiSettings {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf-8');
  try {
    return JSON.parse(raw) as GeminiSettings;
  } catch {
    throw new Error(
      `Failed to parse ${path}. Fix or delete the file before running init.`,
    );
  }
}

function writeGeminiSettings(path: string, settings: GeminiSettings): void {
  const dir = getGeminiConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8');
}

function mcpServerEntry(): Record<string, unknown> {
  const { command, args } = resolveMcpCommand();
  return { command, args };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if Gemini is installed (~/.gemini directory exists).
 */
export function isGeminiInstalled(): boolean {
  return existsSync(getGeminiConfigDir());
}

/**
 * Check if Gemini MCP is configured at ~/.gemini/settings.json.
 */
export function isGeminiConfigured(): boolean {
  const path = getGeminiSettingsPath();
  const settings = readGeminiSettings(path);
  return !!settings.mcpServers?.[SERVER_NAME];
}

/**
 * Register MCP server in ~/.gemini/settings.json and update GEMINI.md.
 * Returns true if GEMINI.md was updated (new), false if already present.
 */
export function registerGeminiMCP(): boolean {
  const path = getGeminiSettingsPath();
  const settings = readGeminiSettings(path);
  const servers = settings.mcpServers ?? {};
  writeGeminiSettings(path, {
    ...settings,
    mcpServers: { ...servers, [SERVER_NAME]: mcpServerEntry() },
  });
  return updateGeminiMd();
}

/**
 * Remove MemRosetta MCP server from ~/.gemini/settings.json.
 * Does NOT remove GEMINI.md section -- callers handle that separately.
 */
export function removeGeminiMCP(): boolean {
  const path = getGeminiSettingsPath();
  if (!existsSync(path)) return false;

  const settings = readGeminiSettings(path);
  if (!settings.mcpServers?.[SERVER_NAME]) return false;

  const { [SERVER_NAME]: _, ...rest } = settings.mcpServers;
  writeGeminiSettings(path, { ...settings, mcpServers: rest });
  return true;
}

export function getGeminiSettingsFilePath(): string {
  return getGeminiSettingsPath();
}

export function getGeminiMdPath(): string {
  return join(process.cwd(), 'GEMINI.md');
}

/**
 * Append MemRosetta instructions to GEMINI.md in current directory.
 * Returns true if instructions were added, false if already present.
 */
export function updateGeminiMd(): boolean {
  const geminiMdPath = getGeminiMdPath();
  const existing = existsSync(geminiMdPath)
    ? readFileSync(geminiMdPath, 'utf-8')
    : '';

  if (existing.includes(GEMINI_MD_MARKER)) return false;

  writeFileSync(geminiMdPath, existing + MEMROSETTA_GEMINI_MD, 'utf-8');
  return true;
}

/**
 * Remove the MemRosetta section from GEMINI.md.
 * Returns true if section was removed, false if not found.
 */
export function removeGeminiMdSection(): boolean {
  const geminiMdPath = getGeminiMdPath();
  if (!existsSync(geminiMdPath)) return false;

  const content = readFileSync(geminiMdPath, 'utf-8');
  const markerIdx = content.indexOf(GEMINI_MD_MARKER);

  if (markerIdx === -1) return false;

  // Find the next top-level heading (## at the start of a line) after the marker
  const afterMarker = content.slice(
    markerIdx + GEMINI_MD_MARKER.length,
  );
  const nextHeadingMatch = afterMarker.match(/\n## (?!MemRosetta)/);
  const endIdx = nextHeadingMatch
    ? markerIdx +
      GEMINI_MD_MARKER.length +
      (nextHeadingMatch.index ?? afterMarker.length)
    : content.length;

  const before = content.slice(0, markerIdx).replace(/\n+$/, '');
  const after = content.slice(endIdx);
  const updated = (before + after).trimEnd() + '\n';

  writeFileSync(geminiMdPath, updated, 'utf-8');
  return true;
}
