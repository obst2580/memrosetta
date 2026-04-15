import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteMemoryEngine } from '@memrosetta/core';
import { createApp } from '../../src/app.js';

describe('Working memory and quality routes', () => {
  let engine: SqliteMemoryEngine;
  let app: ReturnType<typeof createApp>;
  let memoryId: string;

  beforeAll(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
    app = createApp(engine);

    const stored = await engine.store({
      userId: 'ops-user',
      content: 'Prefers dark mode across editors and terminals',
      memoryType: 'preference',
      salience: 0.9,
    });
    memoryId = stored.memoryId;
  });

  afterAll(async () => {
    await engine.close();
  });

  it('GET /api/working-memory returns memories with aggregate metadata', async () => {
    const res = await app.request('/api/working-memory?userId=ops-user&maxTokens=3000');
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.memories.length).toBeGreaterThan(0);
    expect(data.data.memoryCount).toBe(data.data.memories.length);
    expect(data.data.totalTokens).toBeGreaterThan(0);
  });

  it('GET /api/quality returns quality snapshot for a user', async () => {
    const res = await app.request('/api/quality?userId=ops-user');
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.total).toBeGreaterThan(0);
    expect(data.data.fresh).toBeGreaterThan(0);
    expect(typeof data.data.avgActivation).toBe('number');
  });

  it('POST /api/memories/:memoryId/invalidate invalidates an existing memory', async () => {
    const res = await app.request(`/api/memories/${memoryId}/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Superseded by newer preference' }),
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.invalidated).toBe(true);

    const updated = await engine.getById(memoryId);
    expect(updated?.invalidatedAt).toBeDefined();
  });

  it('POST /api/memories/:memoryId/invalidate returns 404 when the memory is missing', async () => {
    const res = await app.request('/api/memories/missing-memory/invalidate', {
      method: 'POST',
    });
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Memory not found');
  });

  it('POST /api/memories/:memoryId/feedback records utility feedback', async () => {
    const stored = await engine.store({
      userId: 'ops-user',
      content: 'Useful fact for feedback testing',
      memoryType: 'fact',
      salience: 0.4,
    });

    const res = await app.request(`/api/memories/${stored.memoryId}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helpful: true }),
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.feedbackRecorded).toBe(true);
    expect(data.data.helpful).toBe(true);

    const updated = await engine.getById(stored.memoryId);
    expect(updated?.useCount).toBe(1);
    expect(updated?.successCount).toBe(1);
    expect(updated?.salience).toBeGreaterThan(0.4);
  });

  it('POST /api/memories/:memoryId/feedback returns 404 when the memory is missing', async () => {
    const res = await app.request('/api/memories/missing-memory/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ helpful: false }),
    });
    expect(res.status).toBe(404);

    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain('Memory not found');
  });
});

describe('API key auth middleware', () => {
  let engine: SqliteMemoryEngine;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
    app = createApp(engine, { apiKeys: ['test-api-key'] });
  });

  afterAll(async () => {
    await engine.close();
  });

  it('keeps /api/health public when auth is enabled', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
  });

  it('rejects protected routes without an API key', async () => {
    const res = await app.request('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'auth-user',
        content: 'Protected memory',
        memoryType: 'fact',
      }),
    });
    expect(res.status).toBe(401);

    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Unauthorized');
  });

  it('accepts x-api-key authentication', async () => {
    const res = await app.request('/api/memories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test-api-key',
      },
      body: JSON.stringify({
        userId: 'auth-user',
        content: 'Protected memory',
        memoryType: 'fact',
      }),
    });
    expect(res.status).toBe(200);
  });

  it('accepts bearer token authentication', async () => {
    const res = await app.request('/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-api-key',
      },
      body: JSON.stringify({
        userId: 'auth-user',
        query: 'protected',
      }),
    });
    expect(res.status).toBe(200);
  });
});
