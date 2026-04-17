import { describe, it, expect } from 'vitest';
import type { ReconstructRecallResult } from '@memrosetta/types';
import { formatRecallResult } from '../../src/formatters/recall.js';

function baseResult(overrides: Partial<ReconstructRecallResult> = {}): ReconstructRecallResult {
  return {
    artifact: 'synthesized artifact body',
    artifactFormat: 'ranked_list',
    intent: 'browse',
    evidence: [],
    completedFeatures: [],
    supportingEpisodes: [],
    confidence: 0.5,
    warnings: [],
    ...overrides,
  };
}

describe('formatRecallResult', () => {
  it('includes intent, format, and confidence bar', () => {
    const out = formatRecallResult(baseResult({ intent: 'reuse', confidence: 0.8 }));
    expect(out).toContain('Recall [reuse]');
    expect(out).toContain('Confidence');
    // 80% confidence → 8 filled blocks
    expect(out).toMatch(/████████░░/);
    expect(out).toContain('80%');
  });

  it('surfaces warnings above the artifact', () => {
    const out = formatRecallResult(
      baseResult({
        warnings: [
          {
            kind: 'no_episodes_matched',
            message: 'Nothing to match',
          },
        ],
      }),
    );
    const warnIdx = out.indexOf('Warnings:');
    const artIdx = out.indexOf('Artifact:');
    expect(warnIdx).toBeGreaterThan(-1);
    expect(artIdx).toBeGreaterThan(warnIdx);
    expect(out).toContain('no_episodes_matched');
  });

  it('renders evidence entries with system/role/confidence/binding', () => {
    const out = formatRecallResult(
      baseResult({
        evidence: [
          {
            memoryId: 'mem-1',
            episodeId: 'ep-1',
            role: 'pattern',
            system: 'procedural',
            confidence: 0.9,
            bindingStrength: 0.75,
            verbatimContent: 'raw evidence text',
            gistContent: 'compressed gist',
          },
        ],
      }),
    );
    expect(out).toContain('Evidence (1):');
    expect(out).toContain('[procedural/pattern]');
    expect(out).toContain('conf=0.90');
    expect(out).toContain('bind=0.75');
    expect(out).toContain('mem-1 @ ep-1');
    // Gist is preferred over verbatim in the preview line
    expect(out).toContain('compressed gist');
  });

  it('falls back to "(none)" when there is no evidence', () => {
    const out = formatRecallResult(baseResult());
    expect(out).toContain('Evidence: (none)');
  });

  it('shows supporting episodes with overflow indicator', () => {
    const many = Array.from({ length: 8 }, (_, i) => `ep-${i + 1}`);
    const out = formatRecallResult(baseResult({ supportingEpisodes: many }));
    expect(out).toContain('Supporting episodes:');
    expect(out).toContain('(+3 more)');
  });

  it('lists top completed features and caps at 8', () => {
    const features = Array.from({ length: 10 }, (_, i) => ({
      featureType: 'topic',
      featureValue: `topic-${i}`,
      score: 1 - i * 0.05,
    }));
    const out = formatRecallResult(baseResult({ completedFeatures: features }));
    expect(out).toContain('Completed features:');
    expect(out).toContain('topic-0');
    expect(out).toContain('…and 2 more');
  });

  it('renders an empty artifact placeholder', () => {
    const out = formatRecallResult(baseResult({ artifact: '' }));
    expect(out).toContain('(empty)');
  });

  it('handles all 5 intents without throwing', () => {
    for (const intent of ['reuse', 'explain', 'decide', 'browse', 'verify'] as const) {
      const out = formatRecallResult(baseResult({ intent, confidence: 1.0 }));
      expect(out).toContain(`Recall [${intent}]`);
    }
  });
});
