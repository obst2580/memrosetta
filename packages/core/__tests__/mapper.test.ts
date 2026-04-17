import { describe, it, expect } from 'vitest';
import { rowToMemory } from '../src/mapper.js';
import type { MemoryRow } from '../src/mapper.js';

function makeRow(overrides: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: 1,
    memory_id: 'mem-abc123',
    user_id: 'user-1',
    namespace: 'project-x',
    memory_type: 'fact',
    content: 'TypeScript is typed JavaScript',
    raw_text: 'I think TypeScript is typed JavaScript',
    document_date: '2025-01-15T10:00:00.000Z',
    learned_at: '2025-01-15T10:05:00.000Z',
    source_id: 'conv-001',
    confidence: 0.9,
    salience: 0.8,
    is_latest: 1,
    keywords: 'typescript javascript typing',
    event_date_start: null,
    event_date_end: null,
    invalidated_at: null,
    ...overrides,
  };
}

describe('rowToMemory', () => {
  it('converts all fields correctly', () => {
    const row = makeRow();
    const memory = rowToMemory(row);

    expect(memory.memoryId).toBe('mem-abc123');
    expect(memory.userId).toBe('user-1');
    expect(memory.namespace).toBe('project-x');
    expect(memory.memoryType).toBe('fact');
    expect(memory.content).toBe('TypeScript is typed JavaScript');
    expect(memory.rawText).toBe('I think TypeScript is typed JavaScript');
    expect(memory.documentDate).toBe('2025-01-15T10:00:00.000Z');
    expect(memory.learnedAt).toBe('2025-01-15T10:05:00.000Z');
    expect(memory.sourceId).toBe('conv-001');
    expect(memory.confidence).toBe(0.9);
    expect(memory.salience).toBe(0.8);
    expect(memory.isLatest).toBe(true);
    expect(memory.keywords).toEqual(['typescript', 'javascript', 'typing']);
  });

  it('converts is_latest=1 to true', () => {
    const row = makeRow({ is_latest: 1 });
    expect(rowToMemory(row).isLatest).toBe(true);
  });

  it('converts is_latest=0 to false', () => {
    const row = makeRow({ is_latest: 0 });
    expect(rowToMemory(row).isLatest).toBe(false);
  });

  it('converts keywords string to array', () => {
    const row = makeRow({ keywords: 'alpha beta gamma' });
    expect(rowToMemory(row).keywords).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('converts null keywords to empty array', () => {
    const row = makeRow({ keywords: null });
    expect(rowToMemory(row).keywords).toEqual([]);
  });

  it('omits namespace when null', () => {
    const row = makeRow({ namespace: null });
    const memory = rowToMemory(row);
    expect(memory).not.toHaveProperty('namespace');
  });

  it('omits rawText when null', () => {
    const row = makeRow({ raw_text: null });
    const memory = rowToMemory(row);
    expect(memory).not.toHaveProperty('rawText');
  });

  it('omits documentDate when null', () => {
    const row = makeRow({ document_date: null });
    const memory = rowToMemory(row);
    expect(memory).not.toHaveProperty('documentDate');
  });

  it('omits sourceId when null', () => {
    const row = makeRow({ source_id: null });
    const memory = rowToMemory(row);
    expect(memory).not.toHaveProperty('sourceId');
  });

  it('converts event_date_start to eventDateStart', () => {
    const row = makeRow({ event_date_start: '2026-04-01T09:00:00Z' });
    expect(rowToMemory(row).eventDateStart).toBe('2026-04-01T09:00:00Z');
  });

  it('omits eventDateStart when null', () => {
    const row = makeRow({ event_date_start: null });
    const memory = rowToMemory(row);
    expect(memory).not.toHaveProperty('eventDateStart');
  });

  it('converts event_date_end to eventDateEnd', () => {
    const row = makeRow({ event_date_end: '2026-04-03T18:00:00Z' });
    expect(rowToMemory(row).eventDateEnd).toBe('2026-04-03T18:00:00Z');
  });

  it('omits eventDateEnd when null', () => {
    const row = makeRow({ event_date_end: null });
    const memory = rowToMemory(row);
    expect(memory).not.toHaveProperty('eventDateEnd');
  });

  it('converts invalidated_at to invalidatedAt', () => {
    const row = makeRow({ invalidated_at: '2026-03-20T12:00:00Z' });
    expect(rowToMemory(row).invalidatedAt).toBe('2026-03-20T12:00:00Z');
  });

  it('omits invalidatedAt when null', () => {
    const row = makeRow({ invalidated_at: null });
    const memory = rowToMemory(row);
    expect(memory).not.toHaveProperty('invalidatedAt');
  });

});

// v0.11: serializeEmbedding suite removed — the function was deleted
// together with the HF embedder integration.
