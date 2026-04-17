import {
  createEpisodeStatements,
  insertEpisode,
  type SqliteMemoryEngine,
} from '@memrosetta/core';
import type {
  ScenarioMetricEntry,
  V1Scenario,
} from './types.js';
import type { ReconstructRecallInput, ReconstructRecallResult } from '@memrosetta/types';

const USER_ID = 'bench-user';

let sourceId = '';

/**
 * Context-preserving transfer benchmark (v4 §15 #4).
 *
 * Memory stored under state vector A (repo=memrosetta, topic=retrieval)
 * should still be retrievable under state vector B (repo=other,
 * topic=retrieval). This exercises the pattern-completion property:
 * recall does not require the caller to reproduce the exact state
 * vector; shared topic cues are enough to surface transferable facts.
 */
export const contextTransferScenario: V1Scenario = {
  name: 'context_preserving_transfer',

  async seed(engine: SqliteMemoryEngine) {
    const db = engine.rawDatabase()!;
    const episodeStmts = createEpisodeStatements(db);
    const ep = insertEpisode(episodeStmts, { userId: USER_ID });

    const source = await engine.store({
      userId: USER_ID,
      memoryType: 'fact',
      content:
        'Reciprocal Rank Fusion works well for combining FTS + vector search signals',
      episodeId: ep.episodeId,
      cues: [
        { featureType: 'repo', featureValue: 'memrosetta', activation: 1 },
        { featureType: 'topic', featureValue: 'retrieval', activation: 1 },
        { featureType: 'concept', featureValue: 'rrf', activation: 1 },
      ],
    });
    sourceId = source.memoryId;
  },

  buildInput(): ReconstructRecallInput {
    return {
      userId: USER_ID,
      // State vector B: different repo, but the topic cue transfers
      query: 'what did we say about hybrid retrieval scoring',
      cues: [{ featureType: 'topic', featureValue: 'retrieval' }],
      context: { repo: 'other-project', taskMode: 'implement' },
      intent: 'explain',
    };
  },

  evaluate(result: ReconstructRecallResult): readonly ScenarioMetricEntry[] {
    const transferred = result.evidence.some((e) => e.memoryId === sourceId);
    const hasCompletion = result.completedFeatures.length > 0;

    return [
      {
        name: 'transfer_retrieved',
        value: transferred ? 1 : 0,
        ideal: 1,
        passed: transferred,
      },
      {
        name: 'completed_features_present',
        value: hasCompletion ? 1 : 0,
        ideal: 1,
        passed: hasCompletion,
      },
    ];
  },
};
