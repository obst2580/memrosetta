import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock filesystem
// ---------------------------------------------------------------------------

const mockFs: Record<string, string> = {};

vi.mock('node:os', () => ({
  homedir: () => '/mock-home',
}));

vi.mock('node:fs', () => ({
  existsSync: (path: string) => path in mockFs,
  readFileSync: (path: string) => {
    if (!(path in mockFs)) throw new Error(`ENOENT: ${path}`);
    return mockFs[path];
  },
  writeFileSync: (path: string, data: string) => {
    mockFs[path] = data;
  },
}));

vi.mock('../../src/integrations/resolve-command.js', () => ({
  resolveMcpCommand: () => ({ command: 'memrosetta-mcp', args: [] }),
  resolveHookCommand: (name: string) => name,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  isGenericMCPConfigured,
  registerGenericMCP,
  removeGenericMCP,
  getGenericMCPPath,
} from '../../src/integrations/mcp.js';

const MCP_PATH = '/mock-home/.mcp.json';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mcp integration', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockFs)) {
      delete mockFs[key];
    }
  });

  describe('getGenericMCPPath', () => {
    it('returns ~/.mcp.json path', () => {
      expect(getGenericMCPPath()).toBe(MCP_PATH);
    });
  });

  describe('isGenericMCPConfigured', () => {
    it('returns false when .mcp.json does not exist', () => {
      expect(isGenericMCPConfigured()).toBe(false);
    });

    it('returns false when memory-service is not in config', () => {
      mockFs[MCP_PATH] = JSON.stringify({ mcpServers: {} });
      expect(isGenericMCPConfigured()).toBe(false);
    });

    it('returns true when memory-service is registered', () => {
      mockFs[MCP_PATH] = JSON.stringify({
        mcpServers: { 'memory-service': { command: 'npx' } },
      });
      expect(isGenericMCPConfigured()).toBe(true);
    });
  });

  describe('registerGenericMCP', () => {
    it('creates .mcp.json when it does not exist', () => {
      registerGenericMCP();

      const config = JSON.parse(mockFs[MCP_PATH]);
      expect(config.mcpServers['memory-service']).toBeDefined();
      expect(config.mcpServers['memory-service'].command).toBe('memrosetta-mcp');
    });

    it('adds to existing .mcp.json', () => {
      mockFs[MCP_PATH] = JSON.stringify({
        mcpServers: { 'other-server': { command: 'other' } },
      });

      registerGenericMCP();

      const config = JSON.parse(mockFs[MCP_PATH]);
      expect(config.mcpServers['other-server']).toBeDefined();
      expect(config.mcpServers['memory-service']).toBeDefined();
    });
  });

  describe('removeGenericMCP', () => {
    it('returns false when .mcp.json does not exist', () => {
      expect(removeGenericMCP()).toBe(false);
    });

    it('returns false when memory-service is not registered', () => {
      mockFs[MCP_PATH] = JSON.stringify({ mcpServers: {} });
      expect(removeGenericMCP()).toBe(false);
    });

    it('removes memory-service and keeps others', () => {
      mockFs[MCP_PATH] = JSON.stringify({
        mcpServers: {
          'memory-service': { command: 'npx' },
          'other-server': { command: 'other' },
        },
      });

      const result = removeGenericMCP();

      expect(result).toBe(true);
      const config = JSON.parse(mockFs[MCP_PATH]);
      expect(config.mcpServers['memory-service']).toBeUndefined();
      expect(config.mcpServers['other-server']).toBeDefined();
    });
  });
});
