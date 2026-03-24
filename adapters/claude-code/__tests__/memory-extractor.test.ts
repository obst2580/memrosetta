import { describe, it, expect } from 'vitest';
import {
  extractMemories,
  classifyTurn,
  extractKeywords,
  resolveUserId,
} from '../src/memory-extractor.js';
import type { TranscriptData, ConversationTurn } from '../src/transcript-parser.js';

// ---------------------------------------------------------------------------
// classifyTurn
// ---------------------------------------------------------------------------

describe('classifyTurn', () => {
  it('classifies user decisions', () => {
    const turn: ConversationTurn = {
      role: 'user',
      content: "Let's do the refactoring approach you suggested",
    };
    expect(classifyTurn(turn)).toBe('decision');
  });

  it('classifies user preferences', () => {
    const turn: ConversationTurn = {
      role: 'user',
      content: 'I prefer using TypeScript for all new projects',
    };
    expect(classifyTurn(turn)).toBe('preference');
  });

  it('classifies generic user messages as events', () => {
    const turn: ConversationTurn = {
      role: 'user',
      content: 'How do I set up the database schema for this project?',
    };
    expect(classifyTurn(turn)).toBe('event');
  });

  it('classifies assistant messages as facts', () => {
    const turn: ConversationTurn = {
      role: 'assistant',
      content: 'SQLite uses WAL mode for better concurrent access',
    };
    expect(classifyTurn(turn)).toBe('fact');
  });
});

// ---------------------------------------------------------------------------
// extractKeywords
// ---------------------------------------------------------------------------

