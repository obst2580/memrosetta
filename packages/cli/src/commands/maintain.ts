import type { BuildEpisodesOptions } from '@memrosetta/types';
import { getEngine } from '../engine.js';
import { output, outputError, type OutputFormat } from '../output.js';
import { optionalOption, hasFlag } from '../parser.js';
import { getDefaultUserId } from '../hooks/config.js';

interface MaintainOptions {
  readonly args: readonly string[];
  readonly format: OutputFormat;
  readonly db?: string;
  readonly noEmbeddings: boolean;
}

const VALID_GRANULARITIES = ['project-day', 'day', 'source'] as const;

export async function run(options: MaintainOptions): Promise<void> {
  const { args, format, db, noEmbeddings } = options;

  const userId = optionalOption(args, '--user') ?? getDefaultUserId();
  const buildEpisodes = hasFlag(args, '--build-episodes');
  const dryRun = hasFlag(args, '--dry-run');

  const engine = await getEngine({ db, noEmbeddings });

  // Dedicated backfill path. Episode materialization is independent
  // of the normal maintenance cycle (activation / tier / compress),
  // so we gate it behind an explicit flag rather than folding it
  // silently into every `maintain` call.
  if (buildEpisodes) {
    const granularityRaw = optionalOption(args, '--granularity') ?? 'project-day';
    if (!VALID_GRANULARITIES.includes(granularityRaw as (typeof VALID_GRANULARITIES)[number])) {
      outputError(
        `Invalid --granularity: ${granularityRaw}. Must be one of ${VALID_GRANULARITIES.join(', ')}.`,
        format,
      );
      process.exitCode = 1;
      return;
    }

    const buildOpts: BuildEpisodesOptions = {
      granularity: granularityRaw as BuildEpisodesOptions['granularity'],
      dryRun,
    };
    const result = await engine.buildEpisodes(userId, buildOpts);

    if (format === 'text') {
      const header = result.dryRun ? 'DRY RUN' : 'Episode backfill';
      process.stdout.write(`${header} for user: ${userId}\n`);
      process.stdout.write(`  Scanned memories:       ${result.scannedMemories}\n`);
      process.stdout.write(`  Already bound (skipped):${result.alreadyBound}\n`);
      process.stdout.write(`  Missing date (skipped): ${result.skippedMissingDate}\n`);
      process.stdout.write(`  Episodes created:       ${result.episodesCreated}\n`);
      process.stdout.write(`  Memories bound:         ${result.memoriesBound}\n`);
      process.stdout.write(`  Cues indexed:           ${result.cuesIndexed}\n`);
      if (result.dryRun) {
        process.stdout.write(
          '\n(dry run — nothing was written. Re-run without --dry-run to apply.)\n',
        );
      }
      return;
    }

    output({ userId, ...result }, format);
    return;
  }

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
