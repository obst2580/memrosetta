#!/usr/bin/env node
/**
 * MemRosetta UserPromptSubmit Hook
 *
 * Searches MemRosetta for memories relevant to the user's prompt
 * and injects them as context that Claude can reference.
 *
 * Graceful degradation: outputs "OK" if anything fails or takes too long.
 */

import { getEngineWithTimeout, closeEngine } from '../engine-manager.js';
import { resolveUserId } from '../memory-extractor.js';
import { getConfig } from '../config.js';
import type { SearchResult } from '@memrosetta/types';

interface HookInput {
  readonly prompt?: string;
  readonly cwd?: string;
}

function stripSystemReminders(text: string): string {
  let result = text;
  while (
    result.includes('<system-reminder>') &&
    result.includes('</system-reminder>')
  ) {
    const start = result.indexOf('<system-reminder>');
    const end =
      result.indexOf('</system-reminder>') + '</system-reminder>'.length;
    result = result.slice(0, start) + result.slice(end);
  }
  return result.trim();
}

function extractQuery(prompt: string, minLength: number): string | null {
  if (!prompt || typeof prompt !== 'string') return null;

  const clean = stripSystemReminders(prompt);

  // Skip very short or command-like prompts
  if (clean.length < minLength) return null;
  if (clean.startsWith('/')) return null;
  if (['y', 'n', 'yes', 'no'].includes(clean.toLowerCase())) return null;

  // Truncate very long prompts for search
  return clean.length > 200 ? clean.slice(0, 200) : clean;
}

function formatMemories(
  results: readonly SearchResult[],
  maxChars: number,
): string | null {
  if (results.length === 0) return null;

  const lines: string[] = [
    '[MemRosetta: relevant memories from previous sessions]',
  ];

  let totalChars = 0;
  for (const r of results) {
    const content = r.memory.content;
    const date = r.memory.documentDate
      ? r.memory.documentDate.split('T')[0]
      : r.memory.learnedAt?.split('T')[0] || '';
    const ns = r.memory.namespace || '';

    const line = `- (${date}${ns ? ', ' + ns : ''}) ${content}`;

    if (totalChars + line.length > maxChars) break;
    lines.push(line);
    totalChars += line.length;
  }

  if (lines.length <= 1) return null;
  return lines.join('\n');
}

async function main(): Promise<void> {
  // Read stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const stdinData = Buffer.concat(chunks).toString('utf-8');

  // Parse hook input
  let hookInput: HookInput = {};
  try {
    hookInput = JSON.parse(stdinData) as HookInput;
  } catch {
    process.stdout.write('OK');
    return;
  }

  const config = getConfig();
  const cwd = hookInput.cwd || process.cwd();

  // Resolve userId from project
  const userId = resolveUserId(cwd);

  // Extract search query from prompt
  const query = extractQuery(hookInput.prompt || '', config.minQueryLength);
  if (!query) {
    process.stdout.write('OK');
    return;
  }

  // Get engine with timeout to avoid blocking Claude Code
  const engine = await getEngineWithTimeout(3000);
  if (!engine) {
    process.stderr.write(
      '[memrosetta] Engine init timeout, skipping recall\n',
    );
    process.stdout.write('OK');
    return;
  }

  try {
    // Search for relevant memories
    const response = await engine.search({
      userId,
      query,
      limit: config.maxRecallResults,
      filters: { onlyLatest: true },
    });

    const context = formatMemories(
      response.results,
      config.maxContextChars,
    );

    if (context) {
      process.stderr.write(
        `[memrosetta] Found ${response.results.length} relevant memories\n`,
      );
      process.stdout.write(context);
    } else {
      process.stdout.write('OK');
    }
  } finally {
    await closeEngine();
  }
}

main().catch(() => {
  process.stdout.write('OK');
});
