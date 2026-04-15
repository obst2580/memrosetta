import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  isClaudeCodeInstalled,
  isClaudeCodeConfigured,
  registerClaudeCodeHooks,
  removeClaudeCodeHooks,
  updateClaudeMd,
  removeClaudeMdSection,
} from '../../src/integrations/claude-code.js';

const CLAUDE_DIR = '/mock-home/.claude';
const SETTINGS_PATH = join(CLAUDE_DIR, 'settings.json');
const CLAUDE_MD_PATH = join(CLAUDE_DIR, 'CLAUDE.md');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('claude-code integration', () => {
  beforeEach(() => {
    // Clear mock filesystem
    for (const key of Object.keys(mockFs)) {
      delete mockFs[key];
    }
  });

  describe('isClaudeCodeInstalled', () => {
    it('returns false when ~/.claude does not exist', () => {
      expect(isClaudeCodeInstalled()).toBe(false);
    });

    it('returns true when ~/.claude exists', () => {
      mockFs[CLAUDE_DIR] = '';
      expect(isClaudeCodeInstalled()).toBe(true);
    });
  });

  describe('isClaudeCodeConfigured', () => {
    it('returns false when no settings file exists', () => {
      expect(isClaudeCodeConfigured()).toBe(false);
    });

    it('returns false when settings exist but no memrosetta hooks', () => {
      mockFs[SETTINGS_PATH] = JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: '*',
              hooks: [{ type: 'command', command: 'some-other-hook' }],
            },
          ],
        },
      });
      expect(isClaudeCodeConfigured()).toBe(false);
    });

    it('returns true when enforce wrapper stop hook is registered', () => {
      mockFs[SETTINGS_PATH] = JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: 'memrosetta-enforce-claude-code',
                },
              ],
            },
          ],
        },
      });
      expect(isClaudeCodeConfigured()).toBe(true);
    });

    it('still recognizes legacy on-stop hook as configured', () => {
      mockFs[SETTINGS_PATH] = JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: 'memrosetta-on-stop',
                },
              ],
            },
          ],
        },
      });
      expect(isClaudeCodeConfigured()).toBe(true);
    });
  });

  describe('registerClaudeCodeHooks', () => {
    it('returns false when Claude Code is not installed', () => {
      expect(registerClaudeCodeHooks()).toBe(false);
    });

    it('creates hooks in settings.json', () => {
      mockFs[CLAUDE_DIR] = '';
      mockFs[SETTINGS_PATH] = '{}';

      const result = registerClaudeCodeHooks();

      expect(result).toBe(true);
      const settings = JSON.parse(mockFs[SETTINGS_PATH]);
      expect(settings.hooks.Stop).toHaveLength(1);
      expect(settings.hooks.Stop[0].hooks[0].command).toContain(
        'memrosetta-enforce-claude-code',
      );
    });

    it('replaces legacy on-stop hook with the enforce wrapper', () => {
      mockFs[CLAUDE_DIR] = '';
      mockFs[SETTINGS_PATH] = JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: 'npx -y -p @memrosetta/claude-code memrosetta-on-stop',
                },
              ],
            },
            {
              matcher: '*',
              hooks: [
                { type: 'command', command: 'some-other-hook' },
              ],
            },
          ],
        },
      });

      registerClaudeCodeHooks();

      const settings = JSON.parse(mockFs[SETTINGS_PATH]);
      // Legacy memrosetta hook removed, enforce wrapper added, other hook preserved
      expect(settings.hooks.Stop).toHaveLength(2);
      const memHook = settings.hooks.Stop.find(
        (hc: { hooks: { command: string }[] }) =>
          hc.hooks.some((h: { command: string }) => h.command.includes('memrosetta')),
      );
      expect(memHook.hooks[0].command).toContain('memrosetta-enforce-claude-code');
      expect(memHook.hooks[0].command).not.toContain('memrosetta-on-stop');
    });

    it('preserves existing non-memrosetta hooks', () => {
      mockFs[CLAUDE_DIR] = '';
      mockFs[SETTINGS_PATH] = JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: '*',
              hooks: [{ type: 'command', command: 'my-custom-hook' }],
            },
          ],
        },
      });

      registerClaudeCodeHooks();

      const settings = JSON.parse(mockFs[SETTINGS_PATH]);
      expect(settings.hooks.Stop).toHaveLength(2);
    });
  });

  describe('removeClaudeCodeHooks', () => {
    it('returns false when no settings file exists', () => {
      expect(removeClaudeCodeHooks()).toBe(false);
    });

    it('removes memrosetta hooks and keeps others', () => {
      mockFs[CLAUDE_DIR] = '';
      mockFs[SETTINGS_PATH] = JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: 'memrosetta-on-stop',
                },
              ],
            },
            {
              matcher: '*',
              hooks: [{ type: 'command', command: 'other-hook' }],
            },
          ],
        },
      });

      const result = removeClaudeCodeHooks();

      expect(result).toBe(true);
      const settings = JSON.parse(mockFs[SETTINGS_PATH]);
      expect(settings.hooks.Stop).toHaveLength(1);
      expect(settings.hooks.Stop[0].hooks[0].command).toBe('other-hook');
    });
  });

  describe('updateClaudeMd', () => {
    it('returns false when Claude Code is not installed', () => {
      expect(updateClaudeMd()).toBe(false);
    });

    it('creates CLAUDE.md with memory instructions', () => {
      mockFs[CLAUDE_DIR] = '';

      const result = updateClaudeMd();

      expect(result).toBe(true);
      expect(mockFs[CLAUDE_MD_PATH]).toContain(
        '## MemRosetta (Long-term Memory)',
      );
      expect(mockFs[CLAUDE_MD_PATH]).toContain('memory-service');
    });

    it('appends to existing CLAUDE.md', () => {
      mockFs[CLAUDE_DIR] = '';
      mockFs[CLAUDE_MD_PATH] = '# My Config\n\nSome existing content.';

      updateClaudeMd();

      expect(mockFs[CLAUDE_MD_PATH]).toContain('# My Config');
      expect(mockFs[CLAUDE_MD_PATH]).toContain(
        '## MemRosetta (Long-term Memory)',
      );
    });

    it('returns false if already present', () => {
      mockFs[CLAUDE_DIR] = '';
      mockFs[CLAUDE_MD_PATH] = '## MemRosetta (Long-term Memory)\nAlready here.';

      expect(updateClaudeMd()).toBe(false);
    });
  });

  describe('removeClaudeMdSection', () => {
    it('returns false when CLAUDE.md does not exist', () => {
      expect(removeClaudeMdSection()).toBe(false);
    });

    it('returns false when section not found', () => {
      mockFs[CLAUDE_MD_PATH] = '# My Config\nNo memrosetta here.';
      expect(removeClaudeMdSection()).toBe(false);
    });

    it('removes the MemRosetta section', () => {
      mockFs[CLAUDE_MD_PATH] =
        '# My Config\n\nSome content.\n\n## MemRosetta (Long-term Memory)\n\nMemory instructions here.\n\n## Other Section\n\nKeep this.';

      const result = removeClaudeMdSection();

      expect(result).toBe(true);
      expect(mockFs[CLAUDE_MD_PATH]).toContain('# My Config');
      expect(mockFs[CLAUDE_MD_PATH]).toContain('## Other Section');
      expect(mockFs[CLAUDE_MD_PATH]).not.toContain('MemRosetta');
    });

    it('removes section at end of file', () => {
      mockFs[CLAUDE_MD_PATH] =
        '# My Config\n\n## MemRosetta (Long-term Memory)\n\nMemory instructions here.\n';

      const result = removeClaudeMdSection();

      expect(result).toBe(true);
      expect(mockFs[CLAUDE_MD_PATH]).toContain('# My Config');
      expect(mockFs[CLAUDE_MD_PATH]).not.toContain('MemRosetta');
    });
  });
});
