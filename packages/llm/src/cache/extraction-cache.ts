import { createHash } from 'node:crypto';
import { readFile, appendFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtractedFact } from '../extraction/fact-extractor-types.js';

interface CacheEntry {
  readonly key: string;
  readonly facts: readonly ExtractedFact[];
  readonly timestamp: string;
}

export class ExtractionCache {
  private readonly cacheDir: string;
  private readonly promptVersion: string;
  private entries: Map<string, readonly ExtractedFact[]> = new Map();
  private stats = { hits: 0, misses: 0 };
  private loaded = false;

  constructor(cacheDir: string, promptVersion: string) {
    this.cacheDir = cacheDir;
    this.promptVersion = promptVersion.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private get filePath(): string {
    return join(this.cacheDir, `cache-${this.promptVersion}.jsonl`);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    await mkdir(this.cacheDir, { recursive: true });

    if (!existsSync(this.filePath)) {
      this.loaded = true;
      return;
    }

    const content = await readFile(this.filePath, 'utf-8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as CacheEntry;
        this.entries.set(entry.key, entry.facts);
      } catch {
        // Skip malformed lines
      }
    }
    this.loaded = true;
  }

  async get(key: string): Promise<readonly ExtractedFact[] | null> {
    await this.ensureLoaded();
    const result = this.entries.get(key);
    if (result) {
      this.stats.hits++;
      return result;
    }
    this.stats.misses++;
    return null;
  }

  async set(key: string, facts: readonly ExtractedFact[]): Promise<void> {
    await this.ensureLoaded();
    this.entries.set(key, facts);
    const entry: CacheEntry = { key, facts, timestamp: new Date().toISOString() };
    await appendFile(this.filePath, JSON.stringify(entry) + '\n');
  }

  async has(key: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.entries.has(key);
  }

  getStats(): { readonly total: number; readonly hits: number; readonly misses: number } {
    return { total: this.entries.size, hits: this.stats.hits, misses: this.stats.misses };
  }

  async clear(): Promise<void> {
    this.entries.clear();
    this.stats = { hits: 0, misses: 0 };
    if (existsSync(this.filePath)) {
      await writeFile(this.filePath, '');
    }
  }

  static buildKey(model: string, promptVersion: string, turnTexts: readonly string[]): string {
    const input = [model, promptVersion, ...turnTexts].join('\n');
    return createHash('sha256').update(input).digest('hex').slice(0, 16);
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }
}
