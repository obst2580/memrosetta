import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRemoveClaudeCodeHooks = vi.fn().mockReturnValue(true);
const mockRemoveClaudeMdSection = vi.fn().mockReturnValue(true);
const mockRemoveGenericMCP = vi.fn().mockReturnValue(true);
const mockRemoveCursorMCP = vi.fn().mockReturnValue(true);

vi.mock('../../src/integrations/index.js', () => ({
  removeClaudeCodeHooks: (...args: unknown[]) => mockRemoveClaudeCodeHooks(...args),
  removeClaudeMdSection: (...args: unknown[]) => mockRemoveClaudeMdSection(...args),
  removeGenericMCP: (...args: unknown[]) => mockRemoveGenericMCP(...args),
  removeCursorMCP: (...args: unknown[]) => mockRemoveCursorMCP(...args),
}));

import { run } from '../../src/commands/reset.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reset command', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('shows usage when no flags provided (text)', async () => {
    await run({
      args: [],
      format: 'text',
      noEmbeddings: true,
    });

    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(allOutput).toContain('Usage: memrosetta reset');
    expect(mockRemoveClaudeCodeHooks).not.toHaveBeenCalled();
  });

  it('shows error when no flags provided (json)', async () => {
    await run({
      args: [],
      format: 'json',
      noEmbeddings: true,
    });

    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.error).toContain('No flags specified');
  });

  it('removes claude-code integration with --claude-code', async () => {
    await run({
      args: ['--claude-code'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockRemoveClaudeCodeHooks).toHaveBeenCalled();
    expect(mockRemoveClaudeMdSection).toHaveBeenCalled();
    expect(mockRemoveGenericMCP).toHaveBeenCalled();
    expect(mockRemoveCursorMCP).not.toHaveBeenCalled();

    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.removed.claudeCodeHooks).toBe(true);
    expect(parsed.removed.claudeMd).toBe(true);
  });

  it('removes cursor integration with --cursor', async () => {
    await run({
      args: ['--cursor'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockRemoveCursorMCP).toHaveBeenCalled();
    expect(mockRemoveClaudeCodeHooks).not.toHaveBeenCalled();

    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.removed.cursor).toBe(true);
  });

  it('removes generic MCP with --mcp', async () => {
    await run({
      args: ['--mcp'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockRemoveGenericMCP).toHaveBeenCalled();
    expect(mockRemoveClaudeCodeHooks).not.toHaveBeenCalled();
    expect(mockRemoveCursorMCP).not.toHaveBeenCalled();
  });

  it('removes all integrations with --all', async () => {
    await run({
      args: ['--all'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockRemoveClaudeCodeHooks).toHaveBeenCalled();
    expect(mockRemoveClaudeMdSection).toHaveBeenCalled();
    expect(mockRemoveGenericMCP).toHaveBeenCalled();
    expect(mockRemoveCursorMCP).toHaveBeenCalled();
  });

  it('outputs text format for --claude-code', async () => {
    await run({
      args: ['--claude-code'],
      format: 'text',
      noEmbeddings: true,
    });

    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(allOutput).toContain('Removed Claude Code hooks');
    expect(allOutput).toContain('Removed MemRosetta section');
    expect(allOutput).toContain('Removed MCP server');
    expect(allOutput).toContain('~/.memrosetta/ directory preserved');
  });

  it('shows nothing-to-remove when nothing is configured', async () => {
    mockRemoveClaudeCodeHooks.mockReturnValue(false);
    mockRemoveClaudeMdSection.mockReturnValue(false);
    mockRemoveGenericMCP.mockReturnValue(false);

    await run({
      args: ['--claude-code'],
      format: 'text',
      noEmbeddings: true,
    });

    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(allOutput).toContain('Nothing to remove');
  });
});
