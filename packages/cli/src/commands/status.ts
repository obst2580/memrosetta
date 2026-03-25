import { existsSync, statSync } from 'node:fs';
import { getDefaultDbPath } from '../engine.js';
import { output, type OutputFormat } from '../output.js';
import { getConfig } from '../hooks/config.js';
import {
  isClaudeCodeConfigured,
  isGenericMCPConfigured,
  isCursorConfigured,
} from '../integrations/index.js';

interface StatusOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

export async function run(options: StatusOptions): Promise<void> {
  const { format, db, noEmbeddings } = options;

  const dbPath = db ?? getDefaultDbPath();
  const exists = existsSync(dbPath);

  let sizeBytes = 0;
  let sizeFormatted = '0B';
  let memoryCount = 0;
  let userList: readonly string[] = [];
  const embeddingsEnabled = !noEmbeddings;

  if (exists) {
    const stat = statSync(dbPath);
    sizeBytes = stat.size;
    sizeFormatted = formatSize(sizeBytes);

    try {
      const Database = (await import('better-sqlite3')).default;
      const dbConn = new Database(dbPath);
      dbConn.pragma('journal_mode = WAL');

      const countRow = dbConn
        .prepare('SELECT COUNT(*) as count FROM memories')
        .get() as { count: number };
      memoryCount = countRow.count;

      const userRows = dbConn
        .prepare('SELECT DISTINCT user_id FROM memories ORDER BY user_id')
        .all() as readonly { user_id: string }[];
      userList = userRows.map((r) => r.user_id);

      dbConn.close();
    } catch {
      // DB may not be initialized yet
    }
  }

  // Integration status
  const claudeCodeStatus = isClaudeCodeConfigured();
  const cursorStatus = isCursorConfigured();
  const mcpStatus = isGenericMCPConfigured();

  if (format === 'text') {
    process.stdout.write('MemRosetta Status\n');
    process.stdout.write(`${'='.repeat(40)}\n\n`);

    process.stdout.write(
      `Database: ${dbPath} (${exists ? `exists, ${sizeFormatted}` : 'not found'})\n`,
    );
    process.stdout.write(`Memories: ${memoryCount}\n`);
    if (userList.length > 0) {
      process.stdout.write(
        `Users: ${userList.length} (${userList.join(', ')})\n`,
      );
    } else {
      process.stdout.write('Users: 0\n');
    }
    const embeddingModelLabel = getEmbeddingModelLabel();
    process.stdout.write(
      `Embeddings: ${embeddingsEnabled ? `enabled (${embeddingModelLabel})` : 'disabled'}\n`,
    );

    process.stdout.write('\nIntegrations:\n');
    process.stdout.write(
      `  Claude Code:   ${claudeCodeStatus ? 'configured (hooks + MCP)' : 'not configured'}\n`,
    );
    process.stdout.write(
      `  Cursor:        ${cursorStatus ? 'configured (MCP)' : 'not configured'}\n`,
    );
    process.stdout.write(
      `  MCP (generic): ${mcpStatus ? 'configured' : 'not configured'}\n`,
    );
    return;
  }

  output(
    {
      version: '0.1.0',
      database: {
        path: dbPath,
        exists,
        sizeBytes,
        sizeFormatted,
      },
      memories: memoryCount,
      users: userList,
      embeddings: embeddingsEnabled,
      embeddingModel: getEmbeddingModelLabel(),
      embeddingPreset: getConfig().embeddingPreset ?? 'en',
      integrations: {
        claudeCode: claudeCodeStatus,
        cursor: cursorStatus,
        mcp: mcpStatus,
      },
    },
    format,
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const PRESET_MODEL_LABELS: Record<string, string> = {
  en: 'bge-small-en-v1.5',
  multilingual: 'multilingual-e5-small',
  ko: 'ko-sroberta-multitask',
};

function getEmbeddingModelLabel(): string {
  const config = getConfig();
  const preset = config.embeddingPreset ?? 'en';
  return PRESET_MODEL_LABELS[preset] ?? preset;
}
