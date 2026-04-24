import type { MemoryInput, MemoryType, SourceAttestation } from '@memrosetta/types';
import { getEngine, resolveDbPath } from '../engine.js';
import { output, outputError, type OutputFormat } from '../output.js';
import { requireOption, optionalOption, hasFlag } from '../parser.js';
import { getDefaultUserId } from '../hooks/config.js';
import { openCliSyncContext, buildMemoryCreatedOp } from '../sync/cli-sync.js';

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

function parseSources(value: unknown): readonly SourceAttestation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((src): src is Record<string, unknown> => typeof src === 'object' && src !== null)
    .map((src) => ({
      sourceKind: String(src.sourceKind ?? src.source_kind ?? 'cli'),
      sourceRef: String(src.sourceRef ?? src.source_ref ?? 'cli-store'),
      ...(src.sourceSpeaker || src.source_speaker
        ? { sourceSpeaker: String(src.sourceSpeaker ?? src.source_speaker) }
        : {}),
      ...(typeof src.confidence === 'number' ? { confidence: src.confidence } : {}),
    }));
}

function defaultSource(sourceKind: string | undefined, sourceRef: string | undefined): readonly SourceAttestation[] {
  return [{ sourceKind: sourceKind ?? 'cli', sourceRef: sourceRef ?? 'cli-store' }];
}

export async function run(options: StoreOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  let input: MemoryInput;

  if (hasFlag(args, '--stdin')) {
    const raw = await readStdin();
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed.content || !parsed.memoryType) {
        outputError(
          'stdin JSON must have content and memoryType',
          format,
        );
        process.exitCode = 1;
        return;
      }
      input = {
        userId: parsed.userId ? String(parsed.userId) : getDefaultUserId(),
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
        sources:
          parseSources(parsed.sources) ??
          defaultSource(
            parsed.sourceKind || parsed.source_kind
              ? String(parsed.sourceKind ?? parsed.source_kind)
              : undefined,
            parsed.sourceRef || parsed.source_ref || parsed.sourceId
              ? String(parsed.sourceRef ?? parsed.source_ref ?? parsed.sourceId)
              : undefined,
          ),
      };
    } catch {
      outputError('Invalid JSON from stdin', format);
      process.exitCode = 1;
      return;
    }
  } else {
    const userId = optionalOption(args, '--user') ?? getDefaultUserId();
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
    const sourceKind = optionalOption(args, '--source-kind');
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
      sources: defaultSource(sourceKind, sourceId),
      eventDateStart: eventStart,
      eventDateEnd: eventEnd,
    };
  }

  const engine = await getEngine({ db, noEmbeddings });
  const memory = await engine.store(input);

  // Optional sync outbox enqueue. No-op unless sync is configured.
  const sync = await openCliSyncContext(resolveDbPath(db));
  if (sync.enabled) {
    sync.enqueue(buildMemoryCreatedOp(sync, memory));
    sync.close();
  }

  output(memory, format);
}
