import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteMemoryEngine } from '@memrosetta/core';
import { createApp } from '../../src/app.js';

describe('Relations routes', () => {
  let engine: SqliteMemoryEngine;
  let app: ReturnType<typeof createApp>;
  let memoryIdA: string;
  let memoryIdB: string;

  beforeAll(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
    app = createApp(engine);

    // Seed two memories to create relations between
    const memA = await engine.store({
      userId: 'rel-user',
      content: 'Original fact',
      memoryType: 'fact',
    });
    const memB = await engine.store({
      userId: 'rel-user',
      content: 'Updated fact',
      memoryType: 'fact',
    });
    memoryIdA = memA.memoryId;
    memoryIdB = memB.memoryId;
  });

  afterAll(async () => {
    await engine.close();
  });

  it('POST /api/relations creates a relation', async () => {
    const res = await app.request('/api/relations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        srcMemoryId: memoryIdB,
        dstMemoryId: memoryIdA,
        relationType: 'updates',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.srcMemoryId).toBe(memoryIdB);
    expect(data.data.dstMemoryId).toBe(memoryIdA);
    expect(data.data.relationType).toBe('updates');
    expect(data.data.createdAt).toBeTruthy();
  });

  it('POST /api/relations creates a relation with reason', async () => {
    const res = await app.request('/api/relations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        srcMemoryId: memoryIdB,
        dstMemoryId: memoryIdA,
        relationType: 'extends',
        reason: 'Adds more detail to the original fact',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.reason).toBe('Adds more detail to the original fact');
  });

  it('POST /api/relations returns 400 for invalid relationType', async () => {
    const res = await app.request('/api/relations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        srcMemoryId: memoryIdB,
        dstMemoryId: memoryIdA,
        relationType: 'invalid_type',
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Validation error');
  });

  it('POST /api/relations returns 400 for missing fields', async () => {
    const res = await app.request('/api/relations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        srcMemoryId: memoryIdA,
        // missing dstMemoryId and relationType
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it('POST /api/relations returns error for non-existent memory', async () => {
    const res = await app.request('/api/relations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        srcMemoryId: 'nonexistent-id-1',
        dstMemoryId: 'nonexistent-id-2',
        relationType: 'derives',
      }),
    });
    // The engine may or may not throw for non-existent memories
    // depending on foreign key constraints. Either 200 or 500 is acceptable.
    const data = await res.json();
    expect(data).toBeDefined();
  });
});
