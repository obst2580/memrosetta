import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteMemoryEngine } from '../src/engine.js';

describe('SqliteMemoryEngine.buildEpisodes (episode backfill)', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = new SqliteMemoryEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  async function seedMemory(opts: {
    userId?: string;
    project?: string;
    documentDate?: string;
    content?: string;
    keywords?: readonly string[];
    activityType?: string;
  }) {
    return engine.store({
      userId: opts.userId ?? 'user-1',
      namespace: 'default',
      memoryType: 'fact',
      content: opts.content ?? 'fact',
      project: opts.project,
      documentDate: opts.documentDate,
      keywords: opts.keywords,
      activityType: opts.activityType,
    });
  }

  it('creates one episode per (project, day) by default', async () => {
    await seedMemory({
      project: 'memrosetta',
      documentDate: '2026-04-17T09:00:00Z',
      content: 'a',
    });
    await seedMemory({
      project: 'memrosetta',
      documentDate: '2026-04-17T14:00:00Z',
      content: 'b',
    });
    await seedMemory({
      project: 'memrosetta',
      documentDate: '2026-04-18T09:00:00Z',
      content: 'c',
    });
    await seedMemory({
      project: 'mirroragent',
      documentDate: '2026-04-17T09:00:00Z',
      content: 'd',
    });

    const result = await engine.buildEpisodes('user-1');
    expect(result.scannedMemories).toBe(4);
    // (memrosetta, 17) + (memrosetta, 18) + (mirroragent, 17) = 3
    expect(result.episodesCreated).toBe(3);
    expect(result.memoriesBound).toBe(4);
  });

  it('dryRun reports counts without writing', async () => {
    await seedMemory({
      project: 'p1',
      documentDate: '2026-04-17T09:00:00Z',
    });
    const result = await engine.buildEpisodes('user-1', { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.episodesCreated).toBe(1);

    // Second call without dryRun should still find it unbound.
    const real = await engine.buildEpisodes('user-1');
    expect(real.episodesCreated).toBe(1);
    expect(real.alreadyBound).toBe(0);
  });

  it('skips already-bound memories on re-run (idempotent)', async () => {
    await seedMemory({
      project: 'p1',
      documentDate: '2026-04-17T09:00:00Z',
    });
    const first = await engine.buildEpisodes('user-1');
    expect(first.episodesCreated).toBe(1);
    expect(first.memoriesBound).toBe(1);

    const second = await engine.buildEpisodes('user-1');
    expect(second.alreadyBound).toBe(1);
    expect(second.episodesCreated).toBe(0);
    expect(second.memoriesBound).toBe(0);
  });

  it('groups by day only when granularity=day', async () => {
    await seedMemory({
      project: 'p1',
      documentDate: '2026-04-17T09:00:00Z',
      content: 'one',
    });
    await seedMemory({
      project: 'p2',
      documentDate: '2026-04-17T10:00:00Z',
      content: 'two',
    });
    const result = await engine.buildEpisodes('user-1', {
      granularity: 'day',
    });
    // Both projects collapse into one (day-only) episode.
    expect(result.episodesCreated).toBe(1);
    expect(result.memoriesBound).toBe(2);
  });

  it('indexes project + topic cues so recall can pattern-complete', async () => {
    await seedMemory({
      project: 'memrosetta',
      documentDate: '2026-04-17T09:00:00Z',
      content: 'hermes github repo at https://github.com/x/hermes',
      keywords: ['hermes', 'github'],
    });
    const backfill = await engine.buildEpisodes('user-1');
    expect(backfill.episodesCreated).toBe(1);
    expect(backfill.cuesIndexed).toBeGreaterThan(0);

    const recall = await engine.reconstructRecall({
      userId: 'user-1',
      query: 'hermes',
      intent: 'browse',
    });
    // After backfill the layer isn't empty anymore; recall should
    // either produce evidence or a different warning, but never
    // `episodic_layer_empty`.
    expect(
      recall.warnings.some((w) => w.kind === 'episodic_layer_empty'),
    ).toBe(false);
  });

  it('falls back to learned_at when document_date is missing', async () => {
    // No documentDate provided → learned_at (auto-set at store time)
    // is used. This covers pre-v0.11 memories captured without an
    // explicit source timestamp.
    await seedMemory({ project: 'p1', content: 'alpha' });
    await seedMemory({ project: 'p1', content: 'beta' });
    const result = await engine.buildEpisodes('user-1');
    expect(result.skippedMissingDate).toBe(0);
    // Both stored "now" → same day → one episode.
    expect(result.episodesCreated).toBe(1);
    expect(result.memoriesBound).toBe(2);
  });
});
