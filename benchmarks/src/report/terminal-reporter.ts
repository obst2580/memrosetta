import type { BenchmarkResult, LatencyMetrics } from './report-types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEPARATOR = '============================================';
const DIVIDER = '--------------------------------------------';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Print a formatted benchmark report to stdout.
 * If a previous result is provided, includes a comparison section.
 */
export function printReport(
  result: BenchmarkResult,
  previous?: BenchmarkResult,
): void {
  const lines: string[] = [];

  lines.push('');
  lines.push(SEPARATOR);
  lines.push('  MemRosetta Benchmark Report');
  lines.push(SEPARATOR);
  lines.push(`  Date:     ${result.timestamp}`);
  lines.push(`  Engine:   memrosetta v${result.engineVersion}`);
  lines.push(`  Dataset:  ${result.dataset}`);
  lines.push(DIVIDER);

  // Retrieval metrics
  lines.push('');
  lines.push('  Retrieval Metrics');
  lines.push('  -----------------');

  for (const [k, v] of Object.entries(result.retrieval.precisionAtK)) {
    lines.push(`  Precision@${k}:    ${formatMetric(v)}`);
  }
  for (const [k, v] of Object.entries(result.retrieval.recallAtK)) {
    lines.push(`  Recall@${k}:       ${formatMetric(v)}`);
  }
  for (const [k, v] of Object.entries(result.retrieval.ndcgAtK)) {
    lines.push(`  nDCG@${k}:        ${formatMetric(v)}`);
  }
  lines.push(`  MRR:            ${formatMetric(result.retrieval.mrr)}`);

  // QA / Category metrics
  if (result.qa) {
    lines.push('');
    lines.push('  By Category');
    lines.push('  -----------');

    for (const [cat, metrics] of Object.entries(result.qa.byCategory)) {
      const padded = padRight(cat + ':', 16);
      lines.push(
        `  ${padded}${formatMetric(metrics.accuracy)}  (${metrics.correct}/${metrics.total})`,
      );
    }
  }

  // Latency metrics
  if (result.latency.length > 0) {
    lines.push('');
    lines.push('  Latency');
    lines.push('  -------');

    for (const lat of result.latency) {
      lines.push(formatLatencyLine(lat));
    }
  }

  // Comparison with previous run
  if (previous) {
    lines.push('');
    lines.push('  vs Previous Run');
    lines.push('  ---------------');

    // Compare precision@K
    for (const [k, v] of Object.entries(result.retrieval.precisionAtK)) {
      const prevValue = previous.retrieval.precisionAtK[Number(k)];
      if (prevValue !== undefined) {
        lines.push(
          `  Precision@${k}:    ${formatMetric(v)}  ${formatDelta(v, prevValue)}`,
        );
      }
    }

    // Compare MRR
    lines.push(
      `  MRR:            ${formatMetric(result.retrieval.mrr)}  ${formatDelta(result.retrieval.mrr, previous.retrieval.mrr)}`,
    );

    // Compare search latency p95
    const currentSearchLat = result.latency.find(
      (l) => l.operation === 'search',
    );
    const prevSearchLat = previous.latency.find(
      (l) => l.operation === 'search',
    );
    if (currentSearchLat && prevSearchLat) {
      lines.push(
        `  Search p95:     ${formatMs(currentSearchLat.p95Ms)}  ${formatDeltaMs(currentSearchLat.p95Ms, prevSearchLat.p95Ms)}`,
      );
    }
  }

  lines.push('');
  lines.push(SEPARATOR);
  lines.push('');

  process.stdout.write(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatMetric(value: number): string {
  return value.toFixed(4);
}

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}

function formatLatencyLine(lat: LatencyMetrics): string {
  const name = padRight(lat.operation + ':', 9);
  return (
    `  ${name}p50=${formatMs(lat.p50Ms)}   ` +
    `p95=${formatMs(lat.p95Ms)}   ` +
    `p99=${formatMs(lat.p99Ms)}   ` +
    `(n=${lat.sampleCount})`
  );
}

function formatDelta(current: number, prev: number): string {
  const delta = current - prev;
  const pct = prev !== 0 ? (delta / prev) * 100 : 0;
  const sign = delta >= 0 ? '+' : '';
  return `(${sign}${delta.toFixed(4)}, ${sign}${pct.toFixed(1)}%)`;
}

function formatDeltaMs(current: number, prev: number): string {
  const delta = current - prev;
  const pct = prev !== 0 ? (delta / prev) * 100 : 0;
  const sign = delta >= 0 ? '+' : '';
  return `(${sign}${delta.toFixed(1)}ms, ${sign}${pct.toFixed(1)}%)`;
}

function padRight(str: string, length: number): string {
  return str.length >= length ? str : str + ' '.repeat(length - str.length);
}
