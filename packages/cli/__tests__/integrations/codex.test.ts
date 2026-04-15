import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Mock filesystem
// ---------------------------------------------------------------------------

const mockFs: Record<string, string> = {};

vi.mock('node:os', () => ({
  homedir: () => '/mock-home',
  tmpdir: () => '/tmp',
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
  resolveMcpCommand: () => ({ command: '/usr/local/bin/memrosetta-mcp', args: [] }),
  resolveHookCommand: (name: string) => `/usr/local/bin/${name}`,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  registerCodexHooks,
  removeCodexHooks,
  isCodexHooksConfigured,
  registerCodexMCP,
  removeCodexMCP,
} from '../../src/integrations/codex.js';

const CODEX_DIR = '/mock-home/.codex';
const CONFIG_PATH = join(CODEX_DIR, 'config.toml');
const HOOKS_PATH = join(CODEX_DIR, 'hooks.json');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('codex integration — MCP + Stop hook wiring', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockFs)) delete mockFs[k];
  });

  describe('registerCodexMCP (existing behavior retained)', () => {
    it('writes MCP server section using TOML literal strings', () => {
      mockFs[CODEX_DIR] = '';
      registerCodexMCP();
      const toml = mockFs[CONFIG_PATH];
      expect(toml).toContain('[mcp_servers.memory-service]');
      // literal string quoting — no doubled backslashes
      expect(toml).toContain("command = '/usr/local/bin/memrosetta-mcp'");
    });

    it('cleans legacy [mcp_servers.memrosetta] on re-register', () => {
      mockFs[CODEX_DIR] = '';
      mockFs[CONFIG_PATH] =
        'model = "gpt-5.4"\n\n[mcp_servers.memrosetta]\ncommand = "memrosetta-mcp"\n';
      registerCodexMCP();
      const toml = mockFs[CONFIG_PATH];
      expect(toml).not.toContain('[mcp_servers.memrosetta]\n');
      expect(toml).toContain('[mcp_servers.memory-service]');
    });
  });

  describe('registerCodexHooks', () => {
    it('returns false when Codex is not installed', () => {
      // ~/.codex does not exist in mockFs
      expect(registerCodexHooks()).toBe(false);
    });

    it('writes Stop hook entry to ~/.codex/hooks.json', () => {
      mockFs[CODEX_DIR] = '';
      const result = registerCodexHooks();
      expect(result).toBe(true);

      const hooks = JSON.parse(mockFs[HOOKS_PATH]);
      expect(hooks.hooks.Stop).toHaveLength(1);
      const entry = hooks.hooks.Stop[0];
      expect(entry.matcher).toBe('*');
      expect(entry.hooks[0]).toMatchObject({
        type: 'command',
        command: '/usr/local/bin/memrosetta-enforce-codex',
        timeout: 30,
      });
    });

    it('enables [features] codex_hooks = true in config.toml', () => {
      mockFs[CODEX_DIR] = '';
      mockFs[CONFIG_PATH] = 'model = "gpt-5.4"\n';
      registerCodexHooks();
      expect(mockFs[CONFIG_PATH]).toContain('[features]');
      expect(mockFs[CONFIG_PATH]).toContain('codex_hooks = true');
    });

    it('preserves existing [features] keys when enabling codex_hooks', () => {
      mockFs[CODEX_DIR] = '';
      mockFs[CONFIG_PATH] = '[features]\nother_flag = true\n';
      registerCodexHooks();
      expect(mockFs[CONFIG_PATH]).toContain('other_flag = true');
      expect(mockFs[CONFIG_PATH]).toContain('codex_hooks = true');
    });

    it('flips existing codex_hooks = false to true', () => {
      mockFs[CODEX_DIR] = '';
      mockFs[CONFIG_PATH] = '[features]\ncodex_hooks = false\n';
      registerCodexHooks();
      expect(mockFs[CONFIG_PATH]).toContain('codex_hooks = true');
      expect(mockFs[CONFIG_PATH]).not.toContain('codex_hooks = false');
    });

    it('is idempotent — re-registering replaces the previous entry', () => {
      mockFs[CODEX_DIR] = '';
      registerCodexHooks();
      registerCodexHooks();
      const hooks = JSON.parse(mockFs[HOOKS_PATH]);
      expect(hooks.hooks.Stop).toHaveLength(1);
    });

    it('strips legacy on-stop or enforce-claude-code entries on re-install', () => {
      mockFs[CODEX_DIR] = '';
      mockFs[HOOKS_PATH] = JSON.stringify({
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
              hooks: [
                {
                  type: 'command',
                  command: 'some-user-hook',
                },
              ],
            },
          ],
        },
      });

      registerCodexHooks();
      const hooks = JSON.parse(mockFs[HOOKS_PATH]);
      // The user's non-memrosetta hook is preserved, the legacy
      // memrosetta entry is replaced with the enforce-codex wrapper.
      const commands = hooks.hooks.Stop.flatMap((cfg: { hooks: { command: string }[] }) =>
        cfg.hooks.map((h) => h.command),
      );
      expect(commands).toContain('some-user-hook');
      expect(commands).toContain('/usr/local/bin/memrosetta-enforce-codex');
      expect(commands).not.toContain('memrosetta-on-stop');
    });
  });

  describe('isCodexHooksConfigured', () => {
    it('returns false when hooks.json does not exist', () => {
      expect(isCodexHooksConfigured()).toBe(false);
    });

    it('returns true after registerCodexHooks', () => {
      mockFs[CODEX_DIR] = '';
      registerCodexHooks();
      expect(isCodexHooksConfigured()).toBe(true);
    });

    it('returns false when only non-memrosetta hooks are registered', () => {
      mockFs[HOOKS_PATH] = JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: '*',
              hooks: [{ type: 'command', command: 'other-tool-hook' }],
            },
          ],
        },
      });
      expect(isCodexHooksConfigured()).toBe(false);
    });
  });

  describe('removeCodexHooks', () => {
    it('returns false when no hook was registered', () => {
      expect(removeCodexHooks()).toBe(false);
    });

    it('removes the memrosetta hook while preserving other hooks', () => {
      mockFs[CODEX_DIR] = '';
      // Seed with both a memrosetta hook and a user hook.
      mockFs[HOOKS_PATH] = JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: '*',
              hooks: [
                { type: 'command', command: '/usr/local/bin/memrosetta-enforce-codex' },
              ],
            },
            {
              matcher: '*',
              hooks: [{ type: 'command', command: 'user-hook' }],
            },
          ],
        },
      });

      const result = removeCodexHooks();
      expect(result).toBe(true);

      const hooks = JSON.parse(mockFs[HOOKS_PATH]);
      const commands = (hooks.hooks?.Stop ?? []).flatMap(
        (cfg: { hooks: { command: string }[] }) => cfg.hooks.map((h) => h.command),
      );
      expect(commands).toEqual(['user-hook']);
    });

    it('turns off [features] codex_hooks when no hooks remain', () => {
      mockFs[CODEX_DIR] = '';
      mockFs[CONFIG_PATH] = '[features]\ncodex_hooks = true\n';
      registerCodexHooks();
      removeCodexHooks();
      expect(mockFs[CONFIG_PATH]).not.toContain('codex_hooks = true');
      // Empty [features] section can remain; we only strip the one key.
      expect(mockFs[CONFIG_PATH]).toContain('[features]');
    });

    it('leaves [features] codex_hooks = true alone if user still has other hooks', () => {
      mockFs[CODEX_DIR] = '';
      mockFs[CONFIG_PATH] = '[features]\ncodex_hooks = true\n';
      // Seed with a user hook so the feature flag should stay on.
      mockFs[HOOKS_PATH] = JSON.stringify({
        hooks: {
          Stop: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: '/usr/local/bin/memrosetta-enforce-codex',
                },
              ],
            },
            {
              matcher: '*',
              hooks: [{ type: 'command', command: 'user-hook' }],
            },
          ],
        },
      });

      removeCodexHooks();
      expect(mockFs[CONFIG_PATH]).toContain('codex_hooks = true');
    });
  });
});
