import type { IMemoryEngine } from '@memrosetta/types';
import type { BenchmarkResult } from '../metrics/metric-types.js';
import type { LoCoMoLoaderOptions } from '../datasets/locomo/locomo-loader.js';
import { runPhase1 } from './phase1-runner.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkConfig {
  readonly phases: readonly string[];
  readonly engineFactory: () => Promise<IMemoryEngine>;
  readonly outputDir: string;
  readonly verbose: boolean;
  readonly loaderOptions?: LoCoMoLoaderOptions;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run one or more benchmark phases with the given engine factory.
 * Returns a result for each phase that was executed.
 */
export async function runBenchmarks(
  config: BenchmarkConfig,
): Promise<readonly BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  const engine = await config.engineFactory();

  for (const phase of config.phases) {
    switch (phase) {
      case 'phase1':
      case '1': {
        const result = await runPhase1({
          engine,
          verbose: config.verbose,
          loaderOptions: config.loaderOptions,
        });
        results.push(result);
        break;
      }
      default:
        process.stdout.write(`Unknown phase: ${phase}. Skipping.\n`);
    }
  }

  return results;
}
