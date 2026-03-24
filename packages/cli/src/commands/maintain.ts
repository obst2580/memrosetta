import { getEngine } from '../engine.js';
import { output, type OutputFormat } from '../output.js';
import { requireOption } from '../parser.js';

interface MaintainOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

export async function run(options: MaintainOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  const userId = requireOption(args, '--user', 'user');

  const engine = await getEngine({ db, noEmbeddings });
  const result = await engine.maintain(userId);

  if (format === 'text') {
    process.stdout.write(`Maintenance completed for user: ${userId}\n`);
    process.stdout.write(`  Activation scores updated: ${result.activationUpdated}\n`);
    process.stdout.write(`  Tiers updated: ${result.tiersUpdated}\n`);
    process.stdout.write(`  Groups compressed: ${result.compressed}\n`);
    process.stdout.write(`  Memories archived: ${result.removed}\n`);
    return;
  }

  output({ userId, ...result }, format);
}
