import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockMaintain, mockBuildEpisodes, mockRunConsolidation } = vi.hoisted(() => {
  const mockMaintain = vi.fn();
  const mockBuildEpisodes = vi.fn();
  const mockRunConsolidation = vi.fn();
  return { mockMaintain, mockBuildEpisodes, mockRunConsolidation };
});

vi.mock('../../src/engine.js', () => ({
  getEngine: vi.fn().mockImplementation(async () => ({
    maintain: mockMaintain,
    buildEpisodes: mockBuildEpisodes,
    runConsolidation: mockRunConsolidation,
    close: vi.fn(),
  })),
  closeEngine: vi.fn(),
  getDefaultDbPath: vi.fn().mockReturnValue('/tmp/test.db'),
}));

vi.mock('../../src/hooks/config.js', () => ({
  getDefaultUserId: vi.fn().mockReturnValue('testuser'),
  getConfig: vi.fn().mockReturnValue({}),
}));

import { run } from '../../src/commands/maintain.js';

describe('maintain command', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    process.exitCode = undefined;
    mockMaintain.mockReset();
    mockBuildEpisodes.mockReset();
    mockRunConsolidation.mockReset();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('should run maintenance and return result with counts', async () => {
    const fakeResult = {
      activationUpdated: 15,
      tiersUpdated: 3,
      compressed: 2,
      removed: 1,
    };
    mockMaintain.mockResolvedValue(fakeResult);

    await run({
      args: ['--user', 'obst'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBeUndefined();
    expect(mockMaintain).toHaveBeenCalledWith('obst');
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.userId).toBe('obst');
    expect(parsed.activationUpdated).toBe(15);
    expect(parsed.tiersUpdated).toBe(3);
    expect(parsed.compressed).toBe(2);
    expect(parsed.removed).toBe(1);
  });

  it('should succeed with 0 counts for empty user', async () => {
    const emptyResult = {
      activationUpdated: 0,
      tiersUpdated: 0,
      compressed: 0,
      removed: 0,
    };
    mockMaintain.mockResolvedValue(emptyResult);

    await run({
      args: ['--user', 'emptyuser'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBeUndefined();
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.activationUpdated).toBe(0);
    expect(parsed.tiersUpdated).toBe(0);
    expect(parsed.compressed).toBe(0);
    expect(parsed.removed).toBe(0);
  });

  it('should output text format correctly', async () => {
    mockMaintain.mockResolvedValue({
      activationUpdated: 10,
      tiersUpdated: 2,
      compressed: 1,
      removed: 0,
    });

    await run({
      args: ['--user', 'obst'],
      format: 'text',
      noEmbeddings: true,
    });

    expect(stdoutSpy).toHaveBeenCalledWith(
      'Maintenance completed for user: obst\n',
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      '  Activation scores updated: 10\n',
    );
    expect(stdoutSpy).toHaveBeenCalledWith('  Tiers updated: 2\n');
    expect(stdoutSpy).toHaveBeenCalledWith('  Groups compressed: 1\n');
    expect(stdoutSpy).toHaveBeenCalledWith('  Memories archived: 0\n');
  });

  it('should use default userId when --user is omitted', async () => {
    mockMaintain.mockResolvedValue({
      activationUpdated: 0,
      tiersUpdated: 0,
      compressed: 0,
      removed: 0,
    });

    await run({
      args: [],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockMaintain).toHaveBeenCalledWith('testuser');
  });

  describe('--build-episodes', () => {
    it('calls buildEpisodes and NOT maintain', async () => {
      mockBuildEpisodes.mockResolvedValue({
        scannedMemories: 10,
        alreadyBound: 0,
        skippedMissingDate: 0,
        episodesCreated: 3,
        memoriesBound: 10,
        cuesIndexed: 7,
        dryRun: false,
      });

      await run({
        args: ['--build-episodes', '--user', 'obst'],
        format: 'json',
        noEmbeddings: true,
      });

      expect(mockMaintain).not.toHaveBeenCalled();
      expect(mockBuildEpisodes).toHaveBeenCalledWith('obst', {
        granularity: 'project-day',
        dryRun: false,
      });
    });

    it('passes dryRun flag through', async () => {
      mockBuildEpisodes.mockResolvedValue({
        scannedMemories: 0,
        alreadyBound: 0,
        skippedMissingDate: 0,
        episodesCreated: 0,
        memoriesBound: 0,
        cuesIndexed: 0,
        dryRun: true,
      });

      await run({
        args: ['--build-episodes', '--dry-run', '--user', 'obst'],
        format: 'json',
        noEmbeddings: true,
      });

      expect(mockBuildEpisodes).toHaveBeenCalledWith('obst', {
        granularity: 'project-day',
        dryRun: true,
      });
    });

    it('rejects invalid granularity with exit 1', async () => {
      await run({
        args: ['--build-episodes', '--granularity', 'bogus'],
        format: 'json',
        noEmbeddings: true,
      });

      expect(process.exitCode).toBe(1);
      expect(mockBuildEpisodes).not.toHaveBeenCalled();
    });

    it('accepts --granularity day', async () => {
      mockBuildEpisodes.mockResolvedValue({
        scannedMemories: 0,
        alreadyBound: 0,
        skippedMissingDate: 0,
        episodesCreated: 0,
        memoriesBound: 0,
        cuesIndexed: 0,
        dryRun: false,
      });

      await run({
        args: ['--build-episodes', '--granularity', 'day'],
        format: 'json',
        noEmbeddings: true,
      });

      expect(mockBuildEpisodes).toHaveBeenCalledWith('testuser', {
        granularity: 'day',
        dryRun: false,
      });
    });
  });

  describe('--consolidate', () => {
    it('runs pending consolidation jobs and NOT standard maintenance', async () => {
      mockRunConsolidation.mockResolvedValue({
        processed: 2,
        done: 1,
        failed: 1,
        retried: 0,
        orphanRecent: 3,
        orphanRatio: 0.25,
        jobs: [],
      });

      await run({
        args: ['--consolidate', '--user', 'obst'],
        format: 'json',
        noEmbeddings: true,
      });

      expect(mockMaintain).not.toHaveBeenCalled();
      expect(mockBuildEpisodes).not.toHaveBeenCalled();
      expect(mockRunConsolidation).toHaveBeenCalledWith('obst');
      const written = stdoutSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(written);
      expect(parsed.userId).toBe('obst');
      expect(parsed.processed).toBe(2);
      expect(parsed.done).toBe(1);
      expect(parsed.failed).toBe(1);
      expect(parsed.orphan_recent).toBe(3);
      expect(parsed.orphan_ratio).toBe(0.25);
    });

    it('prints orphan metrics in text output', async () => {
      mockRunConsolidation.mockResolvedValue({
        processed: 0,
        done: 0,
        failed: 0,
        retried: 0,
        orphanRecent: 2,
        orphanRatio: 0.5,
        jobs: [],
      });

      await run({
        args: ['--consolidate', '--user', 'obst'],
        format: 'text',
        noEmbeddings: true,
      });

      expect(stdoutSpy).toHaveBeenCalledWith('  Orphan recent:  2\n');
      expect(stdoutSpy).toHaveBeenCalledWith('  Orphan ratio:   0.500\n');
    });
  });
});
