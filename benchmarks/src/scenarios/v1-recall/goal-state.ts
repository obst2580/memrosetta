import {
  createEpisodeStatements,
  createGoalStatements,
  insertEpisode,
  insertGoal,
  linkMemoryToGoal,
  type SqliteMemoryEngine,
} from '@memrosetta/core';
import type {
  ScenarioMetricEntry,
  V1Scenario,
} from './types.js';
import type { ReconstructRecallInput, ReconstructRecallResult } from '@memrosetta/types';

const USER_ID = 'bench-user';

let buildGoalId = '';
let decideGoalId = '';
let buildMemoryId = '';

/**
 * Goal-state preservation benchmark (v4 §15 #1).
 *
 * Two goals share the same topic cue ('code-review'). One is a 'build'
 * goal, the other a 'decide' goal. A single memory is attached to
 * each. Recall with `intent=reuse` and `activeGoals=[buildGoalId]`
 * should rank the build-attributed memory above the decide-attributed
 * one because anti-interference applies a goal-compatibility bonus.
 */
export const goalStateScenario: V1Scenario = {
  name: 'goal_state_preservation',

  async seed(engine: SqliteMemoryEngine) {
    const db = engine.rawDatabase()!;
    const goalStmts = createGoalStatements(db);
    const episodeStmts = createEpisodeStatements(db);

    const buildGoal = insertGoal(goalStmts, {
      userId: USER_ID,
      goalText: 'ship code-review workflow',
      goalType: 'build',
      goalHorizon: 'project',
    });
    buildGoalId = buildGoal.goalId;

    const decideGoal = insertGoal(goalStmts, {
      userId: USER_ID,
      goalText: 'pick a review model',
      goalType: 'decide',
      goalHorizon: 'session',
    });
    decideGoalId = decideGoal.goalId;

    const ep = insertEpisode(episodeStmts, { userId: USER_ID });

    const buildMemory = await engine.store({
      userId: USER_ID,
      memoryType: 'fact',
      content: 'build-context review fact: prefer type-safe mocks',
      episodeId: ep.episodeId,
      cues: [
        { featureType: 'topic', featureValue: 'code-review', activation: 1 },
      ],
    });
    buildMemoryId = buildMemory.memoryId;
    linkMemoryToGoal(goalStmts, {
      goalId: buildGoalId,
      memoryId: buildMemory.memoryId,
    });

    const decideMemory = await engine.store({
      userId: USER_ID,
      memoryType: 'fact',
      content: 'decide-context review fact: weigh latency vs accuracy',
      episodeId: ep.episodeId,
      cues: [
        { featureType: 'topic', featureValue: 'code-review', activation: 1 },
      ],
    });
    linkMemoryToGoal(goalStmts, {
      goalId: decideGoalId,
      memoryId: decideMemory.memoryId,
    });

    // Touch the fixtures in a guaranteed-stable order so recency
    // boosts never swap the expected ranking.
    db.prepare('UPDATE memories SET learned_at = ? WHERE memory_id = ?').run(
      '2026-04-17T00:00:00.000Z',
      buildMemory.memoryId,
    );
    db.prepare('UPDATE memories SET learned_at = ? WHERE memory_id = ?').run(
      '2026-04-17T00:00:00.000Z',
      decideMemory.memoryId,
    );
  },

  buildInput(): ReconstructRecallInput {
    return {
      userId: USER_ID,
      query: 'code review prompt for typescript',
      cues: [{ featureType: 'topic', featureValue: 'code-review' }],
      context: {
        activeGoals: [{ goalId: buildGoalId, dominant: true }],
      },
      intent: 'reuse',
    };
  },

  evaluate(result: ReconstructRecallResult): readonly ScenarioMetricEntry[] {
    const hasEvidence = result.evidence.length > 0;
    const topMatchesBuildGoal =
      hasEvidence && result.evidence[0].memoryId === buildMemoryId;

    const buildIdx = result.evidence.findIndex(
      (e) => e.memoryId === buildMemoryId,
    );
    const buildRankMrr = buildIdx >= 0 ? 1 / (buildIdx + 1) : 0;

    return [
      {
        name: 'top1_build_goal',
        value: topMatchesBuildGoal ? 1 : 0,
        ideal: 1,
        passed: topMatchesBuildGoal,
      },
      {
        name: 'mrr_build_goal',
        value: buildRankMrr,
        ideal: 1,
        passed: buildRankMrr >= 0.5,
      },
    ];
  },
};
