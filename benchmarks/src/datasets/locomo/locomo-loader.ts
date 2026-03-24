import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BenchmarkDataset } from '../dataset-loader.js';
import type { DatasetLoader } from '../dataset-loader.js';
import type { LoCoMoConverterStrategy } from './converter-types.js';
import { convertLoCoMoDataset } from './locomo-converter.js';
import { type LoCoMoSample, locomoDatasetSchema } from './locomo-types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCOMO_RAW_URL =
  'https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json';

const LOCOMO_FILENAME = 'locomo10.json';

/**
 * Resolve the cache directory relative to the benchmarks package root.
 * Works whether running from source (src/) or built output (dist/).
 */
function resolveCacheDir(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));

  // Walk up from src/datasets/locomo/ (or dist/datasets/locomo/) to benchmarks/
  const benchmarksRoot = join(currentDir, '..', '..', '..');
  return join(benchmarksRoot, 'data', 'locomo');
}

// ---------------------------------------------------------------------------
// Default converter (turn-based, no LLM)
// ---------------------------------------------------------------------------

/**
 * Default converter that wraps the synchronous convertLoCoMoDataset function.
 * Maps each dialogue turn directly to one MemoryInput.
 */
class DefaultTurnConverter implements LoCoMoConverterStrategy {
  async convert(samples: readonly LoCoMoSample[]): Promise<BenchmarkDataset> {
    return convertLoCoMoDataset(samples);
  }
}

// ---------------------------------------------------------------------------
// LoCoMoLoader
// ---------------------------------------------------------------------------

export interface LoCoMoLoaderOptions {
  /** Override the cache directory path. */
  readonly cacheDir?: string;
  /** Override the download URL. */
  readonly url?: string;
  /** Custom converter strategy. Defaults to turn-based (no LLM). */
  readonly converter?: LoCoMoConverterStrategy;
}

export class LoCoMoLoader implements DatasetLoader {
  private readonly cacheDir: string;
  private readonly url: string;
  private readonly converter: LoCoMoConverterStrategy;

  constructor(options?: LoCoMoLoaderOptions) {
    this.cacheDir = options?.cacheDir ?? resolveCacheDir();
    this.url = options?.url ?? LOCOMO_RAW_URL;
    this.converter = options?.converter ?? new DefaultTurnConverter();
  }

  /**
   * Check if cached LoCoMo data exists locally.
   */
  async isAvailable(): Promise<boolean> {
    return existsSync(this.cachedFilePath());
  }

  /**
   * Load the LoCoMo dataset. Downloads from GitHub if not cached.
   *
   * @throws {Error} If download fails and no cached data is available.
   */
  async load(): Promise<BenchmarkDataset> {
    const raw = await this.loadRawData();
    const parsed = this.validate(raw);
    return this.converter.convert(parsed);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private cachedFilePath(): string {
    return join(this.cacheDir, LOCOMO_FILENAME);
  }

  /**
   * Read from cache or download from GitHub.
   */
  private async loadRawData(): Promise<unknown> {
    const cachedPath = this.cachedFilePath();

    if (existsSync(cachedPath)) {
      const content = await readFile(cachedPath, 'utf-8');
      return JSON.parse(content) as unknown;
    }

    return this.downloadAndCache();
  }

  /**
   * Download the dataset from GitHub and write it to the cache directory.
   */
  private async downloadAndCache(): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(this.url);
    } catch (error) {
      throw new Error(
        buildOfflineErrorMessage(this.url, this.cacheDir, error),
      );
    }

    if (!response.ok) {
      throw new Error(
        buildOfflineErrorMessage(
          this.url,
          this.cacheDir,
          new Error(`HTTP ${response.status}: ${response.statusText}`),
        ),
      );
    }

    const text = await response.text();
    const data: unknown = JSON.parse(text);

    // Ensure cache directory exists before writing
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(this.cachedFilePath(), text, 'utf-8');

    return data;
  }

  /**
   * Validate raw JSON against the LoCoMo zod schema.
   */
  private validate(raw: unknown): readonly LoCoMoSample[] {
    const result = locomoDatasetSchema.safeParse(raw);

    if (!result.success) {
      const issues = result.error.issues
        .slice(0, 5)
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n');

      throw new Error(
        `LoCoMo dataset validation failed.\n${issues}\n\n` +
          'The dataset format may have changed. ' +
          'Please re-download or check for schema updates.',
      );
    }

    return result.data;
  }
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function buildOfflineErrorMessage(
  url: string,
  cacheDir: string,
  cause: unknown,
): string {
  const causeMessage =
    cause instanceof Error ? cause.message : String(cause);

  return (
    `Failed to download LoCoMo dataset: ${causeMessage}\n\n` +
    'To use the LoCoMo benchmark offline, manually download the dataset:\n\n' +
    `  mkdir -p "${cacheDir}"\n` +
    `  curl -L "${url}" -o "${cacheDir}/${LOCOMO_FILENAME}"\n\n` +
    'Then re-run the benchmark.'
  );
}
