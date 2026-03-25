import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockWorkingMemory } = vi.hoisted(() => {
  const mockWorkingMemory = vi.fn();
  return { mockWorkingMemory };
});

vi.mock('../../src/engine.js', () => ({
  getEngine: vi.fn().mockImplementation(async () => ({
    workingMemory: mockWorkingMemory,
    close: vi.fn(),
  })),
  closeEngine: vi.fn(),
  getDefaultDbPath: vi.fn().mockReturnValue('/tmp/test.db'),
}));

vi.mock('../../src/hooks/config.js', () => ({
  getDefaultUserId: vi.fn().mockReturnValue('testuser'),
  getConfig: vi.fn().mockReturnValue({}),
}));

import { run } from '../../src/commands/working-memory.js';

describe('working-memory command', () => {
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
    mockWorkingMemory.mockReset();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('should return memories sorted by priority in JSON format', async () => {
    const fakeMemories = [
      {
        memoryId: 'mem-1',
        content: 'High priority fact',
        memoryType: 'fact',
        tier: 'hot',
        activationScore: 0.95,
      },
      {
        memoryId: 'mem-2',
        content: 'Lower priority preference',
        memoryType: 'preference',
        tier: 'warm',
        activationScore: 0.60,
      },
    ];
    mockWorkingMemory.mockResolvedValue(fakeMemories);

    await run({
      args: ['--user', 'obst'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBeUndefined();
    expect(mockWorkingMemory).toHaveBeenCalledWith('obst', undefined);
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.userId).toBe('obst');
    expect(parsed.memories).toHaveLength(2);
    expect(parsed.memories[0].activationScore).toBe(0.95);
  });

  it('should respect --max-tokens limit', async () => {
    mockWorkingMemory.mockResolvedValue([]);

    await run({
      args: ['--user', 'obst', '--max-tokens', '1500'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockWorkingMemory).toHaveBeenCalledWith('obst', 1500);
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.maxTokens).toBe(1500);
  });

  it('should return empty result for user with no memories', async () => {
    mockWorkingMemory.mockResolvedValue([]);

    await run({
      args: ['--user', 'emptyuser'],
      format: 'json',
      noEmbeddings: true,
    });

    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.memories).toHaveLength(0);
  });

  it('should display text format with tier and score', async () => {
    const fakeMemories = [
      {
        memoryId: 'mem-1',
        content: 'Important fact about TypeScript',
        memoryType: 'fact',
        tier: 'hot',
        activationScore: 0.91,
      },
    ];
    mockWorkingMemory.mockResolvedValue(fakeMemories);

    await run({
      args: ['--user', 'obst'],
      format: 'text',
      noEmbeddings: true,
    });

    expect(stdoutSpy).toHaveBeenCalledWith(
      '[HOT|0.91] Important fact about TypeScript (fact)\n',
    );
  });

  it('should display "No working memory found" in text format when empty', async () => {
    mockWorkingMemory.mockResolvedValue([]);

    await run({
      args: ['--user', 'emptyuser'],
      format: 'text',
      noEmbeddings: true,
    });

    expect(stdoutSpy).toHaveBeenCalledWith('No working memory found.\n');
  });

  it('should throw on invalid --max-tokens value', async () => {
    await expect(
      run({
        args: ['--user', 'obst', '--max-tokens', '-5'],
        format: 'json',
        noEmbeddings: true,
      }),
    ).rejects.toThrow('--max-tokens must be a positive integer');
  });

  it('should throw on non-numeric --max-tokens value', async () => {
    await expect(
      run({
        args: ['--user', 'obst', '--max-tokens', 'abc'],
        format: 'json',
        noEmbeddings: true,
      }),
    ).rejects.toThrow('--max-tokens must be a positive integer');
  });

  it('should use default userId when --user is omitted', async () => {
    mockWorkingMemory.mockResolvedValue([]);

    await run({
      args: [],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockWorkingMemory).toHaveBeenCalledWith('testuser', undefined);
  });
});
