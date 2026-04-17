import type { ReconstructRecallResult } from '@memrosetta/types';

/**
 * Human-readable formatter for `ReconstructRecallResult` (v4 §6).
 *
 * Codex Step 11 review flagged that falling through to generic JSON
 * printing hides the two things operators actually care about:
 *   1. the artifact the kernel produced
 *   2. what evidence backs it and why the kernel chose that evidence
 *
 * This formatter foregrounds both, plus warnings and confidence, and
 * keeps JSON as the explicit opt-in format for machine consumers.
 */

function formatConfidence(confidence: number): string {
  const clamped = Math.max(0, Math.min(1, confidence));
  const filled = Math.round(clamped * 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return `${bar} ${(clamped * 100).toFixed(0)}%`;
}

function indent(text: string, spaces = 2): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? pad + line : line))
    .join('\n');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

export function formatRecallResult(result: ReconstructRecallResult): string {
  const lines: string[] = [];

  // Header block with intent + confidence
  lines.push(`Recall [${result.intent}] — ${result.artifactFormat}`);
  lines.push(`Confidence ${formatConfidence(result.confidence)}`);

  // Warnings surface first if present — an operator debugging
  // unexpected output cares about these before the artifact.
  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of result.warnings) {
      const ref = w.memoryId ? ` [${w.memoryId}]` : '';
      lines.push(`  ! ${w.kind}${ref}: ${w.message}`);
    }
  }

  // Artifact
  lines.push('');
  lines.push('Artifact:');
  const artifact = result.artifact.length > 0 ? result.artifact : '(empty)';
  lines.push(indent(artifact));

  // Evidence table
  if (result.evidence.length > 0) {
    lines.push('');
    lines.push(`Evidence (${result.evidence.length}):`);
    for (let i = 0; i < result.evidence.length; i++) {
      const e = result.evidence[i];
      const system = e.system ?? '—';
      const role = e.role ?? '—';
      const conf = (e.confidence ?? 0).toFixed(2);
      const bind = (e.bindingStrength ?? 1).toFixed(2);
      const body =
        truncate(e.gistContent ?? e.verbatimContent ?? '', 120) || '(no body)';
      const idTag = e.episodeId
        ? `${e.memoryId} @ ${e.episodeId}`
        : e.memoryId;
      lines.push(
        `  ${i + 1}. [${system}/${role}] conf=${conf} bind=${bind}`,
      );
      lines.push(`     ${idTag}`);
      lines.push(`     ${body}`);
    }
  } else {
    lines.push('');
    lines.push('Evidence: (none)');
  }

  // Supporting episodes + completed features (compact)
  if (result.supportingEpisodes.length > 0) {
    lines.push('');
    lines.push(
      `Supporting episodes: ${result.supportingEpisodes.slice(0, 5).join(', ')}` +
        (result.supportingEpisodes.length > 5
          ? ` (+${result.supportingEpisodes.length - 5} more)`
          : ''),
    );
  }

  if (result.completedFeatures.length > 0) {
    lines.push('');
    lines.push('Completed features:');
    const top = result.completedFeatures.slice(0, 8);
    for (const f of top) {
      lines.push(`  • ${f.featureType}=${f.featureValue} (score ${f.score.toFixed(2)})`);
    }
    if (result.completedFeatures.length > top.length) {
      lines.push(`  …and ${result.completedFeatures.length - top.length} more`);
    }
  }

  return lines.join('\n');
}
