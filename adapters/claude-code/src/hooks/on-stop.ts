#!/usr/bin/env node
/**
 * MemRosetta Stop Hook
 *
 * Claude Code Stop hook that saves session memories.
 * Parses the session JSONL transcript, extracts turns, and stores
 * each meaningful message as an atomic memory via the in-process engine.
 *
 * Graceful degradation: if anything fails, does not break the hook chain.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getEngine, closeEngine } from '../engine-manager.js';
import { parseTranscript } from '../transcript-parser.js';
import { extractMemories, resolveUserId } from '../memory-extractor.js';

interface HookInput {
  readonly transcript_path?: string;
  readonly session_id?: string;
  readonly cwd?: string;
}

function findTranscriptPath(hookInput: HookInput): string | null {
  if (hookInput.transcript_path && existsSync(hookInput.transcript_path)) {
    return hookInput.transcript_path;
  }

  const sessionId = hookInput.session_id || '';
  const cwd = hookInput.cwd || '';

  if (sessionId && cwd) {
    const safeCwd = cwd.replace(/^\//, '').replace(/\//g, '-');
    const projectDir = join(homedir(), '.claude', 'projects', safeCwd);
    const candidate = join(projectDir, `${sessionId}.jsonl`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function main(): Promise<void> {
  // Read stdin (hook input)
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const stdinData = Buffer.concat(chunks).toString('utf-8');

  // Pass stdin through (hook chain)
  process.stdout.write(stdinData);

  // Parse hook input
  let hookInput: HookInput = {};
  try {
    hookInput = JSON.parse(stdinData) as HookInput;
  } catch {
    // Not valid JSON input
  }

  const transcriptPath = findTranscriptPath(hookInput);
  if (!transcriptPath) {
    process.stderr.write('[memrosetta] No transcript found, skipping\n');
    return;
  }

  // Parse transcript
  const data = parseTranscript(transcriptPath);
  if (data.turns.length === 0) {
    process.stderr.write('[memrosetta] No turns found in transcript\n');
    return;
  }

  // Resolve userId from cwd
  const cwd = hookInput.cwd || data.cwd || process.cwd();
  const userId = resolveUserId(cwd);

  // Extract memories from turns
  const memories = extractMemories(data, userId);
  if (memories.length === 0) {
    process.stderr.write('[memrosetta] No memories to store\n');
    return;
  }

  // Get engine
  const engine = await getEngine();

  // Clear previous memories from this session to avoid duplicates
  // (session may end multiple times / hook may re-run)
  const sessionShort = data.sessionId ? data.sessionId.slice(0, 8) : null;
  if (sessionShort) {
    await engine.clearNamespace(userId, `session-${sessionShort}`);
  }

  const stored = await engine.storeBatch(memories);
  await closeEngine();

  process.stderr.write(
    `[memrosetta] Stored ${stored.length}/${memories.length} memories for ${userId}\n`,
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[memrosetta] Error: ${message}\n`);
  // Don't exit with error code - don't break the hook chain
});
