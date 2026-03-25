import { readFileSync } from 'node:fs';
import type { MemoryInput, MemoryType } from '@memrosetta/types';
import { getEngine } from '../engine.js';
import { output, outputError, type OutputFormat } from '../output.js';
import { optionalOption } from '../parser.js';
import { getDefaultUserId } from '../hooks/config.js';
import { parseTranscriptContent } from '../hooks/transcript-parser.js';
import { classifyTurn } from '../hooks/memory-extractor.js';
import type { ConversationTurn } from '../hooks/transcript-parser.js';

interface IngestOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

function turnsToMemories(
  turns: readonly ConversationTurn[],
  userId: string,
  namespace: string | undefined,
  sessionShort: string,
): readonly MemoryInput[] {
  const now = new Date().toISOString();
  const memories: MemoryInput[] = [];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];

    if (turn.content.length < 20) continue;

    const content =
      turn.content.length > 500
        ? turn.content.slice(0, 497) + '...'
        : turn.content;

    memories.push({
      userId,
      namespace: namespace ?? `session-${sessionShort}`,
      memoryType: classifyTurn(turn),
      content,
      documentDate: now,
      sourceId: `cc-${sessionShort}-${i}`,
      confidence: turn.role === 'user' ? 0.9 : 0.8,
    });
  }

  return memories;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}

export async function run(options: IngestOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  const userId = optionalOption(args, '--user') ?? getDefaultUserId();
  const file = optionalOption(args, '--file');
  const namespace = optionalOption(args, '--namespace');

  let content: string;
  if (file) {
    try {
      content = readFileSync(file, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outputError(`Failed to read file: ${msg}`, format);
      process.exitCode = 1;
      return;
    }
  } else {
    content = await readStdin();
  }

  if (!content) {
    outputError('No transcript content provided', format);
    process.exitCode = 1;
    return;
  }

  const parsed = parseTranscriptContent(content);
  const sessionShort = parsed.sessionId
    ? parsed.sessionId.slice(0, 8)
    : 'unknown';

  const memories = turnsToMemories(
    parsed.turns,
    userId,
    namespace,
    sessionShort,
  );

  if (memories.length === 0) {
    output({ stored: 0, message: 'No memories extracted from transcript' }, format);
    return;
  }

  const engine = await getEngine({ db, noEmbeddings });
  const stored = await engine.storeBatch(memories);

  output(
    {
      stored: stored.length,
      sessionId: parsed.sessionId || undefined,
      namespace: namespace ?? `session-${sessionShort}`,
    },
    format,
  );
}
