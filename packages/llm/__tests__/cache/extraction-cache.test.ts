import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFile, mkdir } from 'node:fs/promises';
import { ExtractionCache } from '../../src/cache/extraction-cache.js';
import type { ExtractedFact } from '../../src/extraction/fact-extractor-types.js';

describe('ExtractionCache', () => {
  let tempDir: string;
  let cache: ExtractionCache;

  const sampleFacts: readonly ExtractedFact[] = [
    {
      content: 'Alice likes hiking',
      memoryType: 'preference',
      confidence: 0.9,
      keywords: ['hiking', 'Alice'],
    },
    {
      content: 'Alice visited the park',
      memoryType: 'event',
      confidence: 0.85,
    },
  ];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'memrosetta-cache-test-'));
    cache = new ExtractionCache(tempDir, 'v1');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('set() and get()', () => {
    it('should store and retrieve facts by key', async () => {
      await cache.set('key1', sampleFacts);
      const result = await cache.get('key1');

      expect(result).toEqual(sampleFacts);
    });

    it('should return null for nonexistent key', async () => {
      const result = await cache.get('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle multiple keys', async () => {
      const facts2: readonly ExtractedFact[] = [
        { content: 'Bob drives a truck', memoryType: 'fact', confidence: 0.8 },
      ];

      await cache.set('key1', sampleFacts);
      await cache.set('key2', facts2);

      expect(await cache.get('key1')).toEqual(sampleFacts);
      expect(await cache.get('key2')).toEqual(facts2);
    });

    it('should overwrite existing key', async () => {
      const newFacts: readonly ExtractedFact[] = [
        { content: 'Updated fact', memoryType: 'fact', confidence: 0.7 },
      ];

      await cache.set('key1', sampleFacts);
      await cache.set('key1', newFacts);

      expect(await cache.get('key1')).toEqual(newFacts);
    });
  });

  describe('has()', () => {
    it('should return true for existing key', async () => {
      await cache.set('key1', sampleFacts);
      expect(await cache.has('key1')).toBe(true);
    });

    it('should return false for nonexistent key', async () => {
      expect(await cache.has('nonexistent')).toBe(false);
    });
  });

  describe('stats tracking', () => {
    it('should track hits and misses', async () => {
      await cache.set('key1', sampleFacts);

      await cache.get('key1'); // hit
      await cache.get('key1'); // hit
      await cache.get('missing'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.total).toBe(1);
    });

    it('should start with zero stats', async () => {
      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.total).toBe(0);
    });
  });

  describe('clear()', () => {
    it('should remove all entries', async () => {
      await cache.set('key1', sampleFacts);
      await cache.set('key2', sampleFacts);

      await cache.clear();

      expect(await cache.get('key1')).toBeNull();
      expect(await cache.get('key2')).toBeNull();
      expect(cache.getStats().total).toBe(0);
    });

    it('should reset stats', async () => {
      await cache.set('key1', sampleFacts);
      await cache.get('key1'); // hit

      await cache.clear();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('persistence', () => {
    it('should persist entries across instances', async () => {
      await cache.set('key1', sampleFacts);

      // Create new cache instance pointing to same directory
      const cache2 = new ExtractionCache(tempDir, 'v1');
      const result = await cache2.get('key1');

      expect(result).toEqual(sampleFacts);
    });

    it('should use different files for different prompt versions', async () => {
      await cache.set('key1', sampleFacts);

      const cacheV2 = new ExtractionCache(tempDir, 'v2');
      const result = await cacheV2.get('key1');

      expect(result).toBeNull();
    });
  });

  describe('load from existing JSONL', () => {
    it('should load entries from pre-existing JSONL file', async () => {
      const filePath = join(tempDir, 'cache-v1.jsonl');
      const entry = {
        key: 'preloaded',
        facts: sampleFacts,
        timestamp: '2024-01-01T00:00:00.000Z',
      };
      await writeFile(filePath, JSON.stringify(entry) + '\n');

      const freshCache = new ExtractionCache(tempDir, 'v1');
      const result = await freshCache.get('preloaded');

      expect(result).toEqual(sampleFacts);
    });

    it('should skip malformed JSONL lines', async () => {
      const filePath = join(tempDir, 'cache-v1.jsonl');
      const validEntry = {
        key: 'valid',
        facts: sampleFacts,
        timestamp: '2024-01-01T00:00:00.000Z',
      };
      const content =
        'not valid json\n' +
        JSON.stringify(validEntry) + '\n' +
        '{broken\n';
      await writeFile(filePath, content);

      const freshCache = new ExtractionCache(tempDir, 'v1');
      const result = await freshCache.get('valid');

      expect(result).toEqual(sampleFacts);
      expect(await freshCache.get('not-a-key')).toBeNull();
    });
  });

  describe('buildKey()', () => {
    it('should produce deterministic keys', () => {
      const key1 = ExtractionCache.buildKey('gpt-4', 'v1', ['Hello', 'World']);
      const key2 = ExtractionCache.buildKey('gpt-4', 'v1', ['Hello', 'World']);

      expect(key1).toBe(key2);
    });

    it('should produce different keys for different inputs', () => {
      const key1 = ExtractionCache.buildKey('gpt-4', 'v1', ['Hello']);
      const key2 = ExtractionCache.buildKey('gpt-4', 'v1', ['World']);
      const key3 = ExtractionCache.buildKey('gpt-4', 'v2', ['Hello']);
      const key4 = ExtractionCache.buildKey('claude', 'v1', ['Hello']);

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key1).not.toBe(key4);
    });

    it('should produce 16-char hex string', () => {
      const key = ExtractionCache.buildKey('model', 'v1', ['text']);
      expect(key).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe('edge cases', () => {
    it('should handle empty facts array', async () => {
      await cache.set('empty', []);
      const result = await cache.get('empty');
      expect(result).toEqual([]);
    });

    it('should create cache directory if it does not exist', async () => {
      const nestedDir = join(tempDir, 'nested', 'deep', 'cache');
      const nestedCache = new ExtractionCache(nestedDir, 'v1');

      await nestedCache.set('key1', sampleFacts);
      const result = await nestedCache.get('key1');

      expect(result).toEqual(sampleFacts);
    });
  });
});
