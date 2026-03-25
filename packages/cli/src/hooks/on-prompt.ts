#!/usr/bin/env node
/**
 * MemRosetta UserPromptSubmit Hook
 *
 * Two responsibilities:
 * 1. Search MemRosetta for memories relevant to the user's prompt (recall)
 * 2. Monitor transcript size and auto-save when approaching context limit (persist)
 *
 * Graceful degradation: outputs "OK" if anything fails or takes too long.
 */

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getEngineWithTimeout, closeEngine } from './engine-manager.js';
import { parseTranscript } from './transcript-parser.js';
import { stripSystemReminders } from './transcript-parser.js';
import { extractMemories, resolveUserId } from './memory-extractor.js';
import { getConfig } from './config.js';
import { isValidTranscriptPath, sanitizeSessionId } from './path-validation.js';
import type { SearchResult } from '@memrosetta/types';

// Default context limit for auto-save threshold estimation.
// Individual model limits not used because hook input doesn't include model info.
const DEFAULT_CONTEXT_LIMIT = 200_000;

// Save when transcript reaches this fraction of estimated context
const SAVE_THRESHOLD = 0.6;

// Rough bytes-to-tokens ratio for JSONL transcripts
const BYTES_PER_TOKEN = 4;

interface HookInput {
  readonly prompt?: string;
  readonly cwd?: string;
  readonly session_id?: string;
  readonly transcript_path?: string;
}

function extractQuery(prompt: string, minLength: number): string | null {
  if (!prompt || typeof prompt !== 'string') return null;

  const clean = stripSystemReminders(prompt);

  if (clean.length < minLength) return null;
  if (clean.startsWith('/')) return null;
  if (['y', 'n', 'yes', 'no'].includes(clean.toLowerCase())) return null;

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

/**
 * Check if the transcript has grown large enough to trigger a save.
 */
function shouldAutoSave(hookInput: HookInput): {
  save: boolean;
  transcriptPath: string | null;
} {
  const transcriptPath = findTranscriptPath(hookInput);
  if (!transcriptPath) return { save: false, transcriptPath: null };

  try {
    const stats = statSync(transcriptPath);
    const estimatedTokens = stats.size / BYTES_PER_TOKEN;
    const contextLimit = DEFAULT_CONTEXT_LIMIT;
    const threshold = contextLimit * SAVE_THRESHOLD;

    return {
      save: estimatedTokens >= threshold,
      transcriptPath,
    };
  } catch {
    return { save: false, transcriptPath: null };
  }
}

function findTranscriptPath(hookInput: HookInput): string | null {
  if (hookInput.transcript_path) {
    if (isValidTranscriptPath(hookInput.transcript_path) && existsSync(hookInput.transcript_path)) {
      return hookInput.transcript_path;
    }
    return null;
  }

  const rawSessionId = hookInput.session_id || '';
  const sessionId = sanitizeSessionId(rawSessionId);
  const cwd = hookInput.cwd || '';

  if (sessionId && cwd) {
    const safeCwd = cwd.replace(/^\//, '').replace(/\//g, '-');
    const projectDir = join(homedir(), '.claude', 'projects', safeCwd);
    const candidate = join(projectDir, `${sessionId}.jsonl`);
    if (isValidTranscriptPath(candidate) && existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Auto-save current session memories when context is getting large.
 */
async function autoSave(
  transcriptPath: string,
  hookInput: HookInput,
): Promise<void> {
  const engine = await getEngineWithTimeout(5000);
  if (!engine) return;

  try {
    const data = parseTranscript(transcriptPath);
    if (data.turns.length === 0) return;

    const cwd = hookInput.cwd || data.cwd || process.cwd();
    const userId = resolveUserId(cwd);
    const memories = extractMemories(data, userId);
    if (memories.length === 0) return;

    const sessionShort = data.sessionId
      ? data.sessionId.slice(0, 8)
      : null;
    if (sessionShort) {
      await engine.clearNamespace(userId, `session-${sessionShort}`);
    }

    const stored = await engine.storeBatch(memories);
    process.stderr.write(
      `[memrosetta] Auto-saved ${stored.length} memories (context approaching limit)\n`,
    );
  } catch {
    // Auto-save failure is non-fatal
  }
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
  const userId = resolveUserId(cwd);

  // Check if we should auto-save (context approaching limit)
  const { save, transcriptPath } = shouldAutoSave(hookInput);
  if (save && transcriptPath) {
    await autoSave(transcriptPath, hookInput);
  }

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

    const context = formatMemories(response.results, config.maxContextChars);

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
