import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteMemoryEngine } from '@memrosetta/core';
import { createApp } from '../../src/app.js';

describe('Health route', () => {
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

  it('GET /api/health returns ok and version', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.version).toBeDefined();
  });
});
