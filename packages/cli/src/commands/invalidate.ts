import { getEngine } from '../engine.js';
import { output, outputError, type OutputFormat } from '../output.js';

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

  const engine = await getEngine({ db, noEmbeddings });
  await engine.invalidate(memoryId);
  output({ memoryId, invalidated: true }, format);
}
