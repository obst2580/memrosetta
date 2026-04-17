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

let proceduralId = '';
let episodicNoiseId = '';

/**
 * Reuse-fit benchmark (v4 §15 #3).
 *
 * A procedural memory (TypeScript review prompt) is stored with
 * cues: language=typescript, topic=review. An episodic memory
 * ("we debated Python linters") is stored under the same topic cue
 * but with language=python. Recall with intent=reuse from a state
 * vector claiming language=python must still retrieve the
 * procedural prompt (the whole point of reuse is applying a pattern
 * across contexts) and should prefer it over the episodic noise.
 */
export const reuseFitScenario: V1Scenario = {
  name: 'reuse_fit',

  async seed(engine: SqliteMemoryEngine) {
    const db = engine.rawDatabase()!;
    const episodeStmts = createEpisodeStatements(db);
    const ep = insertEpisode(episodeStmts, { userId: USER_ID });

    const procedural = await engine.store({
      userId: USER_ID,
      memoryType: 'fact',
      content: 'Typed code review prompt template with zod validation',
      memorySystem: 'procedural',
      memoryRole: 'review_prompt',
      episodeId: ep.episodeId,
      cues: [
        { featureType: 'language', featureValue: 'typescript', activation: 1 },
        { featureType: 'topic', featureValue: 'review', activation: 1 },
      ],
    });
    proceduralId = procedural.memoryId;

    const episodic = await engine.store({
      userId: USER_ID,
      memoryType: 'event',
      content: 'We spent Monday comparing Python linters for the review bot',
      episodeId: ep.episodeId,
      cues: [
        { featureType: 'language', featureValue: 'python', activation: 1 },
        { featureType: 'topic', featureValue: 'review', activation: 1 },
      ],
    });
    episodicNoiseId = episodic.memoryId;
  },

  buildInput(): ReconstructRecallInput {
    return {
      userId: USER_ID,
      query: 'need a review prompt for python code',
      cues: [{ featureType: 'topic', featureValue: 'review' }],
      context: { language: 'python', taskMode: 'review' },
      intent: 'reuse',
    };
  },

  evaluate(result: ReconstructRecallResult): readonly ScenarioMetricEntry[] {
    const proceduralIdx = result.evidence.findIndex(
      (e) => e.memoryId === proceduralId,
    );
    const episodicIdx = result.evidence.findIndex(
      (e) => e.memoryId === episodicNoiseId,
    );

    const proceduralHit = proceduralIdx >= 0;
    // Reuse intent should route episodic out of the result entirely;
    // if it sneaks in, it should not outrank the procedural prompt.
    const proceduralRanksFirst =
      proceduralHit && (episodicIdx === -1 || proceduralIdx < episodicIdx);

    return [
      {
        name: 'procedural_retrieved',
        value: proceduralHit ? 1 : 0,
        ideal: 1,
        passed: proceduralHit,
      },
      {
        name: 'procedural_ranks_above_episodic',
        value: proceduralRanksFirst ? 1 : 0,
        ideal: 1,
        passed: proceduralRanksFirst,
      },
    ];
  },
};
