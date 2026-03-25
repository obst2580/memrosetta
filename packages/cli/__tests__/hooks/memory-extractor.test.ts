import { describe, it, expect, vi } from 'vitest';
import {
  extractMemories,
  classifyTurn,
  extractKeywords,
  resolveUserId,
} from '../../src/hooks/memory-extractor.js';
import type { TranscriptData, ConversationTurn } from '../../src/hooks/transcript-parser.js';

describe('memory-extractor', () => {
  describe('extractMemories', () => {
    it('should extract correct number of memories from turns', () => {
      const data: TranscriptData = {
        turns: [
          {
            role: 'user',
            content:
              'I decided to use TypeScript for this project because it offers better safety',
          },
          {
            role: 'assistant',
            content:
              'TypeScript is a great choice for large projects that need type safety and maintainability.',
          },
        ],
        cwd: '/home/user/project',
        sessionId: 'abcdefgh-1234',
      };

      const memories = extractMemories(data, 'testuser');

      expect(memories.length).toBe(2);
      expect(memories[0].userId).toBe('testuser');
      expect(memories[1].userId).toBe('testuser');
    });

    it('should skip short turns that are not worth storing', () => {
      const data: TranscriptData = {
        turns: [
          { role: 'user', content: 'yes' },
          { role: 'user', content: 'ok sure' },
          {
            role: 'user',
            content:
              'I prefer using SQLite for development because it requires no separate server process',
          },
        ],
        cwd: '/home/user/project',
        sessionId: 'abcdefgh-1234',
      };

      const memories = extractMemories(data, 'testuser');

      expect(memories.length).toBe(1);
      expect(memories[0].content).toContain('SQLite');
    });

    it('should extract first sentence, not full turn content', () => {
      const data: TranscriptData = {
        turns: [
          {
            role: 'assistant',
            content:
              'The implementation uses a hybrid search strategy combining BM25 and vector similarity.\n\nHere are the details:\n- BM25 for keyword matching\n- Vector similarity for semantic matching\n- Reciprocal Rank Fusion for combining results',
          },
        ],
        cwd: '/home/user/project',
        sessionId: 'abcdefgh-1234',
      };

      const memories = extractMemories(data, 'testuser');

      expect(memories.length).toBe(1);
      expect(memories[0].content).toBe(
        'The implementation uses a hybrid search strategy combining BM25 and vector similarity.',
      );
    });

    it('should deduplicate identical content', () => {
      const data: TranscriptData = {
        turns: [
          {
            role: 'user',
            content:
              'I prefer immutable patterns in all my TypeScript code for better safety',
          },
          {
            role: 'user',
            content:
              'I prefer immutable patterns in all my TypeScript code for better safety',
          },
          {
            role: 'user',
            content:
              'I prefer immutable patterns in all my TypeScript code for better safety',
          },
        ],
        cwd: '/home/user/project',
        sessionId: 'abcdefgh-1234',
      };

      const memories = extractMemories(data, 'testuser');

      expect(memories.length).toBe(1);
    });

    it('should set namespace from sessionId', () => {
      const data: TranscriptData = {
        turns: [
          {
            role: 'user',
            content:
              'Working on the MemRosetta project today with new features to implement',
          },
        ],
        cwd: '/home/user/project',
        sessionId: 'abcd1234-5678-9abc',
      };

      const memories = extractMemories(data, 'testuser');

      expect(memories[0].namespace).toBe('session-abcd1234');
    });

    it('should return empty array for empty turns', () => {
      const data: TranscriptData = {
        turns: [],
        cwd: '/home/user/project',
        sessionId: 'abcdefgh-1234',
      };

      const memories = extractMemories(data, 'testuser');

      expect(memories).toHaveLength(0);
    });
  });

  describe('classifyTurn', () => {
    it('should classify decision turns', () => {
      const turn: ConversationTurn = {
        role: 'user',
        content: "Let's go with TypeScript for this project",
      };
      expect(classifyTurn(turn)).toBe('decision');
    });

    it('should classify preference turns', () => {
      const turn: ConversationTurn = {
        role: 'user',
        content: 'I prefer functional programming style',
      };
      expect(classifyTurn(turn)).toBe('preference');
    });

    it('should classify user turns as event by default', () => {
      const turn: ConversationTurn = {
        role: 'user',
        content: 'Started the server on port 3000',
      };
      expect(classifyTurn(turn)).toBe('event');
    });

    it('should classify assistant turns as fact', () => {
      const turn: ConversationTurn = {
        role: 'assistant',
        content: 'The function returns a promise that resolves to an array',
      };
      expect(classifyTurn(turn)).toBe('fact');
    });
  });

  describe('extractKeywords', () => {
    it('should extract matching keywords from text', () => {
      const keywords = extractKeywords(
        'Using TypeScript with SQLite for the database layer',
      );
      expect(keywords).toContain('TypeScript');
      expect(keywords).toContain('SQLite');
      expect(keywords).toContain('database');
    });

    it('should return empty array when no keywords match', () => {
      const keywords = extractKeywords('just a plain sentence');
      expect(keywords).toHaveLength(0);
    });

    it('should be case-insensitive', () => {
      const keywords = extractKeywords('TYPESCRIPT and REACT are great');
      expect(keywords).toContain('TypeScript');
      expect(keywords).toContain('React');
    });

    it('should not produce duplicates', () => {
      const keywords = extractKeywords(
        'typescript TypeScript TYPESCRIPT everywhere',
      );
      const tsCount = keywords.filter((k) => k === 'TypeScript').length;
      expect(tsCount).toBe(1);
    });
  });

  describe('resolveUserId', () => {
    it('should return the system username', () => {
      const userId = resolveUserId('/home/user/project');
      expect(typeof userId).toBe('string');
      expect(userId.length).toBeGreaterThan(0);
    });
  });
});
