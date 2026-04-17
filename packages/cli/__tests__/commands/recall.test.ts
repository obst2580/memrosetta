import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRecall } = vi.hoisted(() => {
  const mockRecallResult = {
    artifact: '- evidence body',
    artifactFormat: 'ranked_list',
    intent: 'browse' as const,
    evidence: [
      {
        memoryId: 'mem-1',
        episodeId: 'ep-1',
        role: 'fact',
        system: 'semantic' as const,
        confidence: 0.9,
        bindingStrength: 1.0,
        verbatimContent: 'evidence body',
        gistContent: 'evidence body',
      },
    ],
    completedFeatures: [{ featureType: 'topic', featureValue: 'extra', score: 0.5 }],
    supportingEpisodes: ['ep-1'],
    confidence: 0.8,
    warnings: [],
  };

  return {
    mockRecall: vi.fn().mockResolvedValue(mockRecallResult),
  };
});

vi.mock('../../src/engine.js', () => ({
  getEngine: vi.fn().mockImplementation(async () => ({
    reconstructRecall: mockRecall,
    close: vi.fn(),
  })),
}));

import { run } from '../../src/commands/recall.js';

describe('memrosetta recall', () => {
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRecall.mockClear();
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
    process.exitCode = 0;
  });

  it('calls engine.reconstructRecall with parsed args', async () => {
    await run({
      args: [
        '--user',
        'obst',
        '--query',
        'code review prompt',
        '--intent',
        'reuse',
        '--repo',
        'memrosetta',
        '--language',
        'typescript',
      ],
      format: 'json',
      noEmbeddings: false,
    });

    expect(mockRecall).toHaveBeenCalledTimes(1);
    const call = mockRecall.mock.calls[0][0];
    expect(call.userId).toBe('obst');
    expect(call.query).toBe('code review prompt');
    expect(call.intent).toBe('reuse');
    expect(call.context.repo).toBe('memrosetta');
    expect(call.context.language).toBe('typescript');
  });

  it('defaults intent to browse', async () => {
    await run({
      args: ['--user', 'obst', '--query', 'anything'],
      format: 'json',
      noEmbeddings: false,
    });
    expect(mockRecall.mock.calls[0][0].intent).toBe('browse');
  });

  it('rejects invalid intent value', async () => {
    await run({
      args: ['--user', 'obst', '--query', 'x', '--intent', 'nonsense'],
      format: 'json',
      noEmbeddings: false,
    });
    expect(mockRecall).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('rejects invalid --max value', async () => {
    await run({
      args: ['--user', 'obst', '--query', 'x', '--max', 'abc'],
      format: 'json',
      noEmbeddings: false,
    });
    expect(process.exitCode).toBe(1);
  });

  it('splits --cues into topic cues', async () => {
    await run({
      args: ['--user', 'obst', '--query', 'x', '--cues', 'alpha, beta ,gamma'],
      format: 'json',
      noEmbeddings: false,
    });
    const call = mockRecall.mock.calls[0][0];
    expect(call.cues).toEqual([
      { featureType: 'topic', featureValue: 'alpha' },
      { featureType: 'topic', featureValue: 'beta' },
      { featureType: 'topic', featureValue: 'gamma' },
    ]);
  });

  it('omits context when no context flags provided', async () => {
    await run({
      args: ['--user', 'obst', '--query', 'x'],
      format: 'json',
      noEmbeddings: false,
    });
    expect(mockRecall.mock.calls[0][0].context).toBeUndefined();
  });

  it('forwards maxEvidence from --max', async () => {
    await run({
      args: ['--user', 'obst', '--query', 'x', '--max', '12'],
      format: 'json',
      noEmbeddings: false,
    });
    expect(mockRecall.mock.calls[0][0].maxEvidence).toBe(12);
  });
});
