import { getEngine, resolveDbPath } from '../engine.js';
import { output, outputError, type OutputFormat } from '../output.js';
import { optionalOption } from '../parser.js';
import { openCliSyncContext, buildMemoryInvalidatedOp } from '../sync/cli-sync.js';

interface InvalidateOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

export async function run(options: InvalidateOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  // First positional argument (non-flag) is the memoryId
  const memoryId = args.find((a) => !a.startsWith('-'));

  if (!memoryId) {
    outputError('Usage: memrosetta invalidate <memoryId>', format);
    process.exitCode = 1;
    return;
  }

  const reason = optionalOption(args, '--reason');
  const engine = await getEngine({ db, noEmbeddings });
  const now = new Date().toISOString();
  await engine.invalidate(memoryId, reason);

  const sync = await openCliSyncContext(resolveDbPath(db));
  if (sync.enabled) {
    sync.enqueue(buildMemoryInvalidatedOp(sync, memoryId, now, reason));
    sync.close();
  }

  output({ memoryId, invalidated: true }, format);
}
