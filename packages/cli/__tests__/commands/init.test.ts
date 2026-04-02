import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRegisterClaudeCodeHooks = vi.fn().mockReturnValue(true);
const mockUpdateClaudeMd = vi.fn().mockReturnValue(true);
const mockRegisterGenericMCP = vi.fn();
const mockRegisterCursorMCP = vi.fn().mockReturnValue(true);
const mockRegisterCodexMCP = vi.fn().mockReturnValue(true);
const mockRegisterGeminiMCP = vi.fn().mockReturnValue(true);
const mockIsClaudeCodeInstalled = vi.fn().mockReturnValue(true);
const mockIsCodexInstalled = vi.fn().mockReturnValue(true);
const mockIsGeminiInstalled = vi.fn().mockReturnValue(true);

vi.mock('../../src/integrations/index.js', () => ({
  isClaudeCodeInstalled: (...args: unknown[]) => mockIsClaudeCodeInstalled(...args),
  isCodexInstalled: (...args: unknown[]) => mockIsCodexInstalled(...args),
  isGeminiInstalled: (...args: unknown[]) => mockIsGeminiInstalled(...args),
  registerClaudeCodeHooks: (...args: unknown[]) => mockRegisterClaudeCodeHooks(...args),
  updateClaudeMd: (...args: unknown[]) => mockUpdateClaudeMd(...args),
  registerGenericMCP: (...args: unknown[]) => mockRegisterGenericMCP(...args),
  registerCursorMCP: (...args: unknown[]) => mockRegisterCursorMCP(...args),
  registerCodexMCP: (...args: unknown[]) => mockRegisterCodexMCP(...args),
  registerGeminiMCP: (...args: unknown[]) => mockRegisterGeminiMCP(...args),
  getGenericMCPPath: () => '/mock-home/.mcp.json',
  getCursorMcpConfigPath: () => '/mock-home/.cursor/mcp.json',
  getCursorRulesPath: () => '/mock-home/.cursorrules',
  getCodexConfigFilePath: () => '/mock-home/.codex/config.toml',
  getAgentsMdPath: () => '/mock-home/AGENTS.md',
  getGeminiSettingsFilePath: () => '/mock-home/.gemini/settings.json',
  getGeminiMdPath: () => '/mock-home/GEMINI.md',
}));

vi.mock('../../src/hooks/config.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    dbPath: '/tmp/test-init.db',
    enableEmbeddings: true,
    maxRecallResults: 5,
    minQueryLength: 5,
    maxContextChars: 2000,
  }),
  writeConfig: vi.fn(),
}));

vi.mock('../../src/engine.js', () => ({
  getEngine: vi.fn().mockImplementation(async () => ({
    close: vi.fn(),
  })),
  closeEngine: vi.fn(),
  getDefaultDbPath: vi.fn().mockReturnValue('/tmp/test-init.db'),
}));

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    existsSync: vi.fn().mockReturnValue(false),
  };
});

import { run } from '../../src/commands/init.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('init command', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.clearAllMocks();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('initializes DB + MCP without integration flags (json)', async () => {
    await run({
      args: [],
      format: 'json',
      noEmbeddings: true,
    });

    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.database.path).toBe('/tmp/test-init.db');
    expect(parsed.database.created).toBe(true);
    // MCP is always registered as base functionality
    expect(parsed.integrations.mcp).toBeDefined();
    expect(parsed.integrations.mcp.registered).toBe(true);

    expect(mockRegisterClaudeCodeHooks).not.toHaveBeenCalled();
    expect(mockRegisterGenericMCP).toHaveBeenCalled(); // MCP always called
    expect(mockRegisterCursorMCP).not.toHaveBeenCalled();
  });

  it('sets up claude-code integration with --claude-code flag', async () => {
    await run({
      args: ['--claude-code'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockRegisterClaudeCodeHooks).toHaveBeenCalled();
    expect(mockRegisterGenericMCP).toHaveBeenCalled();
    expect(mockUpdateClaudeMd).toHaveBeenCalled();

    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.integrations.claudeCode).toBeDefined();
    expect(parsed.integrations.claudeCode.hooks).toBe(true);
    expect(parsed.integrations.claudeCode.mcp).toBe(true);
  });

  it('sets up cursor integration with --cursor flag', async () => {
    await run({
      args: ['--cursor'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockRegisterCursorMCP).toHaveBeenCalled();
    expect(mockRegisterClaudeCodeHooks).not.toHaveBeenCalled();

    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.integrations.cursor).toBeDefined();
    expect(parsed.integrations.cursor.mcp).toBe(true);
  });

  it('sets up gemini integration with --gemini flag', async () => {
    await run({
      args: ['--gemini'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockRegisterGeminiMCP).toHaveBeenCalled();
    expect(mockRegisterClaudeCodeHooks).not.toHaveBeenCalled();

    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.integrations.gemini).toBeDefined();
    expect(parsed.integrations.gemini.mcp).toBe(true);
  });

  it('sets up generic MCP with --mcp flag', async () => {
    await run({
      args: ['--mcp'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockRegisterGenericMCP).toHaveBeenCalled();
    expect(mockRegisterClaudeCodeHooks).not.toHaveBeenCalled();
    expect(mockRegisterCursorMCP).not.toHaveBeenCalled();

    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.integrations.mcp).toBeDefined();
    expect(parsed.integrations.mcp.registered).toBe(true);
  });

  it('supports multiple flags simultaneously', async () => {
    await run({
      args: ['--claude-code', '--cursor'],
      format: 'json',
      noEmbeddings: true,
    });

    expect(mockRegisterClaudeCodeHooks).toHaveBeenCalled();
    expect(mockRegisterGenericMCP).toHaveBeenCalled();
    expect(mockRegisterCursorMCP).toHaveBeenCalled();

    const written = stdoutSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.integrations.claudeCode).toBeDefined();
    expect(parsed.integrations.cursor).toBeDefined();
  });

  it('outputs text format with --claude-code', async () => {
    await run({
      args: ['--claude-code'],
      format: 'text',
      noEmbeddings: true,
    });

    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(allOutput).toContain('MemRosetta initialized successfully');
    expect(allOutput).toContain('Stop Hook');
    expect(allOutput).toContain('MCP Server');
  });

  it('shows MCP info when no integration flags used (text)', async () => {
    await run({
      args: [],
      format: 'text',
      noEmbeddings: true,
    });

    const allOutput = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(allOutput).toContain('MCP is ready');
  });
});
