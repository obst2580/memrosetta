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
  getCursorRulesPath,
  updateCursorRules,
  removeCursorRulesSection,
} from '../../src/integrations/cursor.js';

const CURSOR_MCP_PATH = '/mock-home/.cursor/mcp.json';
const CURSOR_RULES_PATH = '/mock-home/.cursorrules';

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

  describe('getCursorRulesPath', () => {
    it('returns ~/.cursorrules path', () => {
      expect(getCursorRulesPath()).toBe(CURSOR_RULES_PATH);
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

    it('also creates .cursorrules with MemRosetta section', () => {
      registerCursorMCP();

      expect(mockFs[CURSOR_RULES_PATH]).toBeDefined();
      expect(mockFs[CURSOR_RULES_PATH]).toContain(
        '## MemRosetta (Long-term Memory)',
      );
      expect(mockFs[CURSOR_RULES_PATH]).toContain('memrosetta_search');
      expect(mockFs[CURSOR_RULES_PATH]).toContain('memrosetta_store');
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

    it('also removes MemRosetta section from .cursorrules', () => {
      mockFs[CURSOR_MCP_PATH] = JSON.stringify({
        mcpServers: { 'memory-service': { command: 'npx' } },
      });
      mockFs[CURSOR_RULES_PATH] =
        '# My Rules\n\n## MemRosetta (Long-term Memory)\n\nSome instructions.\n';

      removeCursorMCP();

      expect(mockFs[CURSOR_RULES_PATH]).not.toContain('MemRosetta');
      expect(mockFs[CURSOR_RULES_PATH]).toContain('# My Rules');
    });
  });

  describe('updateCursorRules', () => {
    it('creates .cursorrules when it does not exist', () => {
      const result = updateCursorRules();

      expect(result).toBe(true);
      expect(mockFs[CURSOR_RULES_PATH]).toContain(
        '## MemRosetta (Long-term Memory)',
      );
      expect(mockFs[CURSOR_RULES_PATH]).toContain('memrosetta_store');
      expect(mockFs[CURSOR_RULES_PATH]).toContain('memrosetta_search');
      expect(mockFs[CURSOR_RULES_PATH]).toContain('memrosetta_relate');
      expect(mockFs[CURSOR_RULES_PATH]).toContain('memrosetta_working_memory');
    });

    it('appends to existing .cursorrules', () => {
      mockFs[CURSOR_RULES_PATH] = '# My custom rules\n\nSome content here.\n';

      const result = updateCursorRules();

      expect(result).toBe(true);
      expect(mockFs[CURSOR_RULES_PATH]).toContain('# My custom rules');
      expect(mockFs[CURSOR_RULES_PATH]).toContain(
        '## MemRosetta (Long-term Memory)',
      );
    });

    it('returns false if MemRosetta section already exists', () => {
      mockFs[CURSOR_RULES_PATH] =
        '## MemRosetta (Long-term Memory)\n\nAlready there.\n';

      const result = updateCursorRules();

      expect(result).toBe(false);
    });
  });

  describe('removeCursorRulesSection', () => {
    it('returns false when .cursorrules does not exist', () => {
      expect(removeCursorRulesSection()).toBe(false);
    });

    it('returns false when MemRosetta section not present', () => {
      mockFs[CURSOR_RULES_PATH] = '# Some rules\n\nContent.\n';

      expect(removeCursorRulesSection()).toBe(false);
    });

    it('removes MemRosetta section and preserves other content', () => {
      mockFs[CURSOR_RULES_PATH] =
        '# My Rules\n\n## MemRosetta (Long-term Memory)\n\nMemRosetta instructions.\n\n## Other Section\n\nOther content.\n';

      const result = removeCursorRulesSection();

      expect(result).toBe(true);
      expect(mockFs[CURSOR_RULES_PATH]).toContain('# My Rules');
      expect(mockFs[CURSOR_RULES_PATH]).not.toContain('MemRosetta');
      expect(mockFs[CURSOR_RULES_PATH]).toContain('## Other Section');
      expect(mockFs[CURSOR_RULES_PATH]).toContain('Other content.');
    });

    it('removes MemRosetta section when it is the last section', () => {
      mockFs[CURSOR_RULES_PATH] =
        '# My Rules\n\n## MemRosetta (Long-term Memory)\n\nMemRosetta instructions.\n';

      const result = removeCursorRulesSection();

      expect(result).toBe(true);
      expect(mockFs[CURSOR_RULES_PATH]).toContain('# My Rules');
      expect(mockFs[CURSOR_RULES_PATH]).not.toContain('MemRosetta');
    });
  });
});
