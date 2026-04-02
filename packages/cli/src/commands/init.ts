import { existsSync } from 'node:fs';
import { getEngine, getDefaultDbPath } from '../engine.js';
import { output, type OutputFormat } from '../output.js';
import { hasFlag, optionalOption } from '../parser.js';
import {
  getConfig,
  writeConfig,
} from '../hooks/config.js';
import {
  isClaudeCodeInstalled,
  registerClaudeCodeHooks,
  updateClaudeMd,
  registerGenericMCP,
  registerCursorMCP,
  registerCodexMCP,
  registerGeminiMCP,
  isCodexInstalled,
  isGeminiInstalled,
  getGenericMCPPath,
  getCursorMcpConfigPath,
  getCursorRulesPath,
  getCodexConfigFilePath,
  getAgentsMdPath,
  getGeminiSettingsFilePath,
  getGeminiMdPath,
} from '../integrations/index.js';

type EmbeddingPresetFlag = 'en' | 'multi' | 'ko';

const LANG_FLAG_TO_PRESET: Record<EmbeddingPresetFlag, 'en' | 'multilingual' | 'ko'> = {
  en: 'en',
  multi: 'multilingual',
  ko: 'ko',
};

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
    readonly codex?: {
      readonly mcp: boolean;
      readonly path: string;
      readonly agentsMd: boolean;
      readonly agentsMdPath: string;
    };
    readonly gemini?: {
      readonly mcp: boolean;
      readonly path: string;
      readonly geminiMd: boolean;
      readonly geminiMdPath: string;
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
  const wantCodex = hasFlag(args, '--codex');
  const wantGemini = hasFlag(args, '--gemini');

  // Parse --lang flag for embedding preset
  const langFlag = optionalOption(args, '--lang') as EmbeddingPresetFlag | undefined;
  const embeddingPreset = langFlag ? LANG_FLAG_TO_PRESET[langFlag] : undefined;

  if (langFlag && !LANG_FLAG_TO_PRESET[langFlag]) {
    process.stderr.write(
      `Unknown --lang value: "${langFlag}". Supported: en, multi, ko\n`,
    );
    process.exitCode = 1;
    return;
  }

  // Persist init options to config
  {
    const config = getConfig();
    const updates: Partial<{ -readonly [K in keyof typeof config]: (typeof config)[K] }> = {};
    if (db) {
      updates.dbPath = db;
    }
    if (noEmbeddings) {
      updates.enableEmbeddings = false;
    }
    if (embeddingPreset) {
      updates.embeddingPreset = embeddingPreset;
    }
    if (Object.keys(updates).length > 0) {
      writeConfig({ ...config, ...updates });
    }
  }

  // 1. Always: init DB
  const config = getConfig();
  const dbPath = db ?? config.dbPath ?? getDefaultDbPath();
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
    const cursorRulesUpdated = registerCursorMCP();

    (result.integrations as Record<string, unknown>).cursor = {
      mcp: true,
      path: getCursorMcpConfigPath(),
      cursorRules: cursorRulesUpdated,
      cursorRulesPath: getCursorRulesPath(),
    };
  }

  // 5. --codex: register MCP in ~/.codex/config.toml + AGENTS.md
  if (wantCodex) {
    const agentsMdUpdated = registerCodexMCP();

    (result.integrations as Record<string, unknown>).codex = {
      mcp: true,
      path: getCodexConfigFilePath(),
      agentsMd: agentsMdUpdated,
      agentsMdPath: getAgentsMdPath(),
    };
  }

  // 6. --gemini: register MCP in ~/.gemini/settings.json + GEMINI.md
  if (wantGemini) {
    const geminiMdUpdated = registerGeminiMCP();

    (result.integrations as Record<string, unknown>).gemini = {
      mcp: true,
      path: getGeminiSettingsFilePath(),
      geminiMd: geminiMdUpdated,
      geminiMdPath: getGeminiMdPath(),
    };
  }

  // 7. Output
  if (format === 'text') {
    printTextOutput(result, wantClaudeCode, wantCursor, wantCodex, wantGemini);
    return;
  }

  output(result, format);
}

function printTextOutput(
  result: InitResult,
  claudeCode: boolean,
  cursor: boolean,
  codex: boolean = false,
  gemini: boolean = false,
): void {
  const w = (s: string) => process.stdout.write(s);

  w('\nMemRosetta initialized successfully.\n\n');
  w('  What was set up:\n');
  w('  ----------------------------------------\n');
  w(`  Database:   ${result.database.path}`);
  w(result.database.created ? ' (created)\n' : ' (already exists)\n');
  w(`  MCP Server: ${result.integrations.mcp!.path} (always included)\n`);

  const currentConfig = getConfig();
  if (currentConfig.embeddingPreset && currentConfig.embeddingPreset !== 'en') {
    const presetLabels: Record<string, string> = {
      multilingual: 'multilingual (multilingual-e5-small)',
      ko: 'Korean (ko-sroberta-multitask)',
    };
    w(`  Embeddings: ${presetLabels[currentConfig.embeddingPreset] ?? currentConfig.embeddingPreset}\n`);
  }

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

  if (codex) {
    w(`  Codex MCP:  ${result.integrations.codex!.path}\n`);
    if (result.integrations.codex!.agentsMd) {
      w(`  AGENTS.md:  ${result.integrations.codex!.agentsMdPath} (memory instructions added)\n`);
    } else {
      w('  AGENTS.md:  already configured\n');
    }
  }

  if (gemini) {
    w(`  Gemini MCP: ${result.integrations.gemini!.path}\n`);
    if (result.integrations.gemini!.geminiMd) {
      w(`  GEMINI.md:  ${result.integrations.gemini!.geminiMdPath} (memory instructions added)\n`);
    } else {
      w('  GEMINI.md:  already configured\n');
    }
  }

  w('\n');

  if (!claudeCode && !cursor && !codex && !gemini) {
    w('  MCP is ready. Add --claude-code, --cursor, --codex, or --gemini for tool-specific setup.\n');
    w('  Example: memrosetta init --claude-code\n');
    w('\n');
  }

  if (claudeCode) {
    w('  Restart Claude Code to activate.\n\n');
  }
}
