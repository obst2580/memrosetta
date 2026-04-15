import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExecSync = vi.fn();
const mockExistsSync = vi.fn();
const mockCreateRequire = vi.fn();

vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

vi.mock('node:fs', () => ({
  existsSync: (path: string) => mockExistsSync(path),
}));

vi.mock('node:module', () => ({
  createRequire: (...args: unknown[]) => mockCreateRequire(...args),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  resolveMcpCommand,
  resolveHookCommand,
} from '../../src/integrations/resolve-command.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolve-command', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('resolveMcpCommand', () => {
    it('returns bare command when binary is in PATH', () => {
      mockExecSync.mockReturnValue(Buffer.from('/usr/local/bin/memrosetta-mcp'));

      const result = resolveMcpCommand();

      expect(result).toEqual({ command: 'memrosetta-mcp', args: [] });
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('memrosetta-mcp'),
        { stdio: 'ignore' },
      );
    });

    it('falls back to node + resolved path when not in PATH but package exists', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const mockRequire = vi.fn();
      mockRequire.mockReturnValue('/mock/node_modules/@memrosetta/mcp/package.json');
      // resolve returns a string path for package.json
      mockRequire.resolve = vi.fn().mockReturnValue(
        '/mock/node_modules/@memrosetta/mcp/package.json',
      );
      mockCreateRequire.mockReturnValue(mockRequire);
      mockExistsSync.mockReturnValue(true);

      const result = resolveMcpCommand();

      expect(result.command).toBe('node');
      expect(result.args).toHaveLength(1);
      expect(result.args[0]).toContain('dist/index.js');
    });

    it('falls back to bare command when not in PATH and package not found', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });
      mockCreateRequire.mockImplementation(() => {
        const req = () => {};
        req.resolve = () => {
          throw new Error('MODULE_NOT_FOUND');
        };
        return req;
      });

      const result = resolveMcpCommand();

      expect(result).toEqual({ command: 'memrosetta-mcp', args: [] });
    });

    it('falls back to bare command when resolved path does not exist', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const mockRequire = vi.fn();
      mockRequire.resolve = vi.fn().mockReturnValue(
        '/mock/node_modules/@memrosetta/mcp/package.json',
      );
      mockCreateRequire.mockReturnValue(mockRequire);
      mockExistsSync.mockReturnValue(false);

      const result = resolveMcpCommand();

      expect(result).toEqual({ command: 'memrosetta-mcp', args: [] });
    });
  });

  describe('resolveHookCommand', () => {
    it('returns bare command when binary is in PATH', () => {
      mockExecSync.mockReturnValue(Buffer.from('/usr/local/bin/memrosetta-on-stop'));

      const result = resolveHookCommand('memrosetta-on-stop');

      expect(result).toBe('memrosetta-on-stop');
    });

    it('falls back to node + resolved path for on-stop hook', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const mockRequire = vi.fn();
      mockRequire.resolve = vi.fn().mockReturnValue(
        '/mock/node_modules/@memrosetta/cli/package.json',
      );
      mockCreateRequire.mockReturnValue(mockRequire);
      mockExistsSync.mockReturnValue(true);

      const result = resolveHookCommand('memrosetta-on-stop');

      expect(result).toContain('node ');
      expect(result).toContain('hooks/on-stop.js');
    });

    it('falls back to node + resolved path for on-prompt hook', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const mockRequire = vi.fn();
      mockRequire.resolve = vi.fn().mockReturnValue(
        '/mock/node_modules/@memrosetta/cli/package.json',
      );
      mockCreateRequire.mockReturnValue(mockRequire);
      mockExistsSync.mockReturnValue(true);

      const result = resolveHookCommand('memrosetta-on-prompt');

      expect(result).toContain('node ');
      expect(result).toContain('hooks/on-prompt.js');
    });

    it('falls back to node + resolved path for enforce-claude-code hook', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const mockRequire = vi.fn();
      mockRequire.resolve = vi.fn().mockReturnValue(
        '/mock/node_modules/@memrosetta/cli/package.json',
      );
      mockCreateRequire.mockReturnValue(mockRequire);
      mockExistsSync.mockReturnValue(true);

      const result = resolveHookCommand('memrosetta-enforce-claude-code');

      expect(result).toContain('node ');
      expect(result).toContain('hooks/enforce-claude-code.js');
    });

    it('falls back to bare command when not in PATH and package not found', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });
      mockCreateRequire.mockImplementation(() => {
        const req = () => {};
        req.resolve = () => {
          throw new Error('MODULE_NOT_FOUND');
        };
        return req;
      });

      const result = resolveHookCommand('memrosetta-on-stop');

      expect(result).toBe('memrosetta-on-stop');
    });
  });
});
