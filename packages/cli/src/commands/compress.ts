import { getEngine } from '../engine.js';
import { output, type OutputFormat } from '../output.js';
import { optionalOption } from '../parser.js';
import { getDefaultUserId } from '../hooks/config.js';

interface CompressOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

export async function run(options: CompressOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  const userId = optionalOption(args, '--user') ?? getDefaultUserId();

  const engine = await getEngine({ db, noEmbeddings });
  const result = await engine.compress(userId);

  if (format === 'text') {
    process.stdout.write(`Compression completed for user: ${userId}\n`);
    process.stdout.write(`  Groups compressed: ${result.compressed}\n`);
    process.stdout.write(`  Memories archived: ${result.removed}\n`);
    return;
  }

  output({ userId, ...result }, format);
}
