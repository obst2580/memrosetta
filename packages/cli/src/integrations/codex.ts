import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolveMcpCommand, resolveHookCommand } from './resolve-command.js';

const SERVER_NAME = 'memory-service';
// Older versions of memrosetta init wrote the section under a different
// name. We still need to clean those up on reset / re-init so the user
// does not end up with two MCP server entries pointing at the same binary.
const LEGACY_SERVER_NAMES = ['memrosetta'] as const;
const CODEX_CONFIG_PATH_GETTER = () => join(homedir(), '.codex', 'config.toml');
const CODEX_HOOKS_PATH_GETTER = () => join(homedir(), '.codex', 'hooks.json');
const AGENTS_MD_MARKER = '## MemRosetta (Long-term Memory)';
const CODEX_HOOKS_FEATURE_MARKER = '[features]';
const CODEX_HOOKS_FEATURE_KEY = 'codex_hooks';

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

// ---------------------------------------------------------------------------
// Stop hook integration (~/.codex/hooks.json + [features] codex_hooks)
// ---------------------------------------------------------------------------

interface CodexHookEntry {
  readonly type: 'command';
  readonly command: string;
  readonly timeout?: number;
  readonly statusMessage?: string;
}

interface CodexHookConfig {
  readonly matcher?: string;
  readonly hooks: readonly CodexHookEntry[];
}

interface CodexHooksFile {
  hooks?: Record<string, readonly CodexHookConfig[]>;
  [key: string]: unknown;
}

function isMemrosettaCodexHook(command: string): boolean {
  // Matches current wrapper and any legacy memrosetta hook name so
  // re-install cleanly replaces older entries.
  return (
    command.includes('memrosetta') &&
    (command.includes('enforce-codex') ||
      command.includes('enforce-claude-code') ||
      command.includes('on-stop'))
  );
}

function readCodexHooksFile(): CodexHooksFile {
  const path = CODEX_HOOKS_PATH_GETTER();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf-8');
    if (!raw.trim()) return {};
    return JSON.parse(raw) as CodexHooksFile;
  } catch {
    // If the file is malformed we intentionally start fresh rather than
    // crash the user's install. A broken hooks.json already disables
    // Codex hooks, so overwriting it is the safe move.
    return {};
  }
}

function writeCodexHooksFile(contents: CodexHooksFile): void {
  const dir = getCodexConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(
    CODEX_HOOKS_PATH_GETTER(),
    JSON.stringify(contents, null, 2) + '\n',
    'utf-8',
  );
}

function stripMemrosettaHooks(file: CodexHooksFile): CodexHooksFile {
  if (!file.hooks) return file;
  const cleaned: Record<string, readonly CodexHookConfig[]> = {};
  for (const [event, configs] of Object.entries(file.hooks)) {
    const filtered = (configs as readonly CodexHookConfig[])
      .map((cfg) => ({
        ...cfg,
        hooks: cfg.hooks.filter((h) => !isMemrosettaCodexHook(h.command)),
      }))
      .filter((cfg) => cfg.hooks.length > 0);
    if (filtered.length > 0) {
      cleaned[event] = filtered;
    }
  }
  return { ...file, hooks: cleaned };
}

/**
 * Ensure `[features] codex_hooks = true` is set in ~/.codex/config.toml.
 * Idempotent: if the feature is already on, returns the unchanged content.
 * Preserves any other `[features]` keys already present.
 */
function ensureHooksFeatureFlag(content: string): string {
  // Already on?
  if (/^\s*codex_hooks\s*=\s*true/m.test(content)) return content;

  // Has a [features] section but codex_hooks is off or missing:
  // insert the line directly after the section header.
  if (content.includes(CODEX_HOOKS_FEATURE_MARKER)) {
    // Flip an existing `codex_hooks = false` to `true` first.
    if (/^\s*codex_hooks\s*=\s*false/m.test(content)) {
      return content.replace(
        /^\s*codex_hooks\s*=\s*false\s*$/m,
        'codex_hooks = true',
      );
    }
    return content.replace(
      CODEX_HOOKS_FEATURE_MARKER,
      `${CODEX_HOOKS_FEATURE_MARKER}\ncodex_hooks = true`,
    );
  }

  // No [features] section at all — append one.
  const trimmed = content.replace(/\n+$/, '');
  return `${trimmed}\n\n[features]\ncodex_hooks = true\n`;
}

