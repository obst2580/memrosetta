import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';

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

vi.mock('../../src/integrations/resolve-command.js', () => ({
  resolveMcpCommand: () => ({ command: 'memrosetta-mcp', args: [] }),
  resolveHookCommand: (name: string) => name,
}));

// Mock process.cwd()
const MOCK_CWD = '/mock-project';
vi.spyOn(process, 'cwd').mockReturnValue(MOCK_CWD);

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  isGeminiInstalled,
  isGeminiConfigured,
  registerGeminiMCP,
  removeGeminiMCP,
  getGeminiSettingsFilePath,
  getGeminiMdPath,
  updateGeminiMd,
  removeGeminiMdSection,
} from '../../src/integrations/gemini.js';

const GEMINI_SETTINGS_PATH = '/mock-home/.gemini/settings.json';
const GEMINI_MD_PATH = join(MOCK_CWD, 'GEMINI.md');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gemini integration', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockFs)) {
      delete mockFs[key];
    }
  });

  describe('getGeminiSettingsFilePath', () => {
    it('returns ~/.gemini/settings.json path', () => {
      expect(getGeminiSettingsFilePath()).toBe(GEMINI_SETTINGS_PATH);
    });
  });

  describe('getGeminiMdPath', () => {
    it('returns ./GEMINI.md path', () => {
      expect(getGeminiMdPath()).toBe(GEMINI_MD_PATH);
    });
  });

  describe('isGeminiInstalled', () => {
    it('returns false when ~/.gemini does not exist', () => {
      expect(isGeminiInstalled()).toBe(false);
    });

    it('returns true when ~/.gemini exists', () => {
      mockFs['/mock-home/.gemini'] = 'directory'; // simplified
      expect(isGeminiInstalled()).toBe(true);
    });
  });

  describe('isGeminiConfigured', () => {
    it('returns false when settings.json does not exist', () => {
      expect(isGeminiConfigured()).toBe(false);
    });

    it('returns false when memory-service is not in config', () => {
      mockFs[GEMINI_SETTINGS_PATH] = JSON.stringify({ mcpServers: {} });
      expect(isGeminiConfigured()).toBe(false);
    });

    it('returns true when memory-service is registered', () => {
      mockFs[GEMINI_SETTINGS_PATH] = JSON.stringify({
        mcpServers: { 'memory-service': { command: 'node' } },
      });
      expect(isGeminiConfigured()).toBe(true);
    });
  });

  describe('registerGeminiMCP', () => {
    it('creates settings.json when it does not exist', () => {
      registerGeminiMCP();

      const config = JSON.parse(mockFs[GEMINI_SETTINGS_PATH]);
      expect(config.mcpServers['memory-service']).toBeDefined();
      expect(config.mcpServers['memory-service'].command).toBe('memrosetta-mcp');
      expect(config.mcpServers['memory-service'].args).toEqual([]);
    });

    it('adds to existing settings.json preserving other servers', () => {
      mockFs[GEMINI_SETTINGS_PATH] = JSON.stringify({
        mcpServers: { 'other-mcp': { command: 'node', args: ['other'] } },
      });

      registerGeminiMCP();

      const config = JSON.parse(mockFs[GEMINI_SETTINGS_PATH]);
      expect(config.mcpServers['other-mcp']).toBeDefined();
      expect(config.mcpServers['memory-service']).toBeDefined();
    });

    it('also creates GEMINI.md with MemRosetta section', () => {
      registerGeminiMCP();

      expect(mockFs[GEMINI_MD_PATH]).toBeDefined();
      expect(mockFs[GEMINI_MD_PATH]).toContain(
        '## MemRosetta (Long-term Memory)',
      );
      expect(mockFs[GEMINI_MD_PATH]).toContain('memrosetta_search');
      expect(mockFs[GEMINI_MD_PATH]).toContain('memrosetta_store');
    });
  });

  describe('removeGeminiMCP', () => {
    it('returns false when settings.json does not exist', () => {
      expect(removeGeminiMCP()).toBe(false);
    });

    it('returns false when memory-service not registered', () => {
      mockFs[GEMINI_SETTINGS_PATH] = JSON.stringify({ mcpServers: {} });
      expect(removeGeminiMCP()).toBe(false);
    });

    it('removes memory-service and keeps others', () => {
      mockFs[GEMINI_SETTINGS_PATH] = JSON.stringify({
        mcpServers: {
          'memory-service': { command: 'node' },
          'other-mcp': { command: 'other' },
        },
      });

      const result = removeGeminiMCP();

      expect(result).toBe(true);
      const config = JSON.parse(mockFs[GEMINI_SETTINGS_PATH]);
      expect(config.mcpServers['memory-service']).toBeUndefined();
      expect(config.mcpServers['other-mcp']).toBeDefined();
    });

    it('does not remove GEMINI.md section (callers handle that separately)', () => {
      mockFs[GEMINI_SETTINGS_PATH] = JSON.stringify({
        mcpServers: { 'memory-service': { command: 'node' } },
      });
      mockFs[GEMINI_MD_PATH] =
        '# My Rules\n\n## MemRosetta (Long-term Memory)\n\nSome instructions.\n';

      removeGeminiMCP();

      // MCP removed from settings
      const settings = JSON.parse(mockFs[GEMINI_SETTINGS_PATH]);
      expect(settings.mcpServers?.['memory-service']).toBeUndefined();
      // GEMINI.md untouched by removeGeminiMCP
      expect(mockFs[GEMINI_MD_PATH]).toContain('MemRosetta');
    });
  });

  describe('updateGeminiMd', () => {
    it('creates GEMINI.md when it does not exist', () => {
      const result = updateGeminiMd();

      expect(result).toBe(true);
      expect(mockFs[GEMINI_MD_PATH]).toContain(
        '## MemRosetta (Long-term Memory)',
      );
    });

    it('appends to existing GEMINI.md', () => {
      mockFs[GEMINI_MD_PATH] = '# My custom rules\n\nSome content here.\n';

      const result = updateGeminiMd();

      expect(result).toBe(true);
      expect(mockFs[GEMINI_MD_PATH]).toContain('# My custom rules');
      expect(mockFs[GEMINI_MD_PATH]).toContain(
        '## MemRosetta (Long-term Memory)',
      );
    });

    it('returns false if MemRosetta section already exists', () => {
      mockFs[GEMINI_MD_PATH] =
        '## MemRosetta (Long-term Memory)\n\nAlready there.\n';

      const result = updateGeminiMd();

      expect(result).toBe(false);
    });
  });

  describe('removeGeminiMdSection', () => {
    it('returns false when GEMINI.md does not exist', () => {
      expect(removeGeminiMdSection()).toBe(false);
    });

    it('returns false when MemRosetta section not present', () => {
      mockFs[GEMINI_MD_PATH] = '# Some rules\n\nContent.\n';

      expect(removeGeminiMdSection()).toBe(false);
    });

    it('removes MemRosetta section and preserves other content', () => {
      mockFs[GEMINI_MD_PATH] =
        '# My Rules\n\n## MemRosetta (Long-term Memory)\n\nMemRosetta instructions.\n\n## Other Section\n\nOther content.\n';

      const result = removeGeminiMdSection();

      expect(result).toBe(true);
      expect(mockFs[GEMINI_MD_PATH]).toContain('# My Rules');
      expect(mockFs[GEMINI_MD_PATH]).not.toContain('MemRosetta');
      expect(mockFs[GEMINI_MD_PATH]).toContain('## Other Section');
    });
  });
});
