import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/integrations/index.js', () => ({
  isClaudeCodeConfigured: vi.fn().mockReturnValue(true),
  isCursorConfigured: vi.fn().mockReturnValue(false),
  isCodexConfigured: vi.fn().mockReturnValue(false),
  isGeminiConfigured: vi.fn().mockReturnValue(true),
  isGenericMCPConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock('../../src/engine.js', () => ({
  getDefaultDbPath: vi.fn().mockReturnValue('/tmp/test-status.db'),
}));

vi.mock('../../src/hooks/config.js', () => ({
  getConfig: vi.fn().mockReturnValue({}),
  getDefaultUserId: vi.fn().mockReturnValue('testuser'),
}));

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    existsSync: vi.fn().mockReturnValue(false),
    statSync: vi.fn().mockReturnValue({ size: 0 }),
  };
});

import { run, deriveReadiness } from '../../src/commands/status.js';

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
    expect(allOutput).toContain('Codex:         not configured');
    expect(allOutput).toContain('Gemini:        configured');
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
    expect(parsed.integrations.codex).toBe(false);
    expect(parsed.integrations.gemini).toBe(true);
    expect(parsed.integrations.mcp).toBe(true);
  });

  it('defaults scope to current user', async () => {
    await run({
      args: [],
      format: 'json',
      noEmbeddings: true,
    });
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.scope).toEqual({ kind: 'user', userId: 'testuser' });
  });

  it('--all-users switches scope to global', async () => {
    await run({
      args: ['--all-users'],
      format: 'json',
      noEmbeddings: true,
    });
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.scope).toEqual({ kind: 'global', userId: null });
  });

  it('--user <id> overrides the default user', async () => {
    await run({
      args: ['--user', 'alice'],
      format: 'json',
      noEmbeddings: true,
    });
    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.scope).toEqual({ kind: 'user', userId: 'alice' });
  });
});

describe('deriveReadiness', () => {
  it('returns empty for a brand-new DB', () => {
    expect(
      deriveReadiness({ memoryCount: 0, episodes: 0, bindings: 0, index: 0 }),
    ).toBe('empty');
  });

  it('returns empty when memories exist but episodic layer does not', () => {
    // This is the v0.11 upgrade baseline — memories accumulated but
    // no episode/binding write ever happened.
    expect(
      deriveReadiness({
        memoryCount: 21510,
        episodes: 0,
        bindings: 0,
        index: 0,
      }),
    ).toBe('empty');
  });

  it('returns ready when every table is populated and bindings cover ≥95% of memories', () => {
    expect(
      deriveReadiness({
        memoryCount: 100,
        episodes: 10,
        bindings: 100,
        index: 30,
      }),
    ).toBe('ready');
    // Exactly at the 95% threshold
    expect(
      deriveReadiness({
        memoryCount: 100,
        episodes: 10,
        bindings: 95,
        index: 30,
      }),
    ).toBe('ready');
  });

  it('returns degraded for a partial-bind state (Codex Windows observation)', () => {
    // The exact numbers Codex reported after upgrading:
    // 9934 bindings / 21510 memories = ~46% — well below the 95%
    // ready threshold. Prior to the fix this was classified `ready`,
    // hiding the fact that more than half the store was invisible to
    // the recall kernel.
    expect(
      deriveReadiness({
        memoryCount: 21510,
        episodes: 22,
        bindings: 9934,
        index: 116,
      }),
    ).toBe('degraded');
  });

  it('returns degraded when one of the tables is missing', () => {
    // episodes and bindings but no index — e.g. a pre-v0.12 hook that
    // wrote binding rows but skipped the hippocampal cue pass.
    expect(
      deriveReadiness({
        memoryCount: 100,
        episodes: 5,
        bindings: 100,
        index: 0,
      }),
    ).toBe('degraded');
  });

  it('returns degraded just below the coverage threshold', () => {
    // 94/100 = 94% — one memory shy of ready.
    expect(
      deriveReadiness({
        memoryCount: 100,
        episodes: 10,
        bindings: 94,
        index: 10,
      }),
    ).toBe('degraded');
  });
});
