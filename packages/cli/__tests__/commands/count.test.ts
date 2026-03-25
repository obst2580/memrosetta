import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockCount } = vi.hoisted(() => {
  const mockCount = vi.fn();
  return { mockCount };
});

vi.mock('../../src/engine.js', () => ({
  getEngine: vi.fn().mockImplementation(async () => ({
    count: mockCount,
    close: vi.fn(),
  })),
  closeEngine: vi.fn(),
  getDefaultDbPath: vi.fn().mockReturnValue('/tmp/test.db'),
}));

vi.mock('../../src/hooks/config.js', () => ({
  getDefaultUserId: vi.fn().mockReturnValue('testuser'),
  getConfig: vi.fn().mockReturnValue({}),
}));

import { run } from '../../src/commands/count.js';

describe('count command', () => {
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
    mockCount.mockReset();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('should return correct count when memories exist', async () => {
    mockCount.mockResolvedValue(42);

    await run({
      args: ['--user', 'obst'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBeUndefined();
    expect(mockCount).toHaveBeenCalledWith('obst');
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.userId).toBe('obst');
    expect(parsed.count).toBe(42);
  });

  it('should return 0 when no memories exist', async () => {
    mockCount.mockResolvedValue(0);

    await run({
      args: ['--user', 'newuser'],
      format: 'json',
      noEmbeddings: true,
    });

    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.count).toBe(0);
  });

  it('should use default userId when --user is omitted', async () => {
    mockCount.mockResolvedValue(5);

    await run({
      args: [],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockCount).toHaveBeenCalledWith('testuser');
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.userId).toBe('testuser');
    expect(parsed.count).toBe(5);
  });
});
