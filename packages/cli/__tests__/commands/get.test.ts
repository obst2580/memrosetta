import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetById } = vi.hoisted(() => {
  const mockGetById = vi.fn();
  return { mockGetById };
});

vi.mock('../../src/engine.js', () => ({
  getEngine: vi.fn().mockImplementation(async () => ({
    getById: mockGetById,
    close: vi.fn(),
  })),
  closeEngine: vi.fn(),
  getDefaultDbPath: vi.fn().mockReturnValue('/tmp/test.db'),
}));

import { run } from '../../src/commands/get.js';

describe('get command', () => {
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
    mockGetById.mockReset();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('should return a memory when it exists', async () => {
    const fakeMemory = {
      memoryId: 'mem-abc-123',
      userId: 'testuser',
      content: 'TypeScript is great',
      memoryType: 'fact',
      learnedAt: '2026-03-24T00:00:00.000Z',
      isLatest: true,
    };
    mockGetById.mockResolvedValue(fakeMemory);

    await run({
      args: ['mem-abc-123'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBeUndefined();
    expect(mockGetById).toHaveBeenCalledWith('mem-abc-123');
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.memoryId).toBe('mem-abc-123');
    expect(parsed.content).toBe('TypeScript is great');
  });

  it('should output error when memory is not found', async () => {
    mockGetById.mockResolvedValue(null);

    await run({
      args: ['mem-nonexistent'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBe(1);
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.error).toContain('Memory not found');
    expect(parsed.error).toContain('mem-nonexistent');
  });

  it('should output error when memoryId argument is missing', async () => {
    await run({
      args: [],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBe(1);
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.error).toContain('Missing memory ID');
  });

  it('should skip flag-like arguments when finding memoryId', async () => {
    mockGetById.mockResolvedValue(null);

    await run({
      args: ['--no-embeddings', 'mem-target'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockGetById).toHaveBeenCalledWith('mem-target');
  });
});