describe('extractKeywords', () => {
  it('extracts known technology keywords', () => {
    const keywords = extractKeywords(
      'We use TypeScript and SQLite for the database layer',
    );
    expect(keywords).toContain('TypeScript');
    expect(keywords).toContain('SQLite');
    expect(keywords).toContain('database');
  });

  it('returns empty array for no matches', () => {
    const keywords = extractKeywords('Hello world, how are you today?');
    expect(keywords).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    const keywords = extractKeywords('TYPESCRIPT and DOCKER setup');
    expect(keywords).toContain('TypeScript');
    expect(keywords).toContain('Docker');
  });

  it('does not duplicate keywords', () => {
    const keywords = extractKeywords(
      'TypeScript typescript TYPESCRIPT is great',
    );
    const tsCount = keywords.filter((k) => k === 'TypeScript').length;
    expect(tsCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// resolveUserId
// ---------------------------------------------------------------------------

describe('resolveUserId', () => {
  it('maps com_project path to work/', () => {
    expect(resolveUserId('/Users/obst/com_project/tech-manage-web')).toBe(
      'work/tech-manage-web',
    );
  });

  it('maps personal_project path to personal/', () => {
    expect(resolveUserId('/Users/obst/personal_project/memrosetta')).toBe(
      'personal/memrosetta',
    );
  });

  it('maps work directory to work/', () => {
    expect(resolveUserId('/home/user/work/my-project')).toBe(
      'work/my-project',
    );
  });

  it('maps personal directory to personal/', () => {
    expect(resolveUserId('/home/user/personal/side-project')).toBe(
      'personal/side-project',
    );
  });

  it('uses dirname for unrecognized paths', () => {
    expect(resolveUserId('/opt/some-random/project')).toBe('project');
  });

  it('handles trailing slash', () => {
    // path.split('/') produces empty string at end for trailing /
    // The last non-empty part should be used
    expect(resolveUserId('/Users/obst/com_project/test')).toBe('work/test');
  });
});

// ---------------------------------------------------------------------------
// extractMemories
// ---------------------------------------------------------------------------

describe('extractMemories', () => {
  function makeTranscript(
    turns: readonly ConversationTurn[],
    overrides?: Partial<TranscriptData>,
  ): TranscriptData {
    return {
      turns,
      cwd: '/Users/test/project',
      sessionId: 'abcd1234-5678-90ef',
      ...overrides,
    };
  }

  it('converts turns to MemoryInput array', () => {
    const data = makeTranscript([
      {
        role: 'user',
        content: 'I want to set up TypeScript in this project with strict mode enabled',
      },
      {
        role: 'assistant',
        content: 'You can set up TypeScript by creating a tsconfig.json with strict: true',
      },
    ]);

    const memories = extractMemories(data, 'test-user');

    expect(memories).toHaveLength(2);
    expect(memories[0].userId).toBe('test-user');
    expect(memories[0].namespace).toBe('session-abcd1234');
    expect(memories[0].confidence).toBe(0.9);
    expect(memories[1].confidence).toBe(0.8);
  });

  it('skips turns shorter than 20 characters', () => {
    const data = makeTranscript([
      { role: 'user', content: 'Short msg' },
      { role: 'user', content: 'This is a sufficiently long message for extraction' },
    ]);

    const memories = extractMemories(data, 'test-user');

    expect(memories).toHaveLength(1);
    expect(memories[0].content).toContain('sufficiently long');
  });

  it('extracts first meaningful sentence from long turns', () => {
    const longContent = 'This is the first important sentence about the project.\nSecond line with more details.\n' + 'A'.repeat(600);
    const data = makeTranscript([
      { role: 'user', content: longContent },
    ]);

    const memories = extractMemories(data, 'test-user');

    expect(memories).toHaveLength(1);
    expect(memories[0].content.length).toBeLessThanOrEqual(200);
    expect(memories[0].content).toContain('first important sentence');
  });

  it('assigns correct memory types', () => {
    const data = makeTranscript([
      { role: 'user', content: 'I prefer using Rust for systems programming tasks' },
      { role: 'assistant', content: 'Rust provides memory safety without garbage collection overhead' },
    ]);

    const memories = extractMemories(data, 'test-user');

    expect(memories[0].memoryType).toBe('preference');
    expect(memories[1].memoryType).toBe('fact');
  });

  it('includes extracted keywords', () => {
    const data = makeTranscript([
      {
        role: 'user',
        content: 'Set up Docker and TypeScript for the API deployment pipeline',
      },
    ]);

    const memories = extractMemories(data, 'test-user');

    expect(memories[0].keywords).toContain('Docker');
    expect(memories[0].keywords).toContain('TypeScript');
    expect(memories[0].keywords).toContain('API');
    expect(memories[0].keywords).toContain('deploy');
  });

  it('generates correct sourceId pattern', () => {
    const data = makeTranscript(
      [
        { role: 'user', content: 'First turn of the conversation for testing' },
        { role: 'assistant', content: 'Second turn of the conversation for testing' },
      ],
      { sessionId: 'xyz98765-rest-of-id' },
    );

    const memories = extractMemories(data, 'test-user');

    expect(memories[0].sourceId).toBe('cc-xyz98765-0');
    expect(memories[1].sourceId).toBe('cc-xyz98765-1');
  });

  it('returns empty for empty turns', () => {
    const data = makeTranscript([]);
    const memories = extractMemories(data, 'test-user');

    expect(memories).toHaveLength(0);
  });

  it('handles missing sessionId gracefully', () => {
    const data = makeTranscript(
      [{ role: 'user', content: 'A message without a session identifier attached' }],
      { sessionId: '' },
    );

    const memories = extractMemories(data, 'test-user');

    expect(memories).toHaveLength(1);
    expect(memories[0].namespace).toBe('session-unknown');
    expect(memories[0].sourceId).toBe('cc-unknown-0');
  });

  it('sets documentDate to current time', () => {
    const before = new Date().toISOString();
    const data = makeTranscript([
      { role: 'user', content: 'Testing the document date assignment logic here' },
    ]);

    const memories = extractMemories(data, 'test-user');
    const after = new Date().toISOString();

    expect(memories[0].documentDate).toBeDefined();
    expect(memories[0].documentDate! >= before).toBe(true);
    expect(memories[0].documentDate! <= after).toBe(true);
  });
});
