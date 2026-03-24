import { readFileSync } from 'node:fs';
import type { MemoryInput, MemoryType } from '@memrosetta/types';
import { getEngine } from '../engine.js';
import { output, outputError, type OutputFormat } from '../output.js';
import { requireOption, optionalOption } from '../parser.js';

interface IngestOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

interface ContentBlock {
  readonly type?: string;
  readonly text?: string;
}

interface TranscriptEntry {
  readonly cwd?: string;
  readonly sessionId?: string;
  readonly message?: {
    readonly role?: string;
    readonly content?: string | readonly ContentBlock[];
  };
}

interface ConversationTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
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

function extractAssistantText(
  content: string | readonly ContentBlock[],
): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return (content as readonly ContentBlock[])
      .filter(
        (block): block is ContentBlock & { text: string } =>
          block !== null &&
          typeof block === 'object' &&
          block.type === 'text' &&
          typeof block.text === 'string',
      )
      .map((block) => block.text)
      .join('\n')
      .trim();
  }

  return '';
}

function classifyTurn(turn: ConversationTurn): MemoryType {
  const lower = turn.content.toLowerCase();

  if (turn.role === 'user') {
    if (
      lower.includes('decide') ||
      lower.includes('go with') ||
      lower.includes("let's do") ||
      lower.includes('proceed') ||
      lower.includes('approved')
    ) {
      return 'decision';
    }
    if (
      lower.includes('prefer') ||
      lower.includes('i like') ||
      lower.includes('i want') ||
      lower.includes('i need')
    ) {
      return 'preference';
    }
    return 'event';
  }

  return 'fact';
}

function parseTranscriptContent(content: string): {
  readonly turns: readonly ConversationTurn[];
  readonly sessionId: string;
} {
  const lines = content.split('\n').filter((l) => l.trim());

  let sessionId = '';
  const turns: ConversationTurn[] = [];

  for (const line of lines) {
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue;
    }

    if (!sessionId && entry.sessionId) {
      sessionId = entry.sessionId;
    }

    const msg = entry.message;
    if (!msg || !msg.role) continue;

    if (msg.role === 'user' && typeof msg.content === 'string') {
      const clean = stripSystemReminders(msg.content);
      if (clean && clean.length > 5) {
        turns.push({ role: 'user', content: clean });
      }
    } else if (msg.role === 'assistant' && msg.content !== undefined) {
      const text = extractAssistantText(
        msg.content as string | readonly ContentBlock[],
      );
      if (text && text.length > 10) {
        turns.push({ role: 'assistant', content: text });
      }
    }
  }

  return { turns, sessionId };
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

  const userId = requireOption(args, '--user', 'user');
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
