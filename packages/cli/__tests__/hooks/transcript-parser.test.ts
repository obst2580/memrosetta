import { describe, it, expect } from 'vitest';
import {
  parseTranscriptContent,
  stripSystemReminders,
} from '../../src/hooks/transcript-parser.js';

describe('transcript-parser', () => {
  describe('parseTranscriptContent', () => {
    it('should parse valid JSONL and extract turns', () => {
      const jsonl = [
        JSON.stringify({
          cwd: '/home/user/project',
          sessionId: 'abc-123-def',
          message: { role: 'user', content: 'Hello, please help me with this task' },
        }),
        JSON.stringify({
          message: {
            role: 'assistant',
            content: 'Sure, I can help you with that task right away.',
          },
        }),
      ].join('\n');

      const result = parseTranscriptContent(jsonl);

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].role).toBe('user');
      expect(result.turns[0].content).toBe(
        'Hello, please help me with this task',
      );
      expect(result.turns[1].role).toBe('assistant');
      expect(result.turns[1].content).toBe(
        'Sure, I can help you with that task right away.',
      );
    });

    it('should extract cwd and sessionId from the first occurrence', () => {
      const jsonl = [
        JSON.stringify({
          cwd: '/home/user/project',
          sessionId: 'session-abc-123',
          message: { role: 'user', content: 'This is a test message for parsing' },
        }),
        JSON.stringify({
          cwd: '/home/user/other',
          sessionId: 'session-xyz-456',
          message: { role: 'user', content: 'This is a second test message here' },
        }),
      ].join('\n');

      const result = parseTranscriptContent(jsonl);

      expect(result.cwd).toBe('/home/user/project');
      expect(result.sessionId).toBe('session-abc-123');
    });

    it('should skip empty and malformed lines', () => {
      const jsonl = [
        '',
        'not valid json at all',
        '   ',
        JSON.stringify({
          message: { role: 'user', content: 'This is a valid line in the transcript' },
        }),
        '{incomplete json',
      ].join('\n');

      const result = parseTranscriptContent(jsonl);

      expect(result.turns).toHaveLength(1);
      expect(result.turns[0].content).toBe(
        'This is a valid line in the transcript',
      );
    });

    it('should strip system-reminder tags from user messages', () => {
      const jsonl = JSON.stringify({
        message: {
          role: 'user',
          content:
            'Hello world <system-reminder>secret stuff</system-reminder> goodbye world here',
        },
      });

      const result = parseTranscriptContent(jsonl);

      expect(result.turns).toHaveLength(1);
      expect(result.turns[0].content).toBe('Hello world  goodbye world here');
    });

    it('should deduplicate consecutive messages with same content', () => {
      const jsonl = [
        JSON.stringify({
          message: { role: 'user', content: 'Duplicate message that appears twice' },
        }),
        JSON.stringify({
          message: { role: 'user', content: 'Duplicate message that appears twice' },
        }),
        JSON.stringify({
          message: {
            role: 'assistant',
            content: 'A unique response from the assistant here',
          },
        }),
      ].join('\n');

      const result = parseTranscriptContent(jsonl);

      expect(result.turns).toHaveLength(2);
      expect(result.turns[0].role).toBe('user');
      expect(result.turns[1].role).toBe('assistant');
    });

    it('should handle assistant content blocks (array format)', () => {
      const jsonl = JSON.stringify({
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'First block of text from assistant' },
            { type: 'text', text: 'Second block of text from assistant' },
          ],
        },
      });

      const result = parseTranscriptContent(jsonl);

      expect(result.turns).toHaveLength(1);
      expect(result.turns[0].content).toBe(
        'First block of text from assistant\nSecond block of text from assistant',
      );
    });

    it('should skip very short user messages (<=5 chars)', () => {
      const jsonl = [
        JSON.stringify({ message: { role: 'user', content: 'yes' } }),
        JSON.stringify({ message: { role: 'user', content: 'ok' } }),
        JSON.stringify({
          message: {
            role: 'user',
            content: 'Please implement this feature for me',
          },
        }),
      ].join('\n');

      const result = parseTranscriptContent(jsonl);

      expect(result.turns).toHaveLength(1);
      expect(result.turns[0].content).toBe(
        'Please implement this feature for me',
      );
    });

    it('should skip short assistant messages (<=10 chars)', () => {
      const jsonl = [
        JSON.stringify({ message: { role: 'assistant', content: 'Done.' } }),
        JSON.stringify({
          message: {
            role: 'assistant',
            content: 'Here is a longer response from the assistant',
          },
        }),
      ].join('\n');

      const result = parseTranscriptContent(jsonl);

      expect(result.turns).toHaveLength(1);
      expect(result.turns[0].content).toBe(
        'Here is a longer response from the assistant',
      );
    });

    it('should skip entries with no message or no role', () => {
      const jsonl = [
        JSON.stringify({ cwd: '/home', sessionId: 'sess-1' }),
        JSON.stringify({ message: { content: 'no role field set' } }),
        JSON.stringify({
          message: { role: 'user', content: 'This message has a proper role field' },
        }),
      ].join('\n');

      const result = parseTranscriptContent(jsonl);

      expect(result.turns).toHaveLength(1);
    });

    it('should return empty cwd and sessionId when not present', () => {
      const jsonl = JSON.stringify({
        message: { role: 'user', content: 'Message without metadata at all' },
      });

      const result = parseTranscriptContent(jsonl);

      expect(result.cwd).toBe('');
      expect(result.sessionId).toBe('');
    });
  });

  describe('stripSystemReminders', () => {
    it('should remove system-reminder tags and content', () => {
      const text =
        'before <system-reminder>hidden content</system-reminder> after';
      expect(stripSystemReminders(text)).toBe('before  after');
    });

    it('should handle multiple system-reminder blocks', () => {
      const text =
        'a <system-reminder>r1</system-reminder> b <system-reminder>r2</system-reminder> c';
      expect(stripSystemReminders(text)).toBe('a  b  c');
    });

    it('should return original text when no reminders present', () => {
      const text = 'just plain text without tags';
      expect(stripSystemReminders(text)).toBe(
        'just plain text without tags',
      );
    });

    it('should trim the result', () => {
      const text = '  <system-reminder>all</system-reminder>  ';
      expect(stripSystemReminders(text)).toBe('');
    });
  });
});
