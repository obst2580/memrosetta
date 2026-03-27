import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isInPath(command: string): boolean {
  try {
    const cmd =
      process.platform === 'win32'
        ? `where ${command}`
        : `command -v ${command}`;
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk up from a starting directory to find a file/directory.
 * Returns the found path or null.
 */
function findUpwards(startDir: string, target: string, maxLevels: number = 6): string | null {
  let dir = startDir;
  for (let i = 0; i < maxLevels; i++) {
    const candidate = join(dir, target);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve MCP server command.
 * Priority: global binary > require.resolve > workspace relative > bare fallback
 */
export function resolveMcpCommand(): {
  readonly command: string;
  readonly args: readonly string[];
} {
  // 1. Global binary in PATH
  if (isInPath('memrosetta-mcp')) {
    return { command: 'memrosetta-mcp', args: [] };
  }

  // 2. Try require.resolve (works for npm-installed dependencies)
  try {
    const require = createRequire(import.meta.url);
    const mcpPkgPath = dirname(
      require.resolve('@memrosetta/mcp/package.json'),
    );
    const entryPoint = join(mcpPkgPath, 'dist', 'index.js');
    if (existsSync(entryPoint)) {
      return { command: 'node', args: [entryPoint] };
    }
  } catch {
    // Not resolvable via require -- try workspace layout
  }

  // 3. Workspace relative path (source checkout)
  // From packages/cli/src/integrations/ walk up to find adapters/mcp/dist/index.js
  const workspaceRoot = findUpwards(__dirname, 'pnpm-workspace.yaml');
  if (workspaceRoot) {
    const rootDir = dirname(workspaceRoot);
    const mcpEntry = join(rootDir, 'adapters', 'mcp', 'dist', 'index.js');
    if (existsSync(mcpEntry)) {
      return { command: 'node', args: [mcpEntry] };
    }
    // Also check src (unbundled)
    const mcpSrc = join(rootDir, 'adapters', 'mcp', 'src', 'index.ts');
    if (existsSync(mcpSrc)) {
      return { command: 'npx', args: ['tsx', mcpSrc] };
    }
  }

  // 4. Bare command fallback
  return { command: 'memrosetta-mcp', args: [] };
}

/**
 * Resolve hook command (on-stop or on-prompt).
 * Priority: global binary > require.resolve > workspace relative > bare fallback
 */
export function resolveHookCommand(
  hookName: 'memrosetta-on-stop' | 'memrosetta-on-prompt',
): string {
  // 1. Global binary in PATH
  if (isInPath(hookName)) {
    return hookName;
  }

  const hookFile =
    hookName === 'memrosetta-on-stop'
      ? 'hooks/on-stop.js'
      : 'hooks/on-prompt.js';

  // 2. Try require.resolve
  try {
    const require = createRequire(import.meta.url);
    const cliPkgPath = dirname(
      require.resolve('@memrosetta/cli/package.json'),
    );
    const entryPoint = join(cliPkgPath, 'dist', hookFile);
    if (existsSync(entryPoint)) {
      return `node "${entryPoint}"`;
    }
  } catch {
    // Not resolvable -- try workspace
  }

  // 3. Workspace relative path
  // From packages/cli/src/integrations/ the dist hooks are at ../../dist/hooks/
  const distHook = resolve(__dirname, '..', '..', 'dist', hookFile);
  if (existsSync(distHook)) {
    return `node "${distHook}"`;
  }

  // Also check workspace root layout
  const workspaceRoot = findUpwards(__dirname, 'pnpm-workspace.yaml');
  if (workspaceRoot) {
    const rootDir = dirname(workspaceRoot);
    const hookEntry = join(rootDir, 'packages', 'cli', 'dist', hookFile);
    if (existsSync(hookEntry)) {
      return `node "${hookEntry}"`;
    }
  }

  // 4. Bare command fallback
  return hookName;
}
