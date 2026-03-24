import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteMemoryEngine } from '@memrosetta/core';
import { createApp } from '../../src/app.js';

describe('Search routes', () => {
  let engine: SqliteMemoryEngine;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
    app = createApp(engine);

    // Seed test data
    const memories = [
      {
        userId: 'search-user',
        content: 'TypeScript is a typed superset of JavaScript',
        memoryType: 'fact' as const,
        keywords: ['typescript', 'javascript'],
        confidence: 0.9,
      },
      {
        userId: 'search-user',
        content: 'Python is great for data science',
        memoryType: 'fact' as const,
        keywords: ['python', 'data-science'],
        confidence: 0.85,
      },
      {
        userId: 'search-user',
        content: 'I prefer dark mode in editors',
        memoryType: 'preference' as const,
        keywords: ['editor', 'dark-mode'],
        confidence: 0.95,
      },
      {
        userId: 'other-user',
        content: 'This belongs to another user',
        memoryType: 'fact' as const,
      },
    ];

    for (const m of memories) {
      await engine.store(m);
    }
  });

  afterAll(async () => {
    await engine.close();
  });

  it('POST /api/search returns matching results', async () => {
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'search-user',
        query: 'typescript',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.results.length).toBeGreaterThan(0);
    expect(data.data.totalCount).toBeGreaterThan(0);
    expect(typeof data.data.queryTimeMs).toBe('number');
  });

  it('POST /api/search with filters narrows results', async () => {
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'search-user',
        query: 'typescript python',
        filters: {
          memoryTypes: ['preference'],
        },
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    // Only preference type should match the filter
    for (const result of data.data.results) {
      expect(result.memory.memoryType).toBe('preference');
    }
  });

  it('POST /api/search with limit constrains results', async () => {
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'search-user',
        query: 'typescript python data',
        limit: 1,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.results.length).toBeLessThanOrEqual(1);
  });

  it('POST /api/search returns 400 for empty query', async () => {
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'search-user',
        query: '',
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Validation error');
  });

  it('POST /api/search returns 400 for missing userId', async () => {
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'something',
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
  });
});
