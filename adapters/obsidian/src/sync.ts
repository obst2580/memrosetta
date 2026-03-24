import type { IMemoryEngine } from '@memrosetta/types';
import {
  memoryToMarkdown,
  markdownToMemoryId,
  extractBody,
  extractMemoryType,
  extractKeywords,
} from './formatter.js';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SyncOptions {
  /** Obsidian vault root directory. */
  readonly vaultPath: string;
  /** Folder name inside vault for MemRosetta files (default: 'MemRosetta'). */
  readonly folderName: string;
  /** User identifier for filtering memories. */
  readonly userId: string;
}

export interface SyncResult {
  readonly exported: number;
  readonly skipped: number;
}

export interface ImportResult {
  readonly imported: number;
  readonly skipped: number;
}

/**
 * Export memories from MemRosetta to Obsidian vault as markdown files.
 * Non-destructive: only creates/updates files, never deletes vault content.
 */
export async function exportToVault(
  engine: IMemoryEngine,
  options: SyncOptions,
): Promise<SyncResult> {
  const folder = join(options.vaultPath, options.folderName);
  mkdirSync(folder, { recursive: true });

  // Collect existing memory IDs already in the vault
  const existingIds = collectExistingMemoryIds(folder);

  // Get working memory with a very high token limit to retrieve as many memories as possible.
  // workingMemory returns memories ordered by tier/activation, which is the best we can do
  // through the IMemoryEngine interface without direct DB access.
  const memories = await engine.workingMemory(options.userId, 1_000_000);

  let exported = 0;
  let skipped = 0;

  for (const memory of memories) {
    const filename = `${memory.memoryId}.md`;
    const filepath = join(folder, filename);

    // Non-destructive: skip if file already exists
    if (existingIds.has(memory.memoryId)) {
      skipped++;
      continue;
    }

    const markdown = memoryToMarkdown(memory);
    writeFileSync(filepath, markdown, 'utf-8');
    exported++;
  }

  return { exported, skipped };
}

/**
 * Import memories from Obsidian vault markdown files into MemRosetta.
 * Only imports files that have valid memory_id frontmatter and are not yet in the DB.
 * Files without memory_id (user's own notes) are skipped.
 */
export async function importFromVault(
  engine: IMemoryEngine,
  options: SyncOptions,
): Promise<ImportResult> {
  const folder = join(options.vaultPath, options.folderName);

  if (!existsSync(folder)) {
    return { imported: 0, skipped: 0 };
  }

  let imported = 0;
  let skipped = 0;

  const files = readdirSync(folder).filter((f) => f.endsWith('.md'));

  for (const file of files) {
    try {
      const content = readFileSync(join(folder, file), 'utf-8');
      const memoryId = markdownToMemoryId(content);

      // Skip files without memory_id (user's own notes in the same folder)
      if (!memoryId) {
        skipped++;
        continue;
      }

      // Skip if already in DB
      const existing = await engine.getById(memoryId);
      if (existing) {
        skipped++;
        continue;
      }

      // Extract body content from markdown
      const body = extractBody(content);
      if (!body) {
        skipped++;
        continue;
      }

      // Extract metadata from frontmatter
      const memoryType = extractMemoryType(content);
      const keywords = extractKeywords(content);

      await engine.store({
        userId: options.userId,
        content: body,
        memoryType,
        keywords: keywords.length > 0 ? keywords : undefined,
      });
      imported++;
    } catch {
      // Unreadable or malformed files are silently skipped
      skipped++;
    }
  }

  return { imported, skipped };
}

/**
 * Scan a folder for existing .md files and extract their memory_id values.
 */
function collectExistingMemoryIds(folder: string): ReadonlySet<string> {
  const ids = new Set<string>();

  if (!existsSync(folder)) return ids;

  for (const file of readdirSync(folder)) {
    if (!file.endsWith('.md')) continue;
    try {
      const content = readFileSync(join(folder, file), 'utf-8');
      const id = markdownToMemoryId(content);
      if (id) ids.add(id);
    } catch {
      // Ignore unreadable files
    }
  }

  return ids;
}
