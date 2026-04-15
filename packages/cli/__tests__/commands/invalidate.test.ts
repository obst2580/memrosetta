import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockInvalidate } = vi.hoisted(() => {
  const mockInvalidate = vi.fn();
  return { mockInvalidate };
});

vi.mock('../../src/engine.js', () => ({
  getEngine: vi.fn().mockImplementation(async () => ({
    invalidate: mockInvalidate,
    close: vi.fn(),
  })),
  closeEngine: vi.fn(),
  getDefaultDbPath: vi.fn().mockReturnValue('/tmp/test.db'),
  resolveDbPath: vi.fn().mockReturnValue('/tmp/test.db'),
}));

import { run } from '../../src/commands/invalidate.js';

describe('invalidate command', () => {
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
    mockInvalidate.mockReset();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('should invalidate an existing memory', async () => {
    mockInvalidate.mockResolvedValue(undefined);

    await run({
      args: ['mem-abc-123'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBeUndefined();
    expect(mockInvalidate).toHaveBeenCalledWith('mem-abc-123', undefined);
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.memoryId).toBe('mem-abc-123');
    expect(parsed.invalidated).toBe(true);
  });

  it('should output error when memoryId is missing', async () => {
    await run({
      args: [],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBe(1);
    expect(mockInvalidate).not.toHaveBeenCalled();
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.error).toContain('Usage');
  });

  it('should skip flag-like arguments when finding memoryId', async () => {
    mockInvalidate.mockResolvedValue(undefined);

    await run({
      args: ['--no-embeddings', 'mem-target-456'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockInvalidate).toHaveBeenCalledWith('mem-target-456', undefined);
  });

  it('should fail when only flags are provided (no positional arg)', async () => {
    await run({
      args: ['--no-embeddings'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBe(1);
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});
