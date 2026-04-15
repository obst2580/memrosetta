import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockStore } = vi.hoisted(() => {
  const mockStore = vi.fn().mockResolvedValue({
    memoryId: 'mem-test-123',
    userId: 'obst',
    content: 'test content',
    memoryType: 'fact',
    learnedAt: '2026-03-24T00:00:00.000Z',
    isLatest: true,
  });
  return { mockStore };
});

vi.mock('../../src/engine.js', () => ({
  getEngine: vi.fn().mockImplementation(async () => ({
    store: mockStore,
    close: vi.fn(),
  })),
  closeEngine: vi.fn(),
  getDefaultDbPath: vi.fn().mockReturnValue('/tmp/test.db'),
  resolveDbPath: vi.fn().mockReturnValue('/tmp/test.db'),
}));

import { run } from '../../src/commands/store.js';

describe('store command', () => {
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
    mockStore.mockClear();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('should store a memory from CLI args', async () => {
    await run({
      args: [
        '--user',
        'obst',
        '--content',
        'test content',
        '--type',
        'fact',
      ],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBeUndefined();
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.memoryId).toBe('mem-test-123');
    expect(parsed.userId).toBe('obst');
    expect(parsed.content).toBe('test content');
  });

  it('should reject invalid memory type', async () => {
    await run({
      args: [
        '--user',
        'obst',
        '--content',
        'test',
        '--type',
        'invalid',
      ],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBe(1);
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.error).toContain('Invalid type');
  });

  it('should fail when required args are missing', async () => {
    await expect(
      run({
        args: ['--user', 'obst'],
        format: 'json',
        noEmbeddings: true,
      }),
    ).rejects.toThrow('Missing required option: content');
  });

  it('should store with optional keywords and namespace', async () => {
    await run({
      args: [
        '--user',
        'obst',
        '--content',
        'TypeScript project',
        '--type',
        'fact',
        '--keywords',
        'ts,project',
        '--namespace',
        'work',
      ],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockStore).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'obst',
        content: 'TypeScript project',
        memoryType: 'fact',
        keywords: ['ts', 'project'],
        namespace: 'work',
      }),
    );
  });
});
