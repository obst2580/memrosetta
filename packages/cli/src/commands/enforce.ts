/**
 * `memrosetta enforce` — shared backend for client-specific Stop hooks.
 *
 * Pipeline (option 0 + 1 + 5):
 *   1. Wrapper reads its native event payload, normalizes to a JSON file,
 *      and calls `memrosetta enforce stop --event-json <path>`.
 *   2. enforce loads the normalized event, locates the assistant turn,
 *      and asks the LLM extractor to classify it into atomic memories.
 *   3. enforce calls memrosetta_store for each extracted memory.
 *   4. enforce returns a JSON envelope. If nothing was stored AND the
 *      heuristic detects "this turn looked storable", status is
 *      `needs-continuation` so the wrapper can re-invoke the model — but
 *      only up to `MAX_ATTEMPTS` total attempts.
 *
 * The wrapper, not enforce, owns continuation. enforce just reports.
 */

import { existsSync, readFileSync } from 'node:fs';
import { output, outputError, type OutputFormat } from '../output.js';
import { hasFlag, optionalOption, requireOption } from '../parser.js';
import { getEngine, resolveDbPath } from '../engine.js';
import { resolveUserId } from '../hooks/memory-extractor.js';
import { getConfig } from '../hooks/config.js';
import { extractWithLLM, type LlmExtractor } from '../hooks/llm-extractor.js';
import type { MemoryInput, MemoryType } from '@memrosetta/types';

const MAX_ATTEMPTS = 2;

const HEURISTIC_KEYWORDS = [
  // English
  'decided', 'choose', 'chose', 'use ', 'switch to', 'instead of',
  'conclusion', 'agreed', 'fixed', 'fix:', 'released', 'deployed',
  'discovered', 'found', 'turns out',
  // Korean
  '결정', '결론', '합의', '확정', '수정', '해결', '발견', '배포',
  '바꿨', '바꾸자', '변경', '교체',
];

interface EnforceOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

interface NormalizedEvent {
  readonly client: string;
  readonly turnId?: string;
  readonly assistantMessage: string;
  readonly userPrompt?: string;
  readonly cwd?: string;
  readonly transcriptPath?: string;
  readonly attempt?: number;
}

interface EnforceResult {
  readonly status: 'stored' | 'needs-continuation' | 'noop';
  readonly structuredCount: number;
  readonly extractedCount: number;
  readonly memories: ReadonlyArray<{ type: MemoryType; memoryId: string }>;
  readonly footer: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly reason?: string;
}

function loadEvent(path: string): NormalizedEvent {
  if (!existsSync(path)) {
    throw new Error(`event-json file not found: ${path}`);
  }
  const raw = readFileSync(path, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`event-json is not valid JSON: ${path}`);
  }
  const e = parsed as Partial<NormalizedEvent>;
  if (!e.client || typeof e.assistantMessage !== 'string') {
    throw new Error(
      'event-json must include at least { client, assistantMessage }',
    );
  }
  return {
    client: e.client,
    turnId: e.turnId,
    assistantMessage: e.assistantMessage,
    userPrompt: e.userPrompt,
    cwd: e.cwd,
    transcriptPath: e.transcriptPath,
    attempt: e.attempt ?? 1,
  };
}

function looksStorable(text: string): boolean {
  const lower = text.toLowerCase();
  return HEURISTIC_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
}

function buildFooter(
  result: Omit<EnforceResult, 'footer'>,
): string {
  if (result.status === 'noop') {
    return 'STORED: none (noop)';
  }
  if (result.status === 'needs-continuation') {
    return 'STORED: pending (needs-continuation)';
  }
  if (result.memories.length === 0) {
    return 'STORED: failed';
  }
  const items = result.memories
    .map((m) => `${m.type}(${m.memoryId})`)
    .join(', ');
  return `STORED: ${items}`;
}

