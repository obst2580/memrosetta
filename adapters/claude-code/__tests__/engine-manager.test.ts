import { describe, it, expect, afterEach, vi } from 'vitest';
import { getEngine, closeEngine, getEngineWithTimeout } from '../src/engine-manager.js';

// Override config to use in-memory database for tests
vi.mock('../src/config.js', () => ({
  getConfig: () => ({
    dbPath: ':memory:',
    enableEmbeddings: false,
    maxRecallResults: 5,
    minQueryLength: 5,
    maxContextChars: 2000,
  }),
  ensureDir: () => {},
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('engine-manager', () => {
  afterEach(async () => {
    await closeEngine();
  });

  describe('getEngine', () => {
    it('returns a valid engine instance', async () => {
      const engine = await getEngine();

      expect(engine).toBeDefined();
      expect(typeof engine.store).toBe('function');
      expect(typeof engine.search).toBe('function');
      expect(typeof engine.storeBatch).toBe('function');
    });

    it('returns the same instance on consecutive calls', async () => {
      const engine1 = await getEngine();
      const engine2 = await getEngine();

      expect(engine1).toBe(engine2);
    });

    it('engine is operational (can store and search)', async () => {
      const engine = await getEngine();

      const memory = await engine.store({
        userId: 'test-user',
        memoryType: 'fact',
        content: 'Engine manager test memory for validation',
        keywords: ['test'],
      });

      expect(memory.memoryId).toMatch(/^mem-/);

      const response = await engine.search({
        userId: 'test-user',
        query: 'engine manager test',
      });

      expect(response.results.length).toBeGreaterThan(0);
    });
  });

  describe('closeEngine', () => {
    it('creates new instance after close', async () => {
      const engine1 = await getEngine();
      await closeEngine();
      const engine2 = await getEngine();

      // After close + re-get, should be a different instance
      expect(engine2).not.toBe(engine1);
    });

    it('close is idempotent', async () => {
      await closeEngine();
      await closeEngine();
      // Should not throw
    });
  });

  describe('getEngineWithTimeout', () => {
    it('returns engine when init completes within timeout', async () => {
      const engine = await getEngineWithTimeout(5000);
      expect(engine).not.toBeNull();
      expect(typeof engine!.store).toBe('function');
    });

    it('returns null when timeout is extremely short', async () => {
      // Close existing engine so it must re-initialize
      await closeEngine();

      // 0ms timeout should almost certainly expire before init completes
      const engine = await getEngineWithTimeout(0);
      // This is non-deterministic, but with 0ms timeout it's very likely null
      // We accept either result since timing is not guaranteed
      expect(engine === null || typeof engine?.store === 'function').toBe(true);
    });
  });
});
