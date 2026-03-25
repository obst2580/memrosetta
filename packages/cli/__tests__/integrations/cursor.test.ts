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
  mkdirSync: () => undefined,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  isCursorConfigured,
  registerCursorMCP,
  removeCursorMCP,
  getCursorMcpConfigPath,
} from '../../src/integrations/cursor.js';

const CURSOR_MCP_PATH = '/mock-home/.cursor/mcp.json';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cursor integration', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockFs)) {
      delete mockFs[key];
    }
  });

  describe('getCursorMcpConfigPath', () => {
    it('returns ~/.cursor/mcp.json path', () => {
      expect(getCursorMcpConfigPath()).toBe(CURSOR_MCP_PATH);
    });
  });

  describe('isCursorConfigured', () => {
    it('returns false when mcp.json does not exist', () => {
      expect(isCursorConfigured()).toBe(false);
    });

    it('returns false when memory-service is not in config', () => {
      mockFs[CURSOR_MCP_PATH] = JSON.stringify({ mcpServers: {} });
      expect(isCursorConfigured()).toBe(false);
    });

    it('returns true when memory-service is registered', () => {
      mockFs[CURSOR_MCP_PATH] = JSON.stringify({
        mcpServers: { 'memory-service': { command: 'npx' } },
      });
      expect(isCursorConfigured()).toBe(true);
    });
  });

  describe('registerCursorMCP', () => {
    it('creates mcp.json when it does not exist', () => {
      registerCursorMCP();

      const config = JSON.parse(mockFs[CURSOR_MCP_PATH]);
      expect(config.mcpServers['memory-service']).toBeDefined();
      expect(config.mcpServers['memory-service'].command).toBe('npx');
      expect(config.mcpServers['memory-service'].args).toContain(
        '@memrosetta/mcp',
      );
    });

    it('adds to existing mcp.json preserving other servers', () => {
      mockFs[CURSOR_MCP_PATH] = JSON.stringify({
        mcpServers: { 'other-mcp': { command: 'npx', args: ['other'] } },
      });

      registerCursorMCP();

      const config = JSON.parse(mockFs[CURSOR_MCP_PATH]);
      expect(config.mcpServers['other-mcp']).toBeDefined();
      expect(config.mcpServers['memory-service']).toBeDefined();
    });
  });

  describe('removeCursorMCP', () => {
    it('returns false when mcp.json does not exist', () => {
      expect(removeCursorMCP()).toBe(false);
    });

    it('returns false when memory-service not registered', () => {
      mockFs[CURSOR_MCP_PATH] = JSON.stringify({ mcpServers: {} });
      expect(removeCursorMCP()).toBe(false);
    });

    it('removes memory-service and keeps others', () => {
      mockFs[CURSOR_MCP_PATH] = JSON.stringify({
        mcpServers: {
          'memory-service': { command: 'npx' },
          'other-mcp': { command: 'other' },
        },
      });

      const result = removeCursorMCP();

      expect(result).toBe(true);
      const config = JSON.parse(mockFs[CURSOR_MCP_PATH]);
      expect(config.mcpServers['memory-service']).toBeUndefined();
      expect(config.mcpServers['other-mcp']).toBeDefined();
    });
  });
});
