import { join } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';

const MEMROSETTA_DIR = join(homedir(), '.memrosetta');
const CONFIG_PATH = join(MEMROSETTA_DIR, 'config.json');
const DB_PATH = join(MEMROSETTA_DIR, 'memories.db');

export interface MemRosettaConfig {
  readonly dbPath: string;
  readonly enableEmbeddings: boolean;
  readonly maxRecallResults: number;
  readonly minQueryLength: number;
  readonly maxContextChars: number;
  readonly llmProvider?: 'openai' | 'anthropic';
  readonly llmApiKey?: string;
  readonly llmModel?: string;
  readonly embeddingPreset?: 'en' | 'multilingual' | 'ko';
  readonly syncEnabled?: boolean;
  readonly syncServerUrl?: string;
  readonly syncApiKey?: string;
  readonly syncDeviceId?: string;
  readonly syncUserId?: string;
  readonly syncAuthMode?: 'api_key' | 'oauth';
  readonly syncAccessToken?: string;
  readonly syncRefreshToken?: string;
  readonly syncTokenExpiresAt?: string;
  readonly syncAccountEmail?: string;
  readonly syncProvider?: 'github' | 'google';
}

const DEFAULT_CONFIG: MemRosettaConfig = {
  dbPath: DB_PATH,
  enableEmbeddings: true,
  maxRecallResults: 5,
  minQueryLength: 5,
  maxContextChars: 2000,
};

export function getConfigDir(): string {
  return MEMROSETTA_DIR;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function getDefaultDbPath(): string {
  return DB_PATH;
}

export function ensureDir(): void {
  if (!existsSync(MEMROSETTA_DIR)) {
    mkdirSync(MEMROSETTA_DIR, { recursive: true, mode: 0o700 });
  }
  try {
    chmodSync(MEMROSETTA_DIR, 0o700);
  } catch {
    // Best-effort on non-POSIX systems (Windows)
  }
}

export function getConfig(): MemRosettaConfig {
  if (!existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<MemRosettaConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function writeConfig(config: MemRosettaConfig): void {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    // Best-effort on non-POSIX systems
  }
}

export function writeDefaultConfig(): void {
  writeConfig(DEFAULT_CONFIG);
}

/**
 * Canonical user identity resolution.
 *
 * Priority:
 *   1. explicit argument (`--user <id>`)
 *   2. `config.syncUserId` from ~/.memrosetta/config.json
 *   3. OS username (`whoami`)
 *
 * This single entry point is used by every write and read path —
 * CLI commands, MCP tools, hook extractor, enforce pipeline — so the
 * same memory is identifiable across devices even when the OS username
 * differs (e.g. Mac `obst` vs Windows `jhlee13`). The user pins their
 * canonical identity once via `memrosetta sync enable --user <id>`
 * and everything else inherits it.
 *
 * The `configLoader` parameter is there solely to make the function
 * unit-testable without touching the real `~/.memrosetta/config.json`.
 * Production callers never pass it.
 */
export function resolveCanonicalUserId(
  explicit?: string | null,
  configLoader: () => MemRosettaConfig = getConfig,
): string {
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim();
  }
  const config = configLoader();
  if (config.syncUserId && config.syncUserId.trim().length > 0) {
    return config.syncUserId.trim();
  }
  return userInfo().username;
}

/**
 * @deprecated Use `resolveCanonicalUserId()` instead. Retained for
 * backwards compatibility with callers that have not been migrated
 * yet. New code must never fall back straight to the OS username
 * without checking config.syncUserId first.
 */
export function getDefaultUserId(): string {
  return resolveCanonicalUserId();
}
