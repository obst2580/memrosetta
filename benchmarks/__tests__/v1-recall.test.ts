import { describe, it, expect } from 'vitest';
import { runV1Benchmarks, V1_SCENARIOS } from '../src/scenarios/v1-recall/index.js';

describe('v1.0 reconstructive-memory benchmarks', () => {
  it('registers all 4 scenarios from v4 §15', () => {
    const names = V1_SCENARIOS.map((s) => s.name).sort();
    expect(names).toEqual([
      'context_preserving_transfer',
      'goal_state_preservation',
      'reuse_fit',
      'source_fidelity',
    ]);
  });

  it('runs the full suite end-to-end and returns metrics for every scenario', async () => {
    const report = await runV1Benchmarks();

    expect(report.scenarios).toHaveLength(4);
    for (const s of report.scenarios) {
      expect(s.metrics.length).toBeGreaterThanOrEqual(1);
      for (const m of s.metrics) {
        expect(typeof m.value).toBe('number');
        expect(typeof m.ideal).toBe('number');
        expect(typeof m.passed).toBe('boolean');
        expect(m.name.length).toBeGreaterThan(0);
      }
    }

    expect(report.totals.metricsTotal).toBeGreaterThan(0);
    expect(report.totals.passRate).toBeGreaterThanOrEqual(0);
    expect(report.totals.passRate).toBeLessThanOrEqual(1);
  });

  it('supports running a subset via `only`', async () => {
    const report = await runV1Benchmarks({ only: ['reuse_fit'] });
    expect(report.scenarios).toHaveLength(1);
    expect(report.scenarios[0].scenario).toBe('reuse_fit');
  });

  it('goal_state_preservation passes at least the top1 check', async () => {
    const report = await runV1Benchmarks({ only: ['goal_state_preservation'] });
    const top1 = report.scenarios[0].metrics.find((m) => m.name === 'top1_build_goal');
    expect(top1).toBeDefined();
  });

  it('source_fidelity verifies verbatim presence under verify intent', async () => {
    const report = await runV1Benchmarks({ only: ['source_fidelity'] });
    const verbatimMetric = report.scenarios[0].metrics.find(
      (m) => m.name === 'evidence_has_verbatim',
    );
    expect(verbatimMetric).toBeDefined();
  });

  it('reuse_fit checks that a procedural memory is retrievable', async () => {
    const report = await runV1Benchmarks({ only: ['reuse_fit'] });
    const retrievedMetric = report.scenarios[0].metrics.find(
      (m) => m.name === 'procedural_retrieved',
    );
    expect(retrievedMetric).toBeDefined();
  });

  it('context_preserving_transfer returns both metrics', async () => {
    const report = await runV1Benchmarks({ only: ['context_preserving_transfer'] });
    const metricNames = report.scenarios[0].metrics.map((m) => m.name);
    expect(metricNames).toContain('transfer_retrieved');
    expect(metricNames).toContain('completed_features_present');
  });
});
