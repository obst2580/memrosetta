import {
  createEpisodeStatements,
  insertEpisode,
  setMemoryGist,
  type SqliteMemoryEngine,
} from '@memrosetta/core';
import type {
  ScenarioMetricEntry,
  V1Scenario,
} from './types.js';
import type { ReconstructRecallInput, ReconstructRecallResult } from '@memrosetta/types';

const USER_ID = 'bench-user';

let verbatimMemoryId = '';
let gistOnlyMemoryId = '';

/**
 * Source fidelity benchmark (v4 §15 #2).
 *
 * Two memories share the same cue: one carries both verbatim and a
 * divergent gist; the other has an immutable verbatim but had its
 * gist rewritten twice. `verify` intent must surface the verbatim
 * row and `maximally strict` provenance (all evidence rows must
 * carry verbatim_content).
 */
export const sourceFidelityScenario: V1Scenario = {
  name: 'source_fidelity',

  async seed(engine: SqliteMemoryEngine) {
    const db = engine.rawDatabase()!;
    const episodeStmts = createEpisodeStatements(db);
    const ep = insertEpisode(episodeStmts, { userId: USER_ID });

    const mem = await engine.store({
      userId: USER_ID,
      memoryType: 'fact',
      content: 'The API rate limit is 100 requests per minute',
      verbatim: 'The API rate limit is 100 requests per minute (from docs v1.2)',
      gist: 'API rate limit: 100 rpm',
      gistConfidence: 0.95,
      episodeId: ep.episodeId,
      cues: [
        { featureType: 'topic', featureValue: 'rate-limit', activation: 1 },
      ],
    });
    verbatimMemoryId = mem.memoryId;

    // Second memory: verbatim is present but gist has drifted through
    // revisions. Each setMemoryGist archives the previous value; the
    // *current* gist no longer matches verbatim word-for-word.
    const drift = await engine.store({
      userId: USER_ID,
      memoryType: 'fact',
      content: 'Auth uses JWT with RS256 signing',
      verbatim: 'Auth uses JWT with RS256 signing and 15 minute access tokens',
      gist: 'JWT / RS256',
      episodeId: ep.episodeId,
      cues: [
        { featureType: 'topic', featureValue: 'rate-limit', activation: 1 },
      ],
    });
    gistOnlyMemoryId = drift.memoryId;

    // Use the public gist helper so the reconsolidation history exists.
    const { createGistStatements } = await import('@memrosetta/core');
    const gistStmts = createGistStatements(db);
    setMemoryGist(db, gistStmts, {
      memoryId: gistOnlyMemoryId,
      gistContent: 'JWT signing with short tokens',
      reason: 'refinement',
    });
    setMemoryGist(db, gistStmts, {
      memoryId: gistOnlyMemoryId,
      gistContent: 'JWT / RS256 / tokens',
      reason: 'refinement',
    });
  },

  buildInput(): ReconstructRecallInput {
    return {
      userId: USER_ID,
      query: 'API rate limits and auth tokens',
      cues: [{ featureType: 'topic', featureValue: 'rate-limit' }],
      intent: 'verify',
    };
  },

  evaluate(result: ReconstructRecallResult): readonly ScenarioMetricEntry[] {
    const evidenceCount = result.evidence.length;
    const allHaveVerbatim = result.evidence.every(
      (e) => e.verbatimContent != null && e.verbatimContent.length > 0,
    );
    const hasVerbatimMemory = result.evidence.some(
      (e) => e.memoryId === verbatimMemoryId,
    );

    return [
      {
        name: 'evidence_has_verbatim',
        value: evidenceCount > 0 && allHaveVerbatim ? 1 : 0,
        ideal: 1,
        passed: evidenceCount > 0 && allHaveVerbatim,
      },
      {
        name: 'verbatim_memory_present',
        value: hasVerbatimMemory ? 1 : 0,
        ideal: 1,
        passed: hasVerbatimMemory,
      },
    ];
  },
};
