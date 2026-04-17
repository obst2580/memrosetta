import { existsSync, statSync } from 'node:fs';
import { getDefaultDbPath } from '../engine.js';
import { output, type OutputFormat } from '../output.js';
import { getConfig } from '../hooks/config.js';
import { resolveCliVersion } from '../version.js';
import {
  isClaudeCodeConfigured,
  isGenericMCPConfigured,
  isCursorConfigured,
  isCodexConfigured,
  isGeminiConfigured,
} from '../integrations/index.js';

interface StatusOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

export type RecallReadiness = 'ready' | 'degraded' | 'empty' | 'unknown';

interface EpisodicStats {
  readonly episodes: number;
  readonly bindings: number;
  readonly index: number;
  readonly constructs: number;
  readonly readiness: RecallReadiness;
}

export async function run(options: StatusOptions): Promise<void> {
  const { format, db } = options;

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
  let episodic: EpisodicStats = {
    episodes: 0,
    bindings: 0,
    index: 0,
    constructs: 0,
    readiness: 'unknown',
  };

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

      episodic = readEpisodicStats(dbConn, memoryCount);

      dbConn.close();
    } catch {
      // DB may not be initialized yet
    }
  }

  // Integration status
  const claudeCodeStatus = isClaudeCodeConfigured();
  const cursorStatus = isCursorConfigured();
  const codexStatus = isCodexConfigured();
  const geminiStatus = isGeminiConfigured();
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

      process.stdout.write('\nRecall readiness:\n');
      process.stdout.write(
        `  Episodes:               ${episodic.episodes}\n`,
      );
      process.stdout.write(
        `  Episodic bindings:      ${episodic.bindings}\n`,
      );
      process.stdout.write(
        `  Episodic index entries: ${episodic.index}\n`,
      );
      process.stdout.write(
        `  Construct exemplars:    ${episodic.constructs}\n`,
      );
      process.stdout.write(
        `  Status:                 ${episodic.readiness}${readinessHint(episodic.readiness)}\n`,
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
      `  Gemini:        ${geminiStatus ? 'configured (MCP)' : 'not configured'}\n`,
    );
    process.stdout.write(
      `  MCP (generic): ${mcpStatus ? 'configured' : 'not configured'}\n`,
    );
    return;
  }

  output(
    {
      version: resolveCliVersion(),
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
      recall: {
        episodes: episodic.episodes,
        episodicBindings: episodic.bindings,
        episodicIndex: episodic.index,
        constructExemplars: episodic.constructs,
        readiness: episodic.readiness,
      },
      integrations: {
        claudeCode: claudeCodeStatus,
        cursor: cursorStatus,
        codex: codexStatus,
        gemini: geminiStatus,
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

/**
 * Coverage ratio below which we still call the layer `degraded` even
 * if every table is non-empty. Without this guard, a DB where only
 * 46% of memories have episodic bindings (the exact state Codex
 * observed on the Windows upgrade) would be classified `ready`,
 * hiding the fact that more than half the user's memories are still
 * invisible to the reconstructive kernel.
 */
export const READY_BINDING_COVERAGE = 0.95;

/**
 * Pure function extracted for testability. Given the four layer
 * counts plus the total live memory count, return the readiness
 * verdict. No I/O, no side effects.
 */
export function deriveReadiness(input: {
  readonly memoryCount: number;
  readonly episodes: number;
  readonly bindings: number;
  readonly index: number;
}): RecallReadiness {
  const { memoryCount, episodes, bindings, index } = input;
  if (memoryCount === 0) return 'empty';
  if (episodes === 0 && bindings === 0) return 'empty';
  if (
    episodes > 0 &&
    bindings > 0 &&
    index > 0 &&
    bindings / Math.max(1, memoryCount) >= READY_BINDING_COVERAGE
  ) {
    return 'ready';
  }
  return 'degraded';
}

/**
 * Read v1.0 episodic layer counts and derive a single `readiness`
 * verdict that `recall` can be evaluated against:
 *
 * - `ready`    → episodes + index + bindings all populated AND at
 *                least READY_BINDING_COVERAGE of live memories are
 *                bound to an episode. Less than that is a partial
 *                backfill, which is surfaced as `degraded`.
 * - `degraded` → some tables non-empty but not all, OR binding
 *                coverage is below the ready threshold.
 * - `empty`    → memories exist but none of episodes/bindings do.
 *                This is the state where `recall` cannot reconstruct.
 * - `unknown`  → read failed (likely pre-v10 schema).
 */
function readEpisodicStats(
  dbConn: import('better-sqlite3').Database,
  memoryCount: number,
): EpisodicStats {
  const countOr = (table: string): number => {
    try {
      const row = dbConn.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as
        | { c: number }
        | undefined;
      return row?.c ?? 0;
    } catch {
      return 0;
    }
  };
  const episodes = countOr('episodes');
  const bindings = countOr('memory_episodic_bindings');
  const index = countOr('episodic_index');
  const constructs = countOr('construct_exemplars');

  const readiness = deriveReadiness({ memoryCount, episodes, bindings, index });

  return { episodes, bindings, index, constructs, readiness };
}

function readinessHint(r: RecallReadiness): string {
  if (r === 'empty')
    return "  ← run 'memrosetta maintain --build-episodes' to enable recall";
  if (r === 'degraded')
    return "  ← partial; consider re-running 'memrosetta maintain --build-episodes'";
  return '';
}
