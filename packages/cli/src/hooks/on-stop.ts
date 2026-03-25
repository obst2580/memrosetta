#!/usr/bin/env node
/**
 * MemRosetta Stop Hook
 *
 * Claude Code Stop hook that saves session memories.
 * Uses LLM-based fact extraction if configured, otherwise falls back
 * to rule-based extraction.
 *
 * Graceful degradation: if anything fails, does not break the hook chain.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { MemoryInput } from '@memrosetta/types';
import { getEngine, closeEngine } from './engine-manager.js';
import { parseTranscript } from './transcript-parser.js';
import { extractMemories, resolveUserId } from './memory-extractor.js';
import { getConfig } from './config.js';
import { isValidTranscriptPath, sanitizeSessionId } from './path-validation.js';

interface HookInput {
  readonly transcript_path?: string;
  readonly session_id?: string;
  readonly cwd?: string;
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
 * Try LLM-based fact extraction. Returns null if LLM is not configured
 * or extraction fails (caller should fall back to rule-based).
 */
async function tryLLMExtraction(
  turns: readonly { readonly role: string; readonly content: string }[],
  userId: string,
  sessionShort: string,
): Promise<readonly MemoryInput[] | null> {
  const config = getConfig();

  const provider =
    config.llmProvider ||
    (process.env.OPENAI_API_KEY ? 'openai' : null) ||
    (process.env.ANTHROPIC_API_KEY ? 'anthropic' : null);

  if (!provider) return null;

  const apiKey =
    config.llmApiKey ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return null;

  try {
    const { FactExtractor, OpenAIProvider, AnthropicProvider } = await import(
      '@memrosetta/llm'
    );

    const llm =
      provider === 'openai'
        ? new OpenAIProvider({
            apiKey,
            model: config.llmModel || 'gpt-4o-mini',
          })
        : new AnthropicProvider({
            apiKey,
            model: config.llmModel || 'claude-haiku-4-5-20251001',
          });

    const extractor = new FactExtractor(llm);

    const llmTurns = turns.map((t) => ({
      speaker: t.role === 'user' ? 'User' : 'Assistant',
      text: t.content,
    }));

    const facts = await extractor.extractFromTurns(llmTurns, {
      dateTime: new Date().toISOString(),
    });

    if (facts.length === 0) return null;

    const now = new Date().toISOString();
    return extractor.toMemoryInputs(facts, {
      userId,
      namespace: `session-${sessionShort}`,
      documentDate: now,
      sourceId: `cc-${sessionShort}-llm`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[memrosetta] LLM extraction failed, falling back to rules: ${msg}\n`,
    );
    return null;
  }
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
  const sessionShort = data.sessionId
    ? data.sessionId.slice(0, 8)
    : 'unknown';

  // Try LLM extraction first, fall back to rule-based
  let memories = await tryLLMExtraction(data.turns, userId, sessionShort);
  const method = memories ? 'llm' : 'rules';

  if (!memories) {
    memories = extractMemories(data, userId);
  }

  if (memories.length === 0) {
    process.stderr.write('[memrosetta] No memories to store\n');
    return;
  }

  // Get engine
  const engine = await getEngine();

  // Clear previous memories from this session to avoid duplicates
  if (sessionShort !== 'unknown') {
    await engine.clearNamespace(userId, `session-${sessionShort}`);
  }

  const stored = await engine.storeBatch(memories);
  await closeEngine();

  process.stderr.write(
    `[memrosetta] Stored ${stored.length} memories for ${userId} (${method})\n`,
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[memrosetta] Error: ${message}\n`);
  // Don't exit with error code - don't break the hook chain
});
