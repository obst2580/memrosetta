import { getEngine } from '../engine.js';
import { output, outputError, type OutputFormat } from '../output.js';

interface GetOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

export async function run(options: GetOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  const memoryId = args.find((a) => !a.startsWith('-') && a !== 'get');
  if (!memoryId) {
    outputError('Missing memory ID. Usage: memrosetta get <memory-id>', format);
    process.exitCode = 1;
    return;
  }

  const engine = await getEngine({ db, noEmbeddings });
  const memory = await engine.getById(memoryId);

  if (!memory) {
    outputError(`Memory not found: ${memoryId}`, format);
    process.exitCode = 1;
    return;
  }

  output(memory, format);
}
