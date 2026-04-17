import { createEngine, type SqliteMemoryEngine } from '@memrosetta/core';
import type { V1Scenario, ScenarioResult, ScenarioName } from './types.js';
import { goalStateScenario } from './goal-state.js';
import { sourceFidelityScenario } from './source-fidelity.js';
import { reuseFitScenario } from './reuse-fit.js';
import { contextTransferScenario } from './context-transfer.js';

export const V1_SCENARIOS: readonly V1Scenario[] = [
  goalStateScenario,
  sourceFidelityScenario,
  reuseFitScenario,
  contextTransferScenario,
];

export interface V1RunnerOptions {
  readonly dbPath?: string;
  readonly noEmbeddings?: boolean;
  /** Limit to a subset of scenarios by name. */
  readonly only?: readonly ScenarioName[];
}

export interface V1RunnerReport {
  readonly scenarios: readonly ScenarioResult[];
  readonly totals: {
    readonly scenarios: number;
    readonly metricsPassed: number;
    readonly metricsTotal: number;
    readonly passRate: number;
  };
}

/**
 * Runs the v1.0 reconstructive-memory benchmark suite against a fresh
 * SqliteMemoryEngine per scenario. Fresh engine per scenario keeps
 * state leakage out of the measurements — v1.0's whole point is that
 * context matters, so any cross-scenario bleed would corrupt the
 * numbers.
 */
export async function runV1Benchmarks(
  options: V1RunnerOptions = {},
): Promise<V1RunnerReport> {
  const subset = options.only
    ? V1_SCENARIOS.filter((s) => options.only!.includes(s.name))
    : V1_SCENARIOS;

  const results: ScenarioResult[] = [];
  for (const scenario of subset) {
    const engine = createEngine({
      dbPath: options.dbPath ?? ':memory:',
    }) as SqliteMemoryEngine;
    await engine.initialize();

    const startedAt = Date.now();
    const warnings: string[] = [];
    try {
      await scenario.seed(engine);
      const input = scenario.buildInput();
      const recallResult = await engine.reconstructRecall(input);
      const metrics = scenario.evaluate(recallResult);

      for (const w of recallResult.warnings) {
        warnings.push(`${w.kind}: ${w.message}`);
      }

      results.push({
        scenario: scenario.name,
        metrics,
        evidenceCount: recallResult.evidence.length,
        warnings,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        scenario: scenario.name,
        metrics: [
          {
            name: 'scenario_error',
            value: 0,
            ideal: 1,
            passed: false,
          },
        ],
        evidenceCount: 0,
        warnings: [`error: ${message}`],
        durationMs: Date.now() - startedAt,
      });
    } finally {
      await engine.close();
    }
  }

  const metricsTotal = results.reduce((sum, r) => sum + r.metrics.length, 0);
  const metricsPassed = results.reduce(
    (sum, r) => sum + r.metrics.filter((m) => m.passed).length,
    0,
  );

  return {
    scenarios: results,
    totals: {
      scenarios: results.length,
      metricsPassed,
      metricsTotal,
      passRate: metricsTotal === 0 ? 0 : metricsPassed / metricsTotal,
    },
  };
}

export type { V1Scenario, ScenarioResult, ScenarioName, ScenarioMetricEntry } from './types.js';
export { goalStateScenario, sourceFidelityScenario, reuseFitScenario, contextTransferScenario };
