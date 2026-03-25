import { hasFlag } from '../parser.js';
import { output, type OutputFormat } from '../output.js';
import {
  removeClaudeCodeHooks,
  removeClaudeMdSection,
  removeGenericMCP,
  removeCursorMCP,
} from '../integrations/index.js';

interface ResetOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

interface ResetResult {
  readonly removed: {
    readonly claudeCodeHooks: boolean;
    readonly claudeMd: boolean;
    readonly mcp: boolean;
    readonly cursor: boolean;
  };
}

export async function run(options: ResetOptions): Promise<void> {
  const { args, format } = options;

  const wantClaudeCode = hasFlag(args, '--claude-code');
  const wantCursor = hasFlag(args, '--cursor');
  const wantMCP = hasFlag(args, '--mcp');
  const wantAll = hasFlag(args, '--all');

  const noFlags = !wantClaudeCode && !wantCursor && !wantMCP && !wantAll;

  if (noFlags) {
    const msg =
      'Usage: memrosetta reset [--claude-code] [--cursor] [--mcp] [--all]\n' +
      '\n' +
      'Flags:\n' +
      '  --claude-code  Remove Claude Code hooks, MCP, and CLAUDE.md section\n' +
      '  --cursor       Remove Cursor MCP configuration\n' +
      '  --mcp          Remove generic MCP configuration (~/.mcp.json)\n' +
      '  --all          Remove all integrations\n';

    if (format === 'text') {
      process.stdout.write(msg);
    } else {
      output({ error: 'No flags specified. Use --claude-code, --cursor, --mcp, or --all.' }, format);
    }
    return;
  }

  const result: ResetResult = {
    removed: {
      claudeCodeHooks: false,
      claudeMd: false,
      mcp: false,
      cursor: false,
    },
  };

  // Claude Code
  if (wantClaudeCode || wantAll) {
    const hooksRemoved = removeClaudeCodeHooks();
    const mdRemoved = removeClaudeMdSection();
    const mcpRemoved = removeGenericMCP();

    (result.removed as Record<string, boolean>).claudeCodeHooks = hooksRemoved;
    (result.removed as Record<string, boolean>).claudeMd = mdRemoved;

    // Only attribute MCP removal to claude-code if not also removing --mcp explicitly
    if (!wantMCP) {
      (result.removed as Record<string, boolean>).mcp = mcpRemoved;
    }
  }

  // Cursor
  if (wantCursor || wantAll) {
    const removed = removeCursorMCP();
    (result.removed as Record<string, boolean>).cursor = removed;
  }

  // Generic MCP
  if (wantMCP || wantAll) {
    const removed = removeGenericMCP();
    (result.removed as Record<string, boolean>).mcp = removed;
  }

  if (format === 'text') {
    printTextOutput(result);
    return;
  }

  output(result, format);
}

function printTextOutput(result: ResetResult): void {
  const w = (s: string) => process.stdout.write(s);
  const removed = result.removed;

  if (removed.claudeCodeHooks) {
    w('Removed Claude Code hooks from ~/.claude/settings.json\n');
  }
  if (removed.claudeMd) {
    w('Removed MemRosetta section from ~/.claude/CLAUDE.md\n');
  }
  if (removed.mcp) {
    w('Removed MCP server from ~/.mcp.json\n');
  }
  if (removed.cursor) {
    w('Removed Cursor MCP from ~/.cursor/mcp.json\n');
  }

  const anyRemoved =
    removed.claudeCodeHooks ||
    removed.claudeMd ||
    removed.mcp ||
    removed.cursor;

  if (!anyRemoved) {
    w('Nothing to remove (no integrations were configured).\n');
  }

  w(
    '\nNote: ~/.memrosetta/ directory preserved. Delete manually if needed:\n' +
    '  rm -rf ~/.memrosetta\n',
  );
}
