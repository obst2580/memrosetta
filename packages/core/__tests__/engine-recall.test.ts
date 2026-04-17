import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ReconstructRecallInput } from '@memrosetta/types';
import { createEngine, type SqliteMemoryEngine } from '../src/engine.js';
import { upsertMemoryConstruct, createConstructStatements } from '../src/constructs.js';
import { insertEpisode } from '../src/episodes.js';

describe('engine.reconstructRecall + construct reuse accounting', () => {
  let engine: SqliteMemoryEngine;

  beforeEach(async () => {
    engine = createEngine({ dbPath: ':memory:' });
    await engine.initialize();
  });

  afterEach(async () => {
    await engine.close();
  });

  it('recalls via engine wrapper and returns evidence', async () => {
    const db = engine.rawDatabase()!;
    const ep = insertEpisode(
      { insertEpisode: db.prepare(`
        INSERT INTO episodes (episode_id, user_id, started_at, ended_at, boundary_reason,
          episode_gist, dominant_goal_id, all_goal_ids_json, context_snapshot, source_artifact_ids)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
        getEpisodeById: db.prepare('SELECT * FROM episodes WHERE episode_id = ?'),
      } as never,
      { userId: 'u1' },
    );

    await engine.store({
      userId: 'u1',
      memoryType: 'fact',
      content: 'memrosetta uses sqlite default engine',
      episodeId: ep.episodeId,
      cues: [{ featureType: 'repo', featureValue: 'memrosetta', activation: 1 }],
    });

    const input: ReconstructRecallInput = {
      userId: 'u1',
      query: 'sqlite engine',
      cues: [{ featureType: 'repo', featureValue: 'memrosetta' }],
      intent: 'browse',
    };
    const result = await engine.reconstructRecall(input);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0].verbatimContent).toContain('sqlite');
  });

  it('increments reuse_count for construct-backed memories on recall', async () => {
    const db = engine.rawDatabase()!;
    const cons = createConstructStatements(db);

    // Create an episode to bind against
    const ep = db
      .prepare(`
        INSERT INTO episodes (episode_id, user_id, started_at, boundary_reason)
        VALUES (?, ?, ?, ?)
        RETURNING episode_id
      `)
      .get('ep-1', 'u1', new Date().toISOString(), 'session') as { episode_id: string };

    // Store a memory that is a Layer B construct
    const constructMemory = await engine.store({
      userId: 'u1',
      memoryType: 'fact',
      content: 'typescript code review prompt',
      memorySystem: 'procedural',
      memoryRole: 'review_prompt',
      episodeId: ep.episode_id,
      cues: [
        { featureType: 'language', featureValue: 'typescript', activation: 1 },
        { featureType: 'topic', featureValue: 'review', activation: 1 },
      ],
    });
    upsertMemoryConstruct(cons, {
      memoryId: constructMemory.memoryId,
      canonicalForm: 'ts review prompt',
      abstractionLevel: 3,
    });

    // Non-construct memory in the same episode
    await engine.store({
      userId: 'u1',
      memoryType: 'fact',
      content: 'plain observation without construct',
      episodeId: ep.episode_id,
      cues: [{ featureType: 'language', featureValue: 'typescript', activation: 1 }],
    });

    // Initial counters are zero
    let row = db.prepare('SELECT reuse_count FROM memory_constructs WHERE memory_id = ?')
      .get(constructMemory.memoryId) as { reuse_count: number };
    expect(row.reuse_count).toBe(0);

    // Recall — construct memory should be in evidence
    const result = await engine.reconstructRecall({
      userId: 'u1',
      query: 'typescript review',
      cues: [
        { featureType: 'language', featureValue: 'typescript' },
        { featureType: 'topic', featureValue: 'review' },
      ],
      intent: 'reuse',
    });
    const constructHit = result.evidence.find((e) => e.memoryId === constructMemory.memoryId);
    expect(constructHit).toBeDefined();

    // Construct reuse_count incremented
    row = db.prepare('SELECT reuse_count FROM memory_constructs WHERE memory_id = ?')
      .get(constructMemory.memoryId) as { reuse_count: number };
    expect(row.reuse_count).toBeGreaterThanOrEqual(1);
  });

  it('does not touch counters for non-construct memories', async () => {
    const db = engine.rawDatabase()!;
    db.prepare(`
      INSERT INTO episodes (episode_id, user_id, started_at, boundary_reason)
      VALUES (?, ?, ?, ?)
    `).run('ep-plain', 'u1', new Date().toISOString(), 'session');

    await engine.store({
      userId: 'u1',
      memoryType: 'fact',
      content: 'plain memory with no construct',
      episodeId: 'ep-plain',
      cues: [{ featureType: 'topic', featureValue: 'plain' }],
    });

    await engine.reconstructRecall({
      userId: 'u1',
      query: 'plain',
      cues: [{ featureType: 'topic', featureValue: 'plain' }],
      intent: 'browse',
    });

    const count = db
      .prepare('SELECT COUNT(*) AS c FROM memory_constructs')
      .get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('Layer B flags OFF: recall still works, no salience side-effects', async () => {
    const db = engine.rawDatabase()!;
    db.prepare(`
      INSERT INTO episodes (episode_id, user_id, started_at, boundary_reason)
      VALUES (?, ?, ?, ?)
    `).run('ep-x', 'u1', new Date().toISOString(), 'session');

    const m = await engine.store({
      userId: 'u1',
      memoryType: 'fact',
      content: 'baseline memory',
      salience: 1.0,
      episodeId: 'ep-x',
      cues: [{ featureType: 'repo', featureValue: 'mr' }],
    });

    const result = await engine.reconstructRecall({
      userId: 'u1',
      query: 'baseline',
      cues: [{ featureType: 'repo', featureValue: 'mr' }],
      intent: 'browse',
    });
    expect(result.evidence.length).toBeGreaterThan(0);

    // Salience remains 1.0 because LayerB flags default OFF.
    const row = db
      .prepare('SELECT salience FROM memories WHERE memory_id = ?')
      .get(m.memoryId) as { salience: number };
    expect(row.salience).toBe(1.0);
  });
});
