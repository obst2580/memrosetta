import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSearch } = vi.hoisted(() => {
  const mockSearchResponse = {
    results: [
      {
        memory: {
          memoryId: 'mem-1',
          userId: 'obst',
          content: 'favorite food is pizza',
          memoryType: 'preference',
          learnedAt: '2026-03-24T00:00:00.000Z',
          isLatest: true,
        },
        score: 0.85,
        matchType: 'fts' as const,
      },
      {
        memory: {
          memoryId: 'mem-2',
          userId: 'obst',
          content: 'TypeScript project started',
          memoryType: 'fact',
          learnedAt: '2026-03-24T00:00:00.000Z',
          isLatest: true,
        },
        score: 0.72,
        matchType: 'fts' as const,
      },
    ],
    totalCount: 2,
    queryTimeMs: 4.2,
  };

  const mockSearch = vi.fn().mockResolvedValue(mockSearchResponse);
  return { mockSearch };
});

vi.mock('../../src/engine.js', () => ({
  getEngine: vi.fn().mockImplementation(async () => ({
    search: mockSearch,
    close: vi.fn(),
  })),
  closeEngine: vi.fn(),
  getDefaultDbPath: vi.fn().mockReturnValue('/tmp/test.db'),
}));

import { run } from '../../src/commands/search.js';

describe('search command', () => {
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
    mockSearch.mockClear();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('should search and return JSON results', async () => {
    await run({
      args: ['--user', 'obst', '--query', 'food preference'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBeUndefined();
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].score).toBe(0.85);
    expect(parsed.totalCount).toBe(2);
  });

  it('should search and return text format', async () => {
    await run({
      args: ['--user', 'obst', '--query', 'food preference'],
      format: 'text',
      noEmbeddings: true,
    });

    expect(stdoutSpy).toHaveBeenCalledWith(
      '[0.85] favorite food is pizza (preference, 2026-03-24)\n',
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      '[0.72] TypeScript project started (fact, 2026-03-24)\n',
    );
  });

  it('should pass limit option to engine', async () => {
    await run({
      args: ['--user', 'obst', '--query', 'test', '--limit', '3'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'obst',
        query: 'test',
        limit: 3,
      }),
    );
  });

  it('should reject invalid limit', async () => {
    await run({
      args: ['--user', 'obst', '--query', 'test', '--limit', 'abc'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBe(1);
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.error).toContain('Invalid limit');
  });

  it('should fail when required args are missing', async () => {
    await expect(
      run({
        args: ['--user', 'obst'],
        format: 'json',
        noEmbeddings: true,
      }),
    ).rejects.toThrow('Missing required option: query');
  });

  it('should pass namespace and types filter', async () => {
    await run({
      args: [
        '--user',
        'obst',
        '--query',
        'test',
        '--namespace',
        'work',
        '--types',
        'fact,preference',
      ],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'work',
        filters: expect.objectContaining({
          memoryTypes: ['fact', 'preference'],
        }),
      }),
    );
  });

  it('should pass includeSource when requested', async () => {
    await run({
      args: ['--user', 'obst', '--query', 'test', '--include-source'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        includeSource: true,
      }),
    );
  });
});
