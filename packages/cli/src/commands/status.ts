import { existsSync, statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { getDefaultDbPath } from '../engine.js';
import { output, type OutputFormat } from '../output.js';
import { getConfig } from '../hooks/config.js';

function getVersion(): string {
  // Try multiple strategies to find the version
  const strategies = [
    // 1. Relative to source (dev/source checkout via tsx)
    () => {
      const require = createRequire(import.meta.url);
      return (require('../../package.json') as { version: string }).version;
    },
    // 2. Resolve from npm package
    () => {
      const require = createRequire(import.meta.url);
      return (require('@memrosetta/cli/package.json') as { version: string }).version;
    },
    // 3. Walk up to find package.json from current file location
    () => {
      const dir = dirname(fileURLToPath(import.meta.url));
      // From dist/commands/ -> dist/ -> package root
      for (let d = dir, i = 0; i < 5; i++) {
        const candidate = join(d, 'package.json');
        if (existsSync(candidate)) {
          const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as { name?: string; version?: string };
          if (pkg.name?.includes('memrosetta') && pkg.version) return pkg.version;
        }
        d = dirname(d);
      }
      throw new Error('not found');
    },
  ];

  for (const strategy of strategies) {
    try {
      return strategy();
    } catch {}
  }
  return 'unknown';
}
import {
  isClaudeCodeConfigured,
  isGenericMCPConfigured,
  isCursorConfigured,
  isCodexConfigured,
} from '../integrations/index.js';

interface StatusOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

export async function run(options: StatusOptions): Promise<void> {
  const { format, db, noEmbeddings } = options;

  const config = getConfig();
  const dbPath = db ?? config.dbPath ?? getDefaultDbPath();
  const exists = existsSync(dbPath);

  let sizeBytes = 0;
  let sizeFormatted = '0B';
  let memoryCount = 0;
  let userList: readonly string[] = [];
  let qualityFresh = 0;
  let qualityInvalidated = 0;
  let qualityWithRelations = 0;
  let qualityAvgActivation = 0;
  const embeddingsEnabled = !noEmbeddings && config.enableEmbeddings !== false;

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

      // Quality stats
      const freshRow = dbConn.prepare(
        'SELECT COUNT(*) as c FROM memories WHERE is_latest = 1 AND invalidated_at IS NULL',
      ).get() as { c: number };
      qualityFresh = freshRow.c;

      const invalidatedRow = dbConn.prepare(
        'SELECT COUNT(*) as c FROM memories WHERE invalidated_at IS NOT NULL',
      ).get() as { c: number };
      qualityInvalidated = invalidatedRow.c;

      const relationsRow = dbConn.prepare(
        'SELECT COUNT(DISTINCT src_memory_id) + COUNT(DISTINCT dst_memory_id) as c FROM memory_relations',
      ).get() as { c: number };
      qualityWithRelations = relationsRow.c;

      const avgRow = dbConn.prepare(
        'SELECT AVG(activation_score) as avg FROM memories WHERE is_latest = 1',
      ).get() as { avg: number | null };
      qualityAvgActivation = avgRow.avg ?? 0;

      dbConn.close();
    } catch {
      // DB may not be initialized yet
    }
  }

  // Integration status
  const claudeCodeStatus = isClaudeCodeConfigured();
  const cursorStatus = isCursorConfigured();
  const codexStatus = isCodexConfigured();
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

    if (memoryCount > 0) {
      process.stdout.write('\nQuality:\n');
      process.stdout.write(
        `  Fresh (is_latest=1):    ${qualityFresh} / ${memoryCount}\n`,
      );
      process.stdout.write(`  Invalidated:            ${qualityInvalidated}\n`);
      process.stdout.write(`  With relations:         ${qualityWithRelations}\n`);
      process.stdout.write(
        `  Avg activation:         ${qualityAvgActivation.toFixed(2)}\n`,
      );
    }

    process.stdout.write('\nIntegrations:\n');
    process.stdout.write(
      `  Claude Code:   ${claudeCodeStatus ? 'configured (hooks + MCP)' : 'not configured'}\n`,
    );
    process.stdout.write(
      `  Cursor:        ${cursorStatus ? 'configured (MCP)' : 'not configured'}\n`,
    );
    process.stdout.write(
      `  Codex:         ${codexStatus ? 'configured (MCP)' : 'not configured'}\n`,
    );
    process.stdout.write(
      `  MCP (generic): ${mcpStatus ? 'configured' : 'not configured'}\n`,
    );
    return;
  }

  output(
    {
      version: getVersion(),
      database: {
        path: dbPath,
        exists,
        sizeBytes,
        sizeFormatted,
      },
      memories: memoryCount,
      users: userList,
      quality: {
        fresh: qualityFresh,
        invalidated: qualityInvalidated,
        withRelations: qualityWithRelations,
        avgActivation: qualityAvgActivation,
      },
      embeddings: embeddingsEnabled,
      embeddingModel: getEmbeddingModelLabel(),
      embeddingPreset: getConfig().embeddingPreset ?? 'en',
      integrations: {
        claudeCode: claudeCodeStatus,
        cursor: cursorStatus,
        codex: codexStatus,
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