export async function run(options: EnforceOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  // Subcommand: only "stop" today, but reserved for future events
  // (sessionStart, preToolUse, etc.).
  const sub = args[0];
  if (sub !== 'stop') {
    outputError(
      'Usage: memrosetta enforce stop --client <id> --event-json <path>',
      format,
    );
    process.exitCode = 1;
    return;
  }

  const sliced = args.slice(1);
  let client: string;
  let eventPath: string;
  try {
    client = requireOption(sliced, '--client', 'client identifier');
    eventPath = requireOption(sliced, '--event-json', 'event JSON path');
  } catch (err) {
    outputError(err instanceof Error ? err.message : String(err), format);
    process.exitCode = 1;
    return;
  }

  const explicitAttempt = optionalOption(sliced, '--attempt');
  const dryRun = hasFlag(sliced, '--dry-run');

  let event: NormalizedEvent;
  try {
    event = loadEvent(eventPath);
  } catch (err) {
    outputError(err instanceof Error ? err.message : String(err), format);
    process.exitCode = 1;
    return;
  }

  const attempt = explicitAttempt
    ? Math.max(1, parseInt(explicitAttempt, 10))
    : event.attempt ?? 1;

  // No assistant text → nothing to do.
  if (!event.assistantMessage.trim()) {
    const result: EnforceResult = {
      status: 'noop',
      structuredCount: 0,
      extractedCount: 0,
      memories: [],
      footer: 'STORED: none (noop)',
      attempt,
      maxAttempts: MAX_ATTEMPTS,
      reason: 'empty assistant message',
    };
    output(result, format);
    return;
  }

  // Run the LLM extractor (option 1).
  const extractor: LlmExtractor = await extractWithLLM({
    text: event.assistantMessage,
    userPrompt: event.userPrompt,
    client,
  });

  // Persist extracted memories unless dry-run.
  const stored: { type: MemoryType; memoryId: string }[] = [];
  if (!dryRun && extractor.memories.length > 0) {
    try {
      const engine = await getEngine({ db, noEmbeddings });
      const userId = resolveUserId(event.cwd ?? process.cwd());
      for (const m of extractor.memories) {
        const input: MemoryInput = {
          userId,
          content: m.content,
          memoryType: m.memoryType,
          keywords: m.keywords,
          confidence: m.confidence,
        };
        const memory = await engine.store(input);
        stored.push({ type: memory.memoryType, memoryId: memory.memoryId });
      }
    } catch (err) {
      // Non-fatal: we still report what we tried to store.
      const reason = err instanceof Error ? err.message : String(err);
      const result: EnforceResult = {
        status: 'noop',
        structuredCount: 0,
        extractedCount: extractor.memories.length,
        memories: [],
        footer: 'STORED: failed',
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        reason: `engine.store failed: ${reason}`,
      };
      output(result, format);
      return;
    }
  }

  const extractedCount = stored.length;
  const structuredCount = 0; // reserved for option 0; wrapper-supplied later

  // Decide status.
  let status: 'stored' | 'needs-continuation' | 'noop';
  let reason: string | undefined;

  if (extractedCount > 0) {
    status = 'stored';
  } else if (
    looksStorable(event.assistantMessage) &&
    attempt < MAX_ATTEMPTS &&
    extractor.attempted
  ) {
    status = 'needs-continuation';
    reason =
      'turn looked storable (decision/conclusion keywords present) but extractor returned 0 memories';
  } else {
    status = 'noop';
    reason = extractor.attempted
      ? 'extractor returned 0 memories and turn does not look storable'
      : 'no LLM extractor available (set ANTHROPIC_API_KEY / OPENAI_API_KEY or install propositionizer model)';
  }

  const partial: Omit<EnforceResult, 'footer'> = {
    status,
    structuredCount,
    extractedCount,
    memories: stored,
    attempt,
    maxAttempts: MAX_ATTEMPTS,
    reason,
  };
  const result: EnforceResult = { ...partial, footer: buildFooter(partial) };
  output(result, format);
}
