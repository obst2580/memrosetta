import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRelate } = vi.hoisted(() => {
  const mockRelate = vi.fn();
  return { mockRelate };
});

vi.mock('../../src/engine.js', () => ({
  getEngine: vi.fn().mockImplementation(async () => ({
    relate: mockRelate,
    close: vi.fn(),
  })),
  closeEngine: vi.fn(),
  getDefaultDbPath: vi.fn().mockReturnValue('/tmp/test.db'),
}));

import { run } from '../../src/commands/relate.js';

describe('relate command', () => {
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
    mockRelate.mockReset();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('should create a relation and return the result', async () => {
    const fakeRelation = {
      srcMemoryId: 'mem-1',
      dstMemoryId: 'mem-2',
      relationType: 'updates',
      createdAt: '2026-03-24T00:00:00.000Z',
    };
    mockRelate.mockResolvedValue(fakeRelation);

    await run({
      args: ['--src', 'mem-1', '--dst', 'mem-2', '--type', 'updates'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBeUndefined();
    expect(mockRelate).toHaveBeenCalledWith('mem-1', 'mem-2', 'updates', undefined);
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.srcMemoryId).toBe('mem-1');
    expect(parsed.relationType).toBe('updates');
  });

  it('should pass reason when --reason is provided', async () => {
    mockRelate.mockResolvedValue({
      srcMemoryId: 'mem-1',
      dstMemoryId: 'mem-2',
      relationType: 'extends',
      reason: 'adds detail',
    });

    await run({
      args: [
        '--src', 'mem-1',
        '--dst', 'mem-2',
        '--type', 'extends',
        '--reason', 'adds detail',
      ],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockRelate).toHaveBeenCalledWith('mem-1', 'mem-2', 'extends', 'adds detail');
  });

  it('should fail when --src is missing', async () => {
    await expect(
      run({
        args: ['--dst', 'mem-2', '--type', 'updates'],
        format: 'json',
        noEmbeddings: true,
      }),
    ).rejects.toThrow('Missing required option: source memory ID');
  });

  it('should fail when --dst is missing', async () => {
    await expect(
      run({
        args: ['--src', 'mem-1', '--type', 'updates'],
        format: 'json',
        noEmbeddings: true,
      }),
    ).rejects.toThrow('Missing required option: destination memory ID');
  });

  it('should fail when --type is missing', async () => {
    await expect(
      run({
        args: ['--src', 'mem-1', '--dst', 'mem-2'],
        format: 'json',
        noEmbeddings: true,
      }),
    ).rejects.toThrow('Missing required option: relation type');
  });

  it('should reject invalid relation type', async () => {
    await run({
      args: ['--src', 'mem-1', '--dst', 'mem-2', '--type', 'invalid'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBe(1);
    expect(mockRelate).not.toHaveBeenCalled();
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.error).toContain('Invalid relation type');
  });
});
