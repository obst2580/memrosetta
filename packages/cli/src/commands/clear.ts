import { getEngine } from '../engine.js';
import { output, outputError, type OutputFormat } from '../output.js';
import { optionalOption, hasFlag } from '../parser.js';
import { getDefaultUserId } from '../hooks/config.js';

interface ClearOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

export async function run(options: ClearOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  const userId = optionalOption(args, '--user') ?? getDefaultUserId();
  const confirm = hasFlag(args, '--confirm');

  if (!confirm) {
    outputError(
      'This will delete all memories for the user. Use --confirm to proceed.',
      format,
    );
    process.exitCode = 1;
    return;
  }

  const engine = await getEngine({ db, noEmbeddings });
  const countBefore = await engine.count(userId);
  await engine.clear(userId);

  output(
    { userId, cleared: countBefore, message: `Cleared ${countBefore} memories` },
    format,
  );
}
