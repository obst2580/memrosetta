import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/integrations/index.js', () => ({
  isClaudeCodeConfigured: vi.fn().mockReturnValue(true),
  isCursorConfigured: vi.fn().mockReturnValue(false),
  isGenericMCPConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock('../../src/engine.js', () => ({
  getDefaultDbPath: vi.fn().mockReturnValue('/tmp/test-status.db'),
}));

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    existsSync: vi.fn().mockReturnValue(false),
    statSync: vi.fn().mockReturnValue({ size: 0 }),
  };
});

import { run } from '../../src/commands/status.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('status command', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('shows integration status in text format', async () => {
    await run({
      args: [],
      format: 'text',
      noEmbeddings: true,
    });

    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(allOutput).toContain('Integrations:');
    expect(allOutput).toContain('Claude Code:   configured');
    expect(allOutput).toContain('Cursor:        not configured');
    expect(allOutput).toContain('MCP (generic): configured');
  });

  it('includes integrations in json format', async () => {
    await run({
      args: [],
      format: 'json',
      noEmbeddings: true,
    });

    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.integrations).toBeDefined();
    expect(parsed.integrations.claudeCode).toBe(true);
    expect(parsed.integrations.cursor).toBe(false);
    expect(parsed.integrations.mcp).toBe(true);
  });
});
