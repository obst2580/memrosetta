import { describe, it, expect } from 'vitest';
import { generateMemoryId, nowIso, keywordsToString, stringToKeywords } from '../src/utils.js';

describe('generateMemoryId', () => {
  it('starts with "mem-" prefix', () => {
    const id = generateMemoryId();
    expect(id.startsWith('mem-')).toBe(true);
  });

  it('has correct total length (4 prefix + 16 nanoid = 20)', () => {
    const id = generateMemoryId();
    expect(id.length).toBe(20);
  });

  it('generates unique ids', () => {
    const ids = Array.from({ length: 100 }, () => generateMemoryId());
    const unique = new Set(ids);
    expect(unique.size).toBe(100);
  });
});

describe('nowIso', () => {
  it('returns a valid ISO 8601 string', () => {
    const iso = nowIso();
    const parsed = new Date(iso);
    expect(parsed.toISOString()).toBe(iso);
  });
});

describe('keywordsToString', () => {
  it('joins keywords with space', () => {
    expect(keywordsToString(['foo', 'bar', 'baz'])).toBe('foo bar baz');
  });

  it('returns null for empty array', () => {
    expect(keywordsToString([])).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(keywordsToString(undefined)).toBeNull();
  });

  it('handles single keyword', () => {
    expect(keywordsToString(['only'])).toBe('only');
  });
});

describe('stringToKeywords', () => {
  it('splits space-separated string into array', () => {
    expect(stringToKeywords('foo bar baz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('returns empty array for null', () => {
    expect(stringToKeywords(null)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(stringToKeywords('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(stringToKeywords('   ')).toEqual([]);
  });

  it('handles single keyword', () => {
    expect(stringToKeywords('only')).toEqual(['only']);
  });

  it('handles extra spaces between keywords', () => {
    expect(stringToKeywords('foo  bar   baz')).toEqual(['foo', 'bar', 'baz']);
  });
});

describe('keywordsToString / stringToKeywords roundtrip', () => {
  it('roundtrips correctly', () => {
    const original = ['typescript', 'memory', 'engine'];
    const str = keywordsToString(original);
    const result = stringToKeywords(str);
    expect(result).toEqual(original);
  });

  it('roundtrips empty to null to empty', () => {
    const str = keywordsToString([]);
    expect(str).toBeNull();
    const result = stringToKeywords(str);
    expect(result).toEqual([]);
  });
});
