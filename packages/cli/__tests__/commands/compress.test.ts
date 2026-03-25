import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockCompress } = vi.hoisted(() => {
  const mockCompress = vi.fn();
  return { mockCompress };
});

vi.mock('../../src/engine.js', () => ({
  getEngine: vi.fn().mockImplementation(async () => ({
    compress: mockCompress,
    close: vi.fn(),
  })),
  closeEngine: vi.fn(),
  getDefaultDbPath: vi.fn().mockReturnValue('/tmp/test.db'),
}));

vi.mock('../../src/hooks/config.js', () => ({
  getDefaultUserId: vi.fn().mockReturnValue('testuser'),
  getConfig: vi.fn().mockReturnValue({}),
}));

import { run } from '../../src/commands/compress.js';

describe('compress command', () => {
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
    mockCompress.mockReset();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('should return compression result with cold memories', async () => {
    mockCompress.mockResolvedValue({ compressed: 5, removed: 3 });

    await run({
      args: ['--user', 'obst'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBeUndefined();
    expect(mockCompress).toHaveBeenCalledWith('obst');
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.userId).toBe('obst');
    expect(parsed.compressed).toBe(5);
    expect(parsed.removed).toBe(3);
  });

  it('should return 0 compressed when no cold memories', async () => {
    mockCompress.mockResolvedValue({ compressed: 0, removed: 0 });

    await run({
      args: ['--user', 'freshuser'],
      format: 'json',
      noEmbeddings: true,
    });

    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.compressed).toBe(0);
    expect(parsed.removed).toBe(0);
  });

  it('should output text format correctly', async () => {
    mockCompress.mockResolvedValue({ compressed: 2, removed: 1 });

    await run({
      args: ['--user', 'obst'],
      format: 'text',
      noEmbeddings: true,
    });

    expect(stdoutSpy).toHaveBeenCalledWith(
      'Compression completed for user: obst\n',
    );
    expect(stdoutSpy).toHaveBeenCalledWith('  Groups compressed: 2\n');
    expect(stdoutSpy).toHaveBeenCalledWith('  Memories archived: 1\n');
  });

  it('should use default userId when --user is omitted', async () => {
    mockCompress.mockResolvedValue({ compressed: 0, removed: 0 });

    await run({
      args: [],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockCompress).toHaveBeenCalledWith('testuser');
  });
});
