import { join } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

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
}

const DEFAULT_CONFIG: MemRosettaConfig = {
  dbPath: DB_PATH,
  enableEmbeddings: false,
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
    mkdirSync(MEMROSETTA_DIR, { recursive: true });
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
}

export function writeDefaultConfig(): void {
  writeConfig(DEFAULT_CONFIG);
}

export function getDefaultUserId(): string {
  return userInfo().username;
}
