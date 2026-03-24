import type { MemoryInput, MemoryType } from '@memrosetta/types';
import { getEngine } from '../engine.js';
import { output, outputError, type OutputFormat } from '../output.js';
import { requireOption, optionalOption, hasFlag } from '../parser.js';

const VALID_TYPES = new Set(['fact', 'preference', 'decision', 'event']);

interface StoreOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}

export async function run(options: StoreOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  let input: MemoryInput;

  if (hasFlag(args, '--stdin')) {
    const raw = await readStdin();
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed.userId || !parsed.content || !parsed.memoryType) {
        outputError(
          'stdin JSON must have userId, content, and memoryType',
          format,
        );
        process.exitCode = 1;
        return;
      }
      input = {
        userId: String(parsed.userId),
        content: String(parsed.content),
        memoryType: String(parsed.memoryType) as MemoryType,
        namespace: parsed.namespace ? String(parsed.namespace) : undefined,
        keywords: Array.isArray(parsed.keywords)
          ? (parsed.keywords as string[])
          : undefined,
        confidence:
          typeof parsed.confidence === 'number'
            ? parsed.confidence
            : undefined,
        sourceId: parsed.sourceId ? String(parsed.sourceId) : undefined,
      };
    } catch {
      outputError('Invalid JSON from stdin', format);
      process.exitCode = 1;
      return;
    }
  } else {
    const userId = requireOption(args, '--user', 'user');
    const content = requireOption(args, '--content', 'content');
    const memoryType = requireOption(args, '--type', 'type');

    if (!VALID_TYPES.has(memoryType)) {
      outputError(
        `Invalid type: ${memoryType}. Must be one of: fact, preference, decision, event`,
        format,
      );
      process.exitCode = 1;
      return;
    }

    const namespace = optionalOption(args, '--namespace');
    const keywordsRaw = optionalOption(args, '--keywords');
    const confidenceRaw = optionalOption(args, '--confidence');
    const sourceId = optionalOption(args, '--source-id');
    const eventStart = optionalOption(args, '--event-start');
    const eventEnd = optionalOption(args, '--event-end');

    input = {
      userId,
      content,
      memoryType: memoryType as MemoryType,
      namespace,
      keywords: keywordsRaw ? keywordsRaw.split(',') : undefined,
      confidence: confidenceRaw ? parseFloat(confidenceRaw) : undefined,
      sourceId,
      eventDateStart: eventStart,
      eventDateEnd: eventEnd,
    };
  }

  const engine = await getEngine({ db, noEmbeddings });
  const memory = await engine.store(input);
  output(memory, format);
}
