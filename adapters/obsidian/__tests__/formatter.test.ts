import { describe, it, expect } from 'vitest';
import type { Memory } from '@memrosetta/types';
import {
  memoryToMarkdown,
  markdownToMemoryId,
  extractBody,
  extractMemoryType,
  extractKeywords,
} from '../src/formatter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    memoryId: 'mem-abc123',
    userId: 'user-1',
    content: 'TypeScript is a typed superset of JavaScript',
    memoryType: 'fact',
    learnedAt: '2025-06-01T10:00:00.000Z',
    isLatest: true,
    tier: 'warm',
    activationScore: 0.823,
    accessCount: 3,
    confidence: 0.9,
    salience: 0.7,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// memoryToMarkdown
// ---------------------------------------------------------------------------

describe('memoryToMarkdown', () => {
  it('generates valid YAML frontmatter with required fields', () => {
    const memory = createTestMemory();
    const md = memoryToMarkdown(memory);

    expect(md).toContain('---');
    expect(md).toContain('memory_id: mem-abc123');
    expect(md).toContain('type: fact');
    expect(md).toContain('confidence: 0.9');
    expect(md).toContain('learned_at: 2025-06-01T10:00:00.000Z');
    expect(md).toContain('tier: warm');
    expect(md).toContain('activation: 0.823');
  });

  it('includes content as body after frontmatter', () => {
    const memory = createTestMemory();
    const md = memoryToMarkdown(memory);

    const parts = md.split('---');
    // parts[0] is empty (before first ---), parts[1] is frontmatter, parts[2] is after second ---
    const body = parts[2].trim();
    expect(body).toBe('TypeScript is a typed superset of JavaScript');
  });

  it('includes optional documentDate when present', () => {
    const memory = createTestMemory({ documentDate: '2025-05-15T08:00:00.000Z' });
    const md = memoryToMarkdown(memory);

    expect(md).toContain('document_date: 2025-05-15T08:00:00.000Z');
  });

  it('includes optional eventDateStart and eventDateEnd when present', () => {
    const memory = createTestMemory({
      eventDateStart: '2025-03-01T00:00:00.000Z',
      eventDateEnd: '2025-03-15T00:00:00.000Z',
    });
    const md = memoryToMarkdown(memory);

    expect(md).toContain('event_date_start: 2025-03-01T00:00:00.000Z');
    expect(md).toContain('event_date_end: 2025-03-15T00:00:00.000Z');
  });

  it('includes namespace when present', () => {
    const memory = createTestMemory({ namespace: 'work' });
    const md = memoryToMarkdown(memory);

    expect(md).toContain('namespace: work');
  });

  it('includes keywords when present', () => {
    const memory = createTestMemory({
      keywords: ['typescript', 'programming', 'language'],
    });
    const md = memoryToMarkdown(memory);

    expect(md).toContain('keywords: [typescript, programming, language]');
  });

  it('omits keywords line when keywords array is empty', () => {
    const memory = createTestMemory({ keywords: [] });
    const md = memoryToMarkdown(memory);

    expect(md).not.toContain('keywords:');
  });

  it('omits keywords line when keywords is undefined', () => {
    const memory = createTestMemory({ keywords: undefined });
    const md = memoryToMarkdown(memory);

    expect(md).not.toContain('keywords:');
  });

  it('includes invalidatedAt when present', () => {
    const memory = createTestMemory({
      invalidatedAt: '2025-07-01T00:00:00.000Z',
    });
    const md = memoryToMarkdown(memory);

    expect(md).toContain('invalidated_at: 2025-07-01T00:00:00.000Z');
  });

  it('omits optional fields when not present', () => {
    const memory = createTestMemory();
    const md = memoryToMarkdown(memory);

    expect(md).not.toContain('document_date:');
    expect(md).not.toContain('event_date_start:');
    expect(md).not.toContain('event_date_end:');
    expect(md).not.toContain('namespace:');
    expect(md).not.toContain('invalidated_at:');
  });

  it('uses default confidence 0.5 when confidence is undefined', () => {
    const memory = createTestMemory({ confidence: undefined });
    const md = memoryToMarkdown(memory);

    expect(md).toContain('confidence: 0.5');
  });

  it('formats activation score to 3 decimal places', () => {
    const memory = createTestMemory({ activationScore: 0.1 });
    const md = memoryToMarkdown(memory);

    expect(md).toContain('activation: 0.100');
  });
});

