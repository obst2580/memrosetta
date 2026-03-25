import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockMaintain } = vi.hoisted(() => {
  const mockMaintain = vi.fn();
  return { mockMaintain };
});

vi.mock('../../src/engine.js', () => ({
  getEngine: vi.fn().mockImplementation(async () => ({
    maintain: mockMaintain,
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
});
