import type { MemoryType } from '@memrosetta/types';
import { getEngine } from '../engine.js';
import { output, outputError, type OutputFormat } from '../output.js';
import { requireOption, optionalOption } from '../parser.js';
import { getDefaultUserId } from '../hooks/config.js';

interface SearchOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

export async function run(options: SearchOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  const userId = optionalOption(args, '--user') ?? getDefaultUserId();
  const query = requireOption(args, '--query', 'query');
  const limitRaw = optionalOption(args, '--limit');
  const namespace = optionalOption(args, '--namespace');
  const typesRaw = optionalOption(args, '--types');
  const minConfidenceRaw = optionalOption(args, '--min-confidence');

  const limit = limitRaw ? parseInt(limitRaw, 10) : 5;
  if (isNaN(limit) || limit < 1) {
    outputError('Invalid limit value', format);
    process.exitCode = 1;
    return;
  }

  const memoryTypes = typesRaw
    ? (typesRaw.split(',') as MemoryType[])
    : undefined;

  const minConfidence = minConfidenceRaw
    ? parseFloat(minConfidenceRaw)
    : undefined;

  const engine = await getEngine({ db, noEmbeddings });
  const response = await engine.search({
    userId,
    query,
    namespace,
    limit,
    filters: {
      memoryTypes,
      minConfidence,
    },
  });

  output(response, format);
}
