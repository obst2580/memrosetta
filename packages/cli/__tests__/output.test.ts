import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { output, outputError } from '../src/output.js';

describe('output', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('json format', () => {
    it('should output JSON string for an object', () => {
      output({ key: 'value' }, 'json');
      expect(stdoutWrite).toHaveBeenCalledWith('{"key":"value"}\n');
    });

    it('should output JSON for search response', () => {
      const data = {
        results: [
          {
            memory: {
              memoryId: 'mem-1',
              content: 'test content',
              memoryType: 'fact',
              learnedAt: '2026-03-24T00:00:00.000Z',
            },
            score: 0.85,
            matchType: 'fts',
          },
        ],
        totalCount: 1,
        queryTimeMs: 4.2,
      };
      output(data, 'json');
      expect(stdoutWrite).toHaveBeenCalledWith(JSON.stringify(data) + '\n');
    });

    it('should output JSON for count', () => {
      output({ userId: 'obst', count: 42 }, 'json');
      expect(stdoutWrite).toHaveBeenCalledWith(
        '{"userId":"obst","count":42}\n',
      );
    });
  });

  describe('text format', () => {
    it('should format search response as text', () => {
      const data = {
        results: [
          {
            memory: {
              memoryId: 'mem-1',
              content: 'favorite food is pizza',
              memoryType: 'preference',
              learnedAt: '2026-03-24T00:00:00.000Z',
            },
            score: 0.85,
            matchType: 'fts',
          },
        ],
        totalCount: 1,
        queryTimeMs: 4.2,
      };
      output(data, 'text');
      expect(stdoutWrite).toHaveBeenCalledWith(
        '[0.85] favorite food is pizza (preference, 2026-03-24)\n',
      );
    });

    it('should handle empty search results', () => {
      output({ results: [], totalCount: 0, queryTimeMs: 1.0 }, 'text');
      expect(stdoutWrite).toHaveBeenCalledWith('No results found.\n');
    });

    it('should format memory as text', () => {
      output(
        {
          memoryId: 'mem-abc',
          content: 'test memory',
          memoryType: 'fact',
          learnedAt: '2026-03-24T12:00:00.000Z',
          namespace: 'work',
          keywords: ['TypeScript', 'test'],
        },
        'text',
      );
      expect(stdoutWrite).toHaveBeenCalledWith('ID: mem-abc\n');
      expect(stdoutWrite).toHaveBeenCalledWith('Content: test memory\n');
      expect(stdoutWrite).toHaveBeenCalledWith('Type: fact\n');
      expect(stdoutWrite).toHaveBeenCalledWith('Date: 2026-03-24\n');
      expect(stdoutWrite).toHaveBeenCalledWith('Namespace: work\n');
      expect(stdoutWrite).toHaveBeenCalledWith(
        'Keywords: TypeScript, test\n',
      );
    });

    it('should format count as text', () => {
      output({ count: 42 }, 'text');
      expect(stdoutWrite).toHaveBeenCalledWith('Count: 42\n');
    });

    it('should format string as text', () => {
      output('hello world', 'text');
      expect(stdoutWrite).toHaveBeenCalledWith('hello world\n');
    });
  });
});

describe('outputError', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should output JSON error', () => {
    outputError('something went wrong', 'json');
    expect(stdoutWrite).toHaveBeenCalledWith(
      '{"error":"something went wrong"}\n',
    );
  });

  it('should output text error to stderr', () => {
    outputError('something went wrong', 'text');
    expect(stderrWrite).toHaveBeenCalledWith(
      'Error: something went wrong\n',
    );
  });
});
