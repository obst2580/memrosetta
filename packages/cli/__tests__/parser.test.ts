import { describe, it, expect } from 'vitest';
import { parseGlobalArgs } from '../src/parser.js';

/**
 * Regression: every command registered in the CLI dispatch (src/index.ts)
 * must also be recognised by parseGlobalArgs, otherwise the top-level
 * `if (!command)` path fires and the user sees the help text instead
 * of the actual command running. This happened in v0.10.0 where
 * `recall` was added to the dispatch but not to the parser's command
 * set — test catches any future recurrence.
 */
describe('parseGlobalArgs command detection', () => {
  const registeredCommands = [
    'store',
    'search',
    'recall',
    'ingest',
    'get',
    'count',
    'clear',
    'relate',
    'invalidate',
    'working-memory',
    'maintain',
    'compress',
    'status',
    'init',
    'reset',
    'update',
    'feedback',
    'sync',
    'enforce',
    'migrate',
    'duplicates',
    'dedupe',
  ];

  for (const cmd of registeredCommands) {
    it(`recognises '${cmd}' as a valid command`, () => {
      const parsed = parseGlobalArgs([cmd, '--query', 'x']);
      expect(parsed.command).toBe(cmd);
    });
  }

  it('recognises recall with full flag set', () => {
    const parsed = parseGlobalArgs([
      'recall',
      '--query',
      'test',
      '--intent',
      'reuse',
      '--format',
      'text',
    ]);
    expect(parsed.command).toBe('recall');
    expect(parsed.global.format).toBe('text');
  });

  it('returns undefined command for unknown command', () => {
    const parsed = parseGlobalArgs(['nonexistent', '--query', 'x']);
    expect(parsed.command).toBeUndefined();
  });

  it('strips the command token from rest', () => {
    const parsed = parseGlobalArgs(['recall', '--query', 'x']);
    expect(parsed.rest).not.toContain('recall');
    expect(parsed.rest).toContain('--query');
    expect(parsed.rest).toContain('x');
  });
});
