import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockCount, mockClear } = vi.hoisted(() => {
  const mockCount = vi.fn();
  const mockClear = vi.fn();
  return { mockCount, mockClear };
});

vi.mock('../../src/engine.js', () => ({
  getEngine: vi.fn().mockImplementation(async () => ({
    count: mockCount,
    clear: mockClear,
    close: vi.fn(),
  })),
  closeEngine: vi.fn(),
  getDefaultDbPath: vi.fn().mockReturnValue('/tmp/test.db'),
}));

vi.mock('../../src/hooks/config.js', () => ({
  getDefaultUserId: vi.fn().mockReturnValue('testuser'),
  getConfig: vi.fn().mockReturnValue({}),
}));

import { run } from '../../src/commands/clear.js';

describe('clear command', () => {
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
    mockClear.mockReset();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('should clear memories when --confirm is provided', async () => {
    mockCount.mockResolvedValue(10);
    mockClear.mockResolvedValue(undefined);

    await run({
      args: ['--user', 'obst', '--confirm'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBeUndefined();
    expect(mockClear).toHaveBeenCalledWith('obst');
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.userId).toBe('obst');
    expect(parsed.cleared).toBe(10);
    expect(parsed.message).toContain('10');
  });

  it('should output error when --confirm is not provided', async () => {
    await run({
      args: ['--user', 'obst'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBe(1);
    expect(mockClear).not.toHaveBeenCalled();
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.error).toContain('--confirm');
  });

  it('should succeed with 0 cleared when user has no memories', async () => {
    mockCount.mockResolvedValue(0);
    mockClear.mockResolvedValue(undefined);

    await run({
      args: ['--user', 'emptyuser', '--confirm'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(process.exitCode).toBeUndefined();
    expect(mockClear).toHaveBeenCalledWith('emptyuser');
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.cleared).toBe(0);
  });
});
