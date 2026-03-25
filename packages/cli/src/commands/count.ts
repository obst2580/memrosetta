import { getEngine } from '../engine.js';
import { output, type OutputFormat } from '../output.js';
import { optionalOption } from '../parser.js';
import { getDefaultUserId } from '../hooks/config.js';

interface CountOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

export async function run(options: CountOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  const userId = optionalOption(args, '--user') ?? getDefaultUserId();

  const engine = await getEngine({ db, noEmbeddings });
  const count = await engine.count(userId);

  output({ userId, count }, format);
}
