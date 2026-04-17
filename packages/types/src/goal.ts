/**
 * Goal-state memory types for reconstructive-memory v1.0.
 *
 * Goals capture *what problem was being solved* during the episodes
 * a memory belongs to. Without them, "context preservation" decays to
 * "similarity retrieval" — reuse_mode recall in particular depends
 * on comparing target and source goal states, not only content.
 *
 * Schema mirrors v4 합의안 section 17.1 (horizon / priority /
 * blocked_by / abandon_reason / reopened_at / owner / structured
 * success_criteria).
 */

export type GoalHorizon = 'turn' | 'session' | 'project' | 'long_running';

export type GoalType =
  | 'explore'
  | 'solve'
  | 'learn'
  | 'decide'
  | 'build'
  | 'ship';

export type GoalState =
  | 'active'
  | 'achieved'
  | 'abandoned'
  | 'blocked'
  | 'paused';

export type GoalOwnerAgent =
  | 'user'
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'gemini'
  | 'shared';

export type GoalOwnerMode = 'explicit' | 'inferred' | 'system_generated';

export type GoalMemoryLinkRole =
  | 'step'
  | 'evidence'
  | 'decision'
  | 'side_effect';

export interface BlockerRecord {
  readonly blockerType: string;
  readonly ref?: string;
  readonly since: string;
  readonly note?: string;
}

export interface SuccessCriterion {
  readonly criterion: string;
  readonly threshold?: string | number;
  readonly measurement?: string;
}

export interface GoalConstraint {
  readonly type: string;
  readonly value: string | number | boolean;
  readonly strictness?: 'hard' | 'soft';
}

export interface Goal {
  readonly goalId: string;
  readonly userId: string;
  readonly parentGoalId?: string;

  readonly goalText: string;
  readonly goalGist?: string;
  readonly goalType?: GoalType;

  readonly goalHorizon: GoalHorizon;
  readonly priority: number;
  readonly state: GoalState;
  readonly blockedBy?: readonly BlockerRecord[];
  readonly abandonReason?: string;

  readonly constraints?: readonly GoalConstraint[];
  readonly successCriteriaText?: string;
  readonly successCriteria?: readonly SuccessCriterion[];
  readonly failureSignals?: readonly string[];

  readonly startedAt: string;
  readonly endedAt?: string;
  readonly reopenedAt?: string;
  readonly lastTouchedAt: string;

  readonly ownerAgent?: GoalOwnerAgent;
  readonly ownerMode?: GoalOwnerMode;

  readonly contextSnapshot?: Record<string, unknown>;
  readonly outcomeSummary?: string;
}

export interface GoalInput {
  readonly userId: string;
  readonly parentGoalId?: string;

  readonly goalText: string;
  readonly goalGist?: string;
  readonly goalType?: GoalType;

  readonly goalHorizon: GoalHorizon;
  readonly priority?: number;
  readonly state?: GoalState;
  readonly blockedBy?: readonly BlockerRecord[];
  readonly abandonReason?: string;

  readonly constraints?: readonly GoalConstraint[];
  readonly successCriteriaText?: string;
  readonly successCriteria?: readonly SuccessCriterion[];
  readonly failureSignals?: readonly string[];

  readonly startedAt?: string;
  readonly ownerAgent?: GoalOwnerAgent;
  readonly ownerMode?: GoalOwnerMode;

  readonly contextSnapshot?: Record<string, unknown>;
  readonly outcomeSummary?: string;
}

export interface GoalMemoryLink {
  readonly goalId: string;
  readonly memoryId: string;
  readonly linkRole: GoalMemoryLinkRole;
  readonly linkWeight: number;
  readonly createdAt: string;
}
