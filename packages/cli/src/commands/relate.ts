import type { RelationType } from '@memrosetta/types';
import { getEngine } from '../engine.js';
import { output, outputError, type OutputFormat } from '../output.js';
import { requireOption, optionalOption } from '../parser.js';

const VALID_RELATION_TYPES = new Set([
  'updates',
  'extends',
  'derives',
  'contradicts',
  'supports',
]);

interface RelateOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

export async function run(options: RelateOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  const src = requireOption(args, '--src', 'source memory ID');
  const dst = requireOption(args, '--dst', 'destination memory ID');
  const relationType = requireOption(args, '--type', 'relation type');
  const reason = optionalOption(args, '--reason');

  if (!VALID_RELATION_TYPES.has(relationType)) {
    outputError(
      `Invalid relation type: ${relationType}. Must be one of: updates, extends, derives, contradicts, supports`,
      format,
    );
    process.exitCode = 1;
    return;
  }

  const engine = await getEngine({ db, noEmbeddings });
  const relation = await engine.relate(
    src,
    dst,
    relationType as RelationType,
    reason,
  );

  output(relation, format);
}
