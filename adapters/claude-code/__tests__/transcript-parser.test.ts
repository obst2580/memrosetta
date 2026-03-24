import { describe, it, expect } from 'vitest';
import { parseTranscriptContent } from '../src/transcript-parser.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonl(...lines: readonly object[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseTranscriptContent', () => {
  it('parses basic user and assistant turns', () => {
    const content = jsonl(
      { cwd: '/home/user/project', sessionId: 'abc12345-full-id' },
      {
        message: {
          role: 'user',
          content: 'How do I set up TypeScript in this project?',
        },
      },
      {
        message: {
          role: 'assistant',
          content: 'You can set up TypeScript by running npm init and then adding tsconfig.json',
        },
      },
    );

    const result = parseTranscriptContent(content);

    expect(result.cwd).toBe('/home/user/project');
    expect(result.sessionId).toBe('abc12345-full-id');
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0].role).toBe('user');
    expect(result.turns[0].content).toContain('TypeScript');
    expect(result.turns[1].role).toBe('assistant');
    expect(result.turns[1].content).toContain('tsconfig.json');
  });

  it('strips system-reminder tags from user messages', () => {
    const content = jsonl({
      message: {
        role: 'user',
        content:
          '<system-reminder>You are Claude Code.</system-reminder>Tell me about databases',
      },
    });

    const result = parseTranscriptContent(content);

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].content).toBe('Tell me about databases');
    expect(result.turns[0].content).not.toContain('system-reminder');
  });

  it('strips multiple system-reminder tags', () => {
    const content = jsonl({
      message: {
        role: 'user',
        content:
          '<system-reminder>A</system-reminder>Hello<system-reminder>B</system-reminder> world',
      },
    });

    const result = parseTranscriptContent(content);

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].content).toBe('Hello world');
  });

  it('extracts text from assistant content blocks', () => {
    const content = jsonl({
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'First paragraph of the response.' },
          { type: 'tool_use', id: 'tool-1' },
          { type: 'text', text: 'Second paragraph after tool call.' },
        ],
      },
    });

    const result = parseTranscriptContent(content);

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].content).toContain('First paragraph');
    expect(result.turns[0].content).toContain('Second paragraph');
    expect(result.turns[0].content).not.toContain('tool_use');
  });

  it('skips short user messages (5 chars or less)', () => {
    const content = jsonl(
      { message: { role: 'user', content: 'yes' } },
      { message: { role: 'user', content: 'no' } },
      { message: { role: 'user', content: 'This is a long enough message to pass the filter' } },
    );

    const result = parseTranscriptContent(content);

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].content).toContain('long enough');
  });

  it('skips short assistant messages (10 chars or less)', () => {
    const content = jsonl(
      { message: { role: 'assistant', content: 'OK' } },
      { message: { role: 'assistant', content: 'Short' } },
      {
        message: {
          role: 'assistant',
          content: 'This is a sufficiently long response to be included',
        },
      },
    );

    const result = parseTranscriptContent(content);

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].content).toContain('sufficiently long');
  });

  it('handles malformed JSONL lines gracefully', () => {
    const content = [
      JSON.stringify({ cwd: '/test', sessionId: 'sess-123' }),
      'NOT VALID JSON {{{',
      '',
      JSON.stringify({
        message: { role: 'user', content: 'Valid message after bad line' },
      }),
    ].join('\n');

    const result = parseTranscriptContent(content);

    expect(result.cwd).toBe('/test');
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].content).toBe('Valid message after bad line');
  });

  it('deduplicates consecutive identical messages', () => {
    const content = jsonl(
      {
        message: {
          role: 'user',
          content: 'Tell me about TypeScript generics',
        },
      },
      {
        message: {
          role: 'user',
          content: 'Tell me about TypeScript generics',
        },
      },
      {
        message: {
          role: 'assistant',
          content: 'TypeScript generics allow you to create reusable components',
        },
      },
      {
        message: {
          role: 'assistant',
          content: 'TypeScript generics allow you to create reusable components',
        },
      },
    );

    const result = parseTranscriptContent(content);

    expect(result.turns).toHaveLength(2);
    expect(result.turns[0].role).toBe('user');
    expect(result.turns[1].role).toBe('assistant');
  });

  it('extracts cwd and sessionId from first entries', () => {
    const content = jsonl(
      { cwd: '/Users/test/project' },
      { sessionId: 'session-001' },
      { cwd: '/should/be/ignored', sessionId: 'also-ignored' },
      { message: { role: 'user', content: 'Some valid content for testing' } },
    );

    const result = parseTranscriptContent(content);

    expect(result.cwd).toBe('/Users/test/project');
    expect(result.sessionId).toBe('session-001');
  });

  it('returns empty turns for empty input', () => {
    const result = parseTranscriptContent('');

    expect(result.turns).toHaveLength(0);
    expect(result.cwd).toBe('');
    expect(result.sessionId).toBe('');
  });

  it('handles entries without message field', () => {
    const content = jsonl(
      { cwd: '/test' },
      { type: 'metadata', version: 1 },
      { message: { role: 'user', content: 'Actual user message for testing' } },
    );

    const result = parseTranscriptContent(content);

    expect(result.turns).toHaveLength(1);
  });

  it('skips messages with no role', () => {
    const content = jsonl(
      { message: { content: 'No role specified in this message' } },
      { message: { role: 'user', content: 'This has a proper role field' } },
    );

    const result = parseTranscriptContent(content);

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].content).toBe('This has a proper role field');
  });
});
