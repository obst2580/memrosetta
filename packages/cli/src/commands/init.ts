import { existsSync } from 'node:fs';
import { getEngine, getDefaultDbPath } from '../engine.js';
import { output, type OutputFormat } from '../output.js';
import { hasFlag } from '../parser.js';
import {
  isClaudeCodeInstalled,
  registerClaudeCodeHooks,
  updateClaudeMd,
  registerGenericMCP,
  registerCursorMCP,
  getGenericMCPPath,
  getCursorMcpConfigPath,
  getCursorRulesPath,
} from '../integrations/index.js';

interface InitOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

interface InitResult {
  readonly database: {
    readonly path: string;
    readonly created: boolean;
  };
  readonly integrations: {
    readonly claudeCode?: {
      readonly hooks: boolean;
      readonly mcp: boolean;
      readonly claudeMd: boolean;
    };
    readonly cursor?: {
      readonly mcp: boolean;
      readonly path: string;
      readonly cursorRules: boolean;
      readonly cursorRulesPath: string;
    };
    readonly mcp?: {
      readonly registered: boolean;
      readonly path: string;
    };
  };
}

export async function run(options: InitOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  const wantClaudeCode = hasFlag(args, '--claude-code');
  const wantCursor = hasFlag(args, '--cursor');

  // 1. Always: init DB
  const dbPath = db ?? getDefaultDbPath();
  const existed = existsSync(dbPath);

  const engine = await getEngine({ db: dbPath, noEmbeddings });
  await engine.close();

  const result: InitResult = {
    database: {
      path: dbPath,
      created: !existed,
    },
    integrations: {},
  };

  // 2. Always: register MCP server (base functionality)
  registerGenericMCP();
  (result.integrations as Record<string, unknown>).mcp = {
    registered: true,
    path: getGenericMCPPath(),
  };

  // 3. --claude-code: additionally register hooks + CLAUDE.md
  if (wantClaudeCode) {
    const hooksOk = registerClaudeCodeHooks();
    const claudeMdOk = updateClaudeMd();

    (result.integrations as Record<string, unknown>).claudeCode = {
      hooks: hooksOk,
      mcp: true,
      claudeMd: claudeMdOk,
    };
  }

  // 4. --cursor: additionally register MCP in .cursor/ + .cursorrules
  if (wantCursor) {
    registerCursorMCP();

    (result.integrations as Record<string, unknown>).cursor = {
      mcp: true,
      path: getCursorMcpConfigPath(),
      cursorRules: true,
      cursorRulesPath: getCursorRulesPath(),
    };
  }

  // 5. Output
  if (format === 'text') {
    printTextOutput(result, wantClaudeCode, wantCursor);
    return;
  }

  output(result, format);
}

function printTextOutput(
  result: InitResult,
  claudeCode: boolean,
  cursor: boolean,
): void {
  const w = (s: string) => process.stdout.write(s);

  w('\nMemRosetta initialized successfully.\n\n');
  w('  What was set up:\n');
  w('  ----------------------------------------\n');
  w(`  Database:   ${result.database.path}`);
  w(result.database.created ? ' (created)\n' : ' (already exists)\n');
  w(`  MCP Server: ${result.integrations.mcp!.path} (always included)\n`);

  if (claudeCode) {
    const cc = result.integrations.claudeCode!;
    if (cc.hooks) {
      w('  Stop Hook:  ~/.claude/settings.json (auto-save on session end)\n');
    } else if (!isClaudeCodeInstalled()) {
      w('  Stop Hook:  SKIPPED (Claude Code not found at ~/.claude)\n');
      w('              Install Claude Code first, then run "memrosetta init --claude-code" again.\n');
    }
    if (cc.claudeMd) {
      w('  CLAUDE.md:  ~/.claude/CLAUDE.md (memory instructions added)\n');
    } else {
      w('  CLAUDE.md:  already configured\n');
    }
  }

  if (cursor) {
    w(`  Cursor MCP: ${result.integrations.cursor!.path}\n`);
    if (result.integrations.cursor!.cursorRules) {
      w(`  .cursorrules: ${result.integrations.cursor!.cursorRulesPath} (memory instructions added)\n`);
    } else {
      w('  .cursorrules: already configured\n');
    }
  }

  w('\n');

  if (!claudeCode && !cursor) {
    w('  MCP is ready. Add --claude-code or --cursor for tool-specific setup.\n');
    w('  Example: memrosetta init --claude-code\n');
    w('\n');
  }

  if (claudeCode) {
    w('  Restart Claude Code to activate.\n\n');
  }
}
