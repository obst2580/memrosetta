import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const CLAUDE_DIR = join(homedir(), '.claude');
const CLAUDE_SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');
const CLAUDE_MD_PATH = join(CLAUDE_DIR, 'CLAUDE.md');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isMemrosettaHook(command: string): boolean {
  return (
    command.includes('memrosetta') &&
    (command.includes('on-stop') || command.includes('on-prompt'))
  );
}

function readClaudeSettings(): ClaudeSettings {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return {};
  try {
    return JSON.parse(
      readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'),
    ) as ClaudeSettings;
  } catch {
    return {};
  }
}

function writeClaudeSettings(settings: ClaudeSettings): void {
  if (!existsSync(CLAUDE_DIR)) {
    throw new Error(
      '~/.claude directory does not exist. Is Claude Code installed?',
    );
  }
  writeFileSync(
    CLAUDE_SETTINGS_PATH,
    JSON.stringify(settings, null, 2),
    'utf-8',
  );
}

function removeMemrosettaHooksFromSettings(
  settings: ClaudeSettings,
): ClaudeSettings {
  if (!settings.hooks) return settings;

  const cleaned: Record<string, unknown> = {};
  for (const [eventType, hookConfigs] of Object.entries(settings.hooks)) {
    const filtered = (hookConfigs as readonly HookConfig[]).filter(
      (hc) => !hc.hooks.some((h) => isMemrosettaHook(h.command)),
    );
    cleaned[eventType] = filtered;
  }

  return { ...settings, hooks: cleaned as Record<string, readonly HookConfig[]> };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isClaudeCodeInstalled(): boolean {
  return existsSync(CLAUDE_DIR);
}

export function isClaudeCodeConfigured(): boolean {
  const settings = readClaudeSettings();
  const stopHooks = (settings.hooks?.['Stop'] || []) as readonly HookConfig[];
  return stopHooks.some((hc) =>
    hc.hooks.some((h) => isMemrosettaHook(h.command)),
  );
}

/**
 * Register Stop hook in ~/.claude/settings.json.
 * The hook script is invoked via the globally installed `memrosetta-on-stop` binary.
 *
 * Returns true if hooks were written, false if ~/.claude does not exist.
 */
export function registerClaudeCodeHooks(): boolean {
  if (!isClaudeCodeInstalled()) return false;

  let settings = readClaudeSettings();
  if (!settings.hooks) {
    settings = { ...settings, hooks: {} };
  }

  // Remove any existing memrosetta hooks first
  settings = removeMemrosettaHooksFromSettings(settings);

  // Add Stop hook
  const stopHookConfigs = (settings.hooks!['Stop'] || []) as HookConfig[];
  (settings.hooks as Record<string, unknown>)['Stop'] = [
    ...stopHookConfigs,
    {
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: 'memrosetta-on-stop',
          timeout: 15,
        },
      ],
    },
  ];

  writeClaudeSettings(settings);
  return true;
}

/**
 * Remove all MemRosetta hooks from ~/.claude/settings.json.
 */
export function removeClaudeCodeHooks(): boolean {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return false;

  const settings = readClaudeSettings();
  if (!settings.hooks) return false;

  const cleaned = removeMemrosettaHooksFromSettings(settings);
  writeClaudeSettings(cleaned);
  return true;
}

/**
 * Append MemRosetta instructions section to ~/.claude/CLAUDE.md.
 * Returns true if instructions were added, false if already present or
 * Claude Code is not installed.
 */
export function updateClaudeMd(): boolean {
  if (!isClaudeCodeInstalled()) return false;

  const marker = '## MemRosetta (Long-term Memory)';
  const existing = existsSync(CLAUDE_MD_PATH)
    ? readFileSync(CLAUDE_MD_PATH, 'utf-8')
    : '';

  if (existing.includes(marker)) return false;

  const memorySection = `

${marker}

MCP server \`memory-service\` provides long-term memory across sessions.
userId defaults to the system username -- no need to specify it.

### Search (mcp__memory-service__memrosetta_search)
When you need information not in the current context, search past memories.
No need to specify userId -- it defaults to the system username.

### Store (mcp__memory-service__memrosetta_store)

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
`;

  writeFileSync(CLAUDE_MD_PATH, existing + memorySection, 'utf-8');
  return true;
}

/**
 * Remove MemRosetta section from ~/.claude/CLAUDE.md.
 */
export function removeClaudeMdSection(): boolean {
  if (!existsSync(CLAUDE_MD_PATH)) return false;

  const content = readFileSync(CLAUDE_MD_PATH, 'utf-8');
  const marker = '## MemRosetta (Long-term Memory)';
  const markerIdx = content.indexOf(marker);

  if (markerIdx === -1) return false;

  // Find the next top-level heading (## at the start of a line) after the marker
  const afterMarker = content.slice(markerIdx + marker.length);
  const nextHeadingMatch = afterMarker.match(/\n## (?!MemRosetta)/);
  const endIdx = nextHeadingMatch
    ? markerIdx + marker.length + (nextHeadingMatch.index ?? afterMarker.length)
    : content.length;

  // Remove the section, trimming trailing whitespace before it
  const before = content.slice(0, markerIdx).replace(/\n+$/, '');
  const after = content.slice(endIdx);
  const updated = (before + after).trimEnd() + '\n';

  writeFileSync(CLAUDE_MD_PATH, updated, 'utf-8');
  return true;
}
