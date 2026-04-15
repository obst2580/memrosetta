import { getEngine, resolveDbPath } from '../engine.js';
import { output, outputError, type OutputFormat } from '../output.js';
import { hasFlag } from '../parser.js';
import { openCliSyncContext, buildFeedbackGivenOp } from '../sync/cli-sync.js';

interface FeedbackOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

export async function run(options: FeedbackOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  // First positional argument (non-flag) is the memoryId
  const memoryId = args.find((a) => !a.startsWith('-'));

  if (!memoryId) {
    outputError('Usage: memrosetta feedback <memoryId> --helpful | --not-helpful', format);
    process.exitCode = 1;
    return;
  }

  const helpful = hasFlag(args, '--helpful');
  const notHelpful = hasFlag(args, '--not-helpful');

  if (!helpful && !notHelpful) {
    outputError('Specify --helpful or --not-helpful', format);
    process.exitCode = 1;
    return;
  }

  if (helpful && notHelpful) {
    outputError('Specify either --helpful or --not-helpful, not both', format);
    process.exitCode = 1;
    return;
  }

  const engine = await getEngine({ db, noEmbeddings });
  const now = new Date().toISOString();
  await engine.feedback(memoryId, helpful);

  const sync = await openCliSyncContext(resolveDbPath(db));
  if (sync.enabled) {
    sync.enqueue(buildFeedbackGivenOp(sync, memoryId, helpful, now));
    sync.close();
  }

  output({ memoryId, helpful }, format);
}
