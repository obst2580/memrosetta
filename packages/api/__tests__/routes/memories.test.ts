import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteMemoryEngine } from '@memrosetta/core';
import { createApp } from '../../src/app.js';

describe('Memory routes', () => {
  let engine: SqliteMemoryEngine;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
    app = createApp(engine);
  });

  afterAll(async () => {
    await engine.close();
  });

  // -------------------------------------------------------------------------
  // POST /api/memories
  // -------------------------------------------------------------------------

  it('POST /api/memories stores a memory', async () => {
    const res = await app.request('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user1',
        content: 'John likes pizza',
        memoryType: 'preference',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.memoryId).toBeTruthy();
    expect(data.data.content).toBe('John likes pizza');
    expect(data.data.memoryType).toBe('preference');
    expect(data.data.userId).toBe('user1');
    expect(data.data.isLatest).toBe(true);
    expect(data.data.learnedAt).toBeTruthy();
  });

  it('POST /api/memories returns 400 for missing required fields', async () => {
    const res = await app.request('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user1',
        // missing content and memoryType
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Validation error');
    expect(data.details).toBeDefined();
  });

  it('POST /api/memories returns 400 for invalid memoryType', async () => {
    const res = await app.request('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user1',
        content: 'some content',
        memoryType: 'invalid_type',
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Validation error');
  });

  it('POST /api/memories stores with all optional fields', async () => {
    const res = await app.request('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user1',
        content: 'Full memory',
        memoryType: 'fact',
        namespace: 'work',
        keywords: ['test', 'full'],
        confidence: 0.95,
        salience: 0.8,
        documentDate: '2025-01-01T00:00:00Z',
        sourceId: 'src-1',
        rawText: 'Original text here',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.namespace).toBe('work');
    expect(data.data.confidence).toBe(0.95);
    expect(data.data.salience).toBe(0.8);
  });

  // -------------------------------------------------------------------------
  // POST /api/memories/batch
  // -------------------------------------------------------------------------

  it('POST /api/memories/batch stores multiple memories', async () => {
    const res = await app.request('/api/memories/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memories: [
          { userId: 'user2', content: 'Fact A', memoryType: 'fact' },
          { userId: 'user2', content: 'Fact B', memoryType: 'fact' },
          { userId: 'user2', content: 'Pref C', memoryType: 'preference' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.count).toBe(3);
    expect(data.data).toHaveLength(3);
  });

  it('POST /api/memories/batch returns 400 for empty array', async () => {
    const res = await app.request('/api/memories/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memories: [] }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // GET /api/memories/:memoryId
  // -------------------------------------------------------------------------

  it('GET /api/memories/:memoryId returns the stored memory', async () => {
    // Store first
    const storeRes = await app.request('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'user3',
        content: 'Retrievable memory',
        memoryType: 'event',
      }),
    });
    const storeData = await storeRes.json();
    const memoryId = storeData.data.memoryId;

    // Retrieve
    const res = await app.request(`/api/memories/${memoryId}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.memoryId).toBe(memoryId);
    expect(data.data.content).toBe('Retrievable memory');
  });

  it('GET /api/memories/:memoryId returns 404 for non-existent memory', async () => {
    const res = await app.request('/api/memories/nonexistent-id-12345');
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Not found');
  });

  // -------------------------------------------------------------------------
  // GET /api/memories/count/:userId
  // -------------------------------------------------------------------------

  it('GET /api/memories/count/:userId returns memory count', async () => {
    // Store a couple
    await app.request('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'count-user',
        content: 'Memory 1',
        memoryType: 'fact',
      }),
    });
    await app.request('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'count-user',
        content: 'Memory 2',
        memoryType: 'fact',
      }),
    });

    const res = await app.request('/api/memories/count/count-user');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.count).toBe(2);
  });

  // -------------------------------------------------------------------------
  // DELETE /api/memories/user/:userId
  // -------------------------------------------------------------------------

  it('DELETE /api/memories/user/:userId clears all user memories', async () => {
    // Store
    await app.request('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'clear-user',
        content: 'To be cleared',
        memoryType: 'fact',
      }),
    });

    // Clear
    const res = await app.request('/api/memories/user/clear-user', {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.cleared).toBe(true);

    // Verify count is 0
    const countRes = await app.request('/api/memories/count/clear-user');
    const countData = await countRes.json();
    expect(countData.data.count).toBe(0);
  });
});
