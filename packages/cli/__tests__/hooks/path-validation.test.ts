import { describe, it, expect } from 'vitest';
import {
  isValidTranscriptPath,
  sanitizeSessionId,
} from '../../src/hooks/path-validation.js';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

describe('path-validation', () => {
  describe('isValidTranscriptPath', () => {
    const claudeDir = resolve(homedir(), '.claude');

    it('should accept a valid path inside ~/.claude ending with .jsonl', () => {
      const validPath = resolve(
        claudeDir,
        'projects',
        'session-abc123.jsonl',
      );
      expect(isValidTranscriptPath(validPath)).toBe(true);
    });

    it('should accept nested paths inside ~/.claude', () => {
      const nestedPath = resolve(
        claudeDir,
        'projects',
        'myproject',
        'deep',
        'session.jsonl',
      );
      expect(isValidTranscriptPath(nestedPath)).toBe(true);
    });

    it('should reject paths outside ~/.claude', () => {
      expect(isValidTranscriptPath('/tmp/evil.jsonl')).toBe(false);
      expect(isValidTranscriptPath('/etc/passwd.jsonl')).toBe(false);
      expect(
        isValidTranscriptPath(resolve(homedir(), 'Documents', 'file.jsonl')),
      ).toBe(false);
    });

    it('should reject paths that do not end with .jsonl', () => {
      const txtPath = resolve(claudeDir, 'projects', 'session.txt');
      expect(isValidTranscriptPath(txtPath)).toBe(false);

      const jsonPath = resolve(claudeDir, 'projects', 'session.json');
      expect(isValidTranscriptPath(jsonPath)).toBe(false);

      const noExtPath = resolve(claudeDir, 'projects', 'session');
      expect(isValidTranscriptPath(noExtPath)).toBe(false);
    });

    it('should reject path traversal attempts', () => {
      const traversal = resolve(
        claudeDir,
        '..',
        '..',
        'etc',
        'passwd.jsonl',
      );
      expect(isValidTranscriptPath(traversal)).toBe(false);
    });
  });

  describe('sanitizeSessionId', () => {
    it('should keep alphanumeric characters and hyphens', () => {
      expect(sanitizeSessionId('abc-123-def')).toBe('abc-123-def');
    });

    it('should keep underscores', () => {
      expect(sanitizeSessionId('session_abc_123')).toBe('session_abc_123');
    });

    it('should remove special characters', () => {
      expect(sanitizeSessionId('abc!@#$%^&*()def')).toBe('abcdef');
    });

    it('should remove spaces', () => {
      expect(sanitizeSessionId('abc def ghi')).toBe('abcdefghi');
    });

    it('should remove path traversal characters', () => {
      expect(sanitizeSessionId('../../../etc/passwd')).toBe('etcpasswd');
    });

    it('should handle empty string', () => {
      expect(sanitizeSessionId('')).toBe('');
    });

    it('should handle UUID-like session IDs', () => {
      const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      expect(sanitizeSessionId(uuid)).toBe(uuid);
    });
  });
});
