import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve MCP server command.
 * Priority: global binary > node + resolved path > bare command fallback
 */
export function resolveMcpCommand(): {
  readonly command: string;
  readonly args: readonly string[];
} {
  if (isInPath('memrosetta-mcp')) {
    return { command: 'memrosetta-mcp', args: [] };
  }

  // Try to resolve the MCP entry point from installed packages
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
    // Package not resolvable -- fall through
  }

  // Last resort: bare command name
  return { command: 'memrosetta-mcp', args: [] };
}

/**
 * Resolve hook command (on-stop or on-prompt).
 * Priority: global binary > node + resolved path > bare command fallback
 */
export function resolveHookCommand(
  hookName: 'memrosetta-on-stop' | 'memrosetta-on-prompt',
): string {
  if (isInPath(hookName)) {
    return hookName;
  }

  // Try to resolve from the CLI package dist
  try {
    const require = createRequire(import.meta.url);
    const hookFile =
      hookName === 'memrosetta-on-stop'
        ? 'hooks/on-stop.js'
        : 'hooks/on-prompt.js';
    const cliPkgPath = dirname(
      require.resolve('@memrosetta/cli/package.json'),
    );
    const entryPoint = join(cliPkgPath, 'dist', hookFile);
    if (existsSync(entryPoint)) {
      return `node ${entryPoint}`;
    }
  } catch {
    // Package not resolvable -- fall through
  }

  // Last resort: bare command name
  return hookName;
}
