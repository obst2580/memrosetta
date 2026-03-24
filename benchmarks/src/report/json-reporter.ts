import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BenchmarkResult } from './report-types.js';

/**
 * Save a benchmark result as a timestamped JSON file.
 * Returns the path to the saved file.
 */
export async function saveReport(
  result: BenchmarkResult,
  outputDir: string,
): Promise<string> {
  await mkdir(outputDir, { recursive: true });

  const timestamp = result.timestamp.replace(/[:.]/g, '-');
  const filename = `${timestamp}-${result.phase}.json`;
  const filePath = join(outputDir, filename);

  const content = JSON.stringify(result, null, 2);
  await writeFile(filePath, content, 'utf-8');

  return filePath;
}

/**
 * Load a previously saved benchmark result from a JSON file.
 */
export async function loadReport(filePath: string): Promise<BenchmarkResult> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as BenchmarkResult;
}

/**
 * Find the most recent report file for a given phase in the output directory.
 * Returns null if no previous report exists.
 */
export async function findLatestReport(
  outputDir: string,
  phase: string,
): Promise<string | null> {
  if (!existsSync(outputDir)) {
    return null;
  }

  let entries: string[];
  try {
    entries = await readdir(outputDir);
  } catch {
    return null;
  }

  // Filter to JSON files matching the phase, then sort descending
  const matching = entries
    .filter((name) => name.endsWith(`-${phase}.json`))
    .sort()
    .reverse();

  if (matching.length === 0) {
    return null;
  }

  return join(outputDir, matching[0]);
}