/**
 * Turn off `codex_hooks = true` (leave the `[features]` section
 * itself in place, since it may hold other flags).
 */
function stripHooksFeatureFlag(content: string): string {
  if (!/^\s*codex_hooks\s*=\s*true/m.test(content)) return content;
  return content.replace(/^\s*codex_hooks\s*=\s*true\s*\n?/m, '');
}

/**
 * Check whether `memrosetta init --codex` has wired up the Stop hook.
 */
export function isCodexHooksConfigured(): boolean {
  const file = readCodexHooksFile();
  const stopHooks = file.hooks?.Stop ?? [];
  return stopHooks.some((cfg) =>
    cfg.hooks.some((h) => isMemrosettaCodexHook(h.command)),
  );
}

export function getCodexHooksPath(): string {
  return CODEX_HOOKS_PATH_GETTER();
}

/**
 * Register the MemRosetta Codex Stop hook.
 *
 * Three things happen atomically-ish:
 *   1. `~/.codex/hooks.json` gets a `Stop` entry pointing at the
 *      `memrosetta-enforce-codex` binary. Any pre-existing
 *      memrosetta hook entries are stripped first so re-install is
 *      idempotent.
 *   2. `[features] codex_hooks = true` is added to
 *      `~/.codex/config.toml` so Codex CLI actually fires the hook.
 *   3. The function is a no-op on Windows, where Codex hooks are
 *      currently disabled upstream — returning `false` so the caller
 *      can surface a friendly message.
 */
export function registerCodexHooks(): boolean {
  if (process.platform === 'win32') return false;
  if (!isCodexInstalled()) return false;

  // 1. hooks.json: strip old entries, add the current enforce wrapper.
  const file = stripMemrosettaHooks(readCodexHooksFile());
  const newHooks = { ...(file.hooks ?? {}) } as Record<string, CodexHookConfig[]>;
  const existingStop = (newHooks.Stop ?? []) as CodexHookConfig[];
  newHooks.Stop = [
    ...existingStop,
    {
      matcher: '*',
      hooks: [
        {
          type: 'command',
          command: resolveHookCommand('memrosetta-enforce-codex'),
          timeout: 30,
          statusMessage: 'memrosetta: enforcing memory capture',
        },
      ],
    },
  ];
  writeCodexHooksFile({ ...file, hooks: newHooks });

  // 2. config.toml: enable the feature flag if missing.
  const configPath = getCodexConfigPath();
  const configContent = readCodexConfig(configPath);
  const updated = ensureHooksFeatureFlag(configContent);
  if (updated !== configContent) {
    writeFileSync(configPath, updated, 'utf-8');
  }

  return true;
}

/**
 * Remove the MemRosetta Codex Stop hook entry and, if nothing else is
 * left in `[features] codex_hooks`, turn the feature flag off as well.
 *
 * Returns true if anything was removed, false if the hook was not
 * configured in the first place.
 */
export function removeCodexHooks(): boolean {
  const hadHook = isCodexHooksConfigured();

  // Strip any memrosetta entries from hooks.json. Keep the file around
  // because the user may have other non-memrosetta hooks registered.
  const file = readCodexHooksFile();
  const cleaned = stripMemrosettaHooks(file);
  const anyOtherHooks = Object.values(cleaned.hooks ?? {}).some(
    (cfgs) => (cfgs as readonly CodexHookConfig[]).length > 0,
  );

  if (hadHook) {
    if (anyOtherHooks) {
      writeCodexHooksFile(cleaned);
    } else {
      // No hooks of any kind left — remove the file entirely so a
      // future install starts from a clean slate.
      const hooksPath = CODEX_HOOKS_PATH_GETTER();
      if (existsSync(hooksPath)) {
        writeCodexHooksFile({});
      }
    }
  }

  // If no other Stop hooks and no other events, also turn off the
  // feature flag so we don't leave dead config behind.
  if (!anyOtherHooks) {
    const configPath = getCodexConfigPath();
    if (existsSync(configPath)) {
      const configContent = readCodexConfig(configPath);
      const stripped = stripHooksFeatureFlag(configContent);
      if (stripped !== configContent) {
        writeFileSync(configPath, stripped, 'utf-8');
      }
    }
  }

  return hadHook;
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