// ---------------------------------------------------------------------------
// markdownToMemoryId
// ---------------------------------------------------------------------------

describe('markdownToMemoryId', () => {
  it('extracts memory_id from valid frontmatter', () => {
    const md = '---\nmemory_id: mem-xyz789\ntype: fact\n---\n\nSome content';
    expect(markdownToMemoryId(md)).toBe('mem-xyz789');
  });

  it('returns null when memory_id is absent', () => {
    const md = '---\ntype: fact\n---\n\nSome content';
    expect(markdownToMemoryId(md)).toBeNull();
  });

  it('returns null for plain markdown without frontmatter', () => {
    const md = '# A heading\n\nSome regular markdown.';
    expect(markdownToMemoryId(md)).toBeNull();
  });

  it('trims whitespace from extracted ID', () => {
    const md = '---\nmemory_id:   mem-spaced   \ntype: fact\n---\n';
    expect(markdownToMemoryId(md)).toBe('mem-spaced');
  });

  it('handles empty string', () => {
    expect(markdownToMemoryId('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractBody
// ---------------------------------------------------------------------------

describe('extractBody', () => {
  it('extracts body content after frontmatter', () => {
    const md = '---\nmemory_id: mem-1\n---\n\nThe body content here';
    expect(extractBody(md)).toBe('The body content here');
  });

  it('handles multiline body', () => {
    const md = '---\nmemory_id: mem-1\n---\n\nLine 1\nLine 2\nLine 3';
    expect(extractBody(md)).toBe('Line 1\nLine 2\nLine 3');
  });

  it('returns empty string when no body exists', () => {
    const md = '---\nmemory_id: mem-1\n---\n';
    expect(extractBody(md)).toBe('');
  });

  it('returns empty string for content without frontmatter', () => {
    const md = 'Just plain text without frontmatter';
    expect(extractBody(md)).toBe('');
  });

  it('trims whitespace from body', () => {
    const md = '---\nmemory_id: mem-1\n---\n\n  spaced content  \n\n';
    expect(extractBody(md)).toBe('spaced content');
  });
});

// ---------------------------------------------------------------------------
// extractMemoryType
// ---------------------------------------------------------------------------

describe('extractMemoryType', () => {
  it('extracts valid memory types', () => {
    expect(extractMemoryType('---\ntype: fact\n---')).toBe('fact');
    expect(extractMemoryType('---\ntype: preference\n---')).toBe('preference');
    expect(extractMemoryType('---\ntype: decision\n---')).toBe('decision');
    expect(extractMemoryType('---\ntype: event\n---')).toBe('event');
  });

  it('defaults to fact for invalid type', () => {
    expect(extractMemoryType('---\ntype: invalid\n---')).toBe('fact');
  });

  it('defaults to fact when type field is missing', () => {
    expect(extractMemoryType('---\nmemory_id: mem-1\n---')).toBe('fact');
  });

  it('defaults to fact for empty content', () => {
    expect(extractMemoryType('')).toBe('fact');
  });
});

// ---------------------------------------------------------------------------
// extractKeywords
// ---------------------------------------------------------------------------

describe('extractKeywords', () => {
  it('extracts keywords from frontmatter', () => {
    const md = '---\nkeywords: [typescript, javascript, programming]\n---';
    expect(extractKeywords(md)).toEqual(['typescript', 'javascript', 'programming']);
  });

  it('returns empty array when keywords field is missing', () => {
    const md = '---\nmemory_id: mem-1\n---';
    expect(extractKeywords(md)).toEqual([]);
  });

  it('handles empty keywords array', () => {
    const md = '---\nkeywords: []\n---';
    expect(extractKeywords(md)).toEqual([]);
  });

  it('trims whitespace from keywords', () => {
    const md = '---\nkeywords: [ spaces , around , words ]\n---';
    expect(extractKeywords(md)).toEqual(['spaces', 'around', 'words']);
  });

  it('returns empty array for empty string', () => {
    expect(extractKeywords('')).toEqual([]);
  });
});
