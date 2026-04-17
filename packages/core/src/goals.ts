import type Database from 'better-sqlite3';
import type {
  BlockerRecord,
  Goal,
  GoalConstraint,
  GoalInput,
  GoalMemoryLink,
  GoalMemoryLinkRole,
  GoalOwnerAgent,
  GoalOwnerMode,
  GoalState,
  GoalType,
  SuccessCriterion,
} from '@memrosetta/types';
import { generateMemoryId, nowIso } from './utils.js';

interface GoalRow {
  readonly goal_id: string;
  readonly user_id: string;
  readonly parent_goal_id: string | null;

  readonly goal_text: string;
  readonly goal_gist: string | null;
  readonly goal_type: string | null;

  readonly goal_horizon: string;
  readonly priority: number;
  readonly state: string;
  readonly blocked_by_json: string | null;
  readonly abandon_reason: string | null;

  readonly constraints_json: string | null;
  readonly success_criteria_text: string | null;
  readonly success_criteria_json: string | null;
  readonly failure_signals_json: string | null;

  readonly started_at: string;
  readonly ended_at: string | null;
  readonly reopened_at: string | null;
  readonly last_touched_at: string;

  readonly owner_agent: string | null;
  readonly owner_mode: string | null;

  readonly context_snapshot: string | null;
  readonly outcome_summary: string | null;
}

interface GoalLinkRow {
  readonly goal_id: string;
  readonly memory_id: string;
  readonly link_role: string;
  readonly link_weight: number;
  readonly created_at: string;
}

export interface GoalStatements {
  readonly insertGoal: Database.Statement;
  readonly updateState: Database.Statement;
  readonly updateBlockedBy: Database.Statement;
  readonly updateOutcome: Database.Statement;
  readonly touchGoal: Database.Statement;
  readonly reopenGoal: Database.Statement;
  readonly getGoalById: Database.Statement;
  readonly getActiveGoalsForUser: Database.Statement;
  readonly getGoalsByParent: Database.Statement;

  readonly linkMemory: Database.Statement;
  readonly getLinksByGoal: Database.Statement;
  readonly getLinksByMemory: Database.Statement;
}

export function createGoalStatements(db: Database.Database): GoalStatements {
  return {
    insertGoal: db.prepare(`
      INSERT INTO goals (
        goal_id, user_id, parent_goal_id,
        goal_text, goal_gist, goal_type,
        goal_horizon, priority, state, blocked_by_json, abandon_reason,
        constraints_json, success_criteria_text, success_criteria_json, failure_signals_json,
        started_at, ended_at, reopened_at, last_touched_at,
        owner_agent, owner_mode,
        context_snapshot, outcome_summary
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateState: db.prepare(
      `UPDATE goals
       SET state = ?, ended_at = ?, abandon_reason = ?, last_touched_at = ?, outcome_summary = COALESCE(?, outcome_summary)
       WHERE goal_id = ?`,
    ),
    updateBlockedBy: db.prepare(
      `UPDATE goals
       SET blocked_by_json = ?, state = 'blocked', last_touched_at = ?
       WHERE goal_id = ?`,
    ),
    updateOutcome: db.prepare(
      `UPDATE goals
       SET outcome_summary = ?, last_touched_at = ?
       WHERE goal_id = ?`,
    ),
    touchGoal: db.prepare(
      'UPDATE goals SET last_touched_at = ? WHERE goal_id = ?',
    ),
    reopenGoal: db.prepare(
      `UPDATE goals
       SET state = 'active', ended_at = NULL, reopened_at = ?, last_touched_at = ?
       WHERE goal_id = ?`,
    ),
    getGoalById: db.prepare('SELECT * FROM goals WHERE goal_id = ?'),
    getActiveGoalsForUser: db.prepare(
      `SELECT * FROM goals
       WHERE user_id = ? AND state = 'active'
       ORDER BY priority ASC, last_touched_at DESC`,
    ),
    getGoalsByParent: db.prepare(
      'SELECT * FROM goals WHERE parent_goal_id = ? ORDER BY started_at ASC',
    ),

    linkMemory: db.prepare(`
      INSERT INTO goal_memory_links (goal_id, memory_id, link_role, link_weight, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(goal_id, memory_id, link_role) DO NOTHING
    `),
    getLinksByGoal: db.prepare(
      'SELECT * FROM goal_memory_links WHERE goal_id = ? ORDER BY created_at ASC',
    ),
    getLinksByMemory: db.prepare(
      'SELECT * FROM goal_memory_links WHERE memory_id = ? ORDER BY created_at ASC',
    ),
  };
}

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  return JSON.parse(value) as T;
}

function rowToGoal(row: GoalRow): Goal {
  return {
    goalId: row.goal_id,
    userId: row.user_id,
    parentGoalId: row.parent_goal_id ?? undefined,

    goalText: row.goal_text,
    goalGist: row.goal_gist ?? undefined,
    goalType: (row.goal_type as GoalType | null) ?? undefined,

    goalHorizon: row.goal_horizon as Goal['goalHorizon'],
    priority: row.priority,
    state: row.state as GoalState,
    blockedBy: parseJson<readonly BlockerRecord[]>(row.blocked_by_json),
    abandonReason: row.abandon_reason ?? undefined,

    constraints: parseJson<readonly GoalConstraint[]>(row.constraints_json),
    successCriteriaText: row.success_criteria_text ?? undefined,
    successCriteria: parseJson<readonly SuccessCriterion[]>(row.success_criteria_json),
    failureSignals: parseJson<readonly string[]>(row.failure_signals_json),

    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    reopenedAt: row.reopened_at ?? undefined,
    lastTouchedAt: row.last_touched_at,

    ownerAgent: (row.owner_agent as GoalOwnerAgent | null) ?? undefined,
    ownerMode: (row.owner_mode as GoalOwnerMode | null) ?? undefined,

    contextSnapshot: parseJson<Record<string, unknown>>(row.context_snapshot),
    outcomeSummary: row.outcome_summary ?? undefined,
  };
}

function rowToLink(row: GoalLinkRow): GoalMemoryLink {
  return {
    goalId: row.goal_id,
    memoryId: row.memory_id,
    linkRole: row.link_role as GoalMemoryLinkRole,
    linkWeight: row.link_weight,
    createdAt: row.created_at,
  };
}

export function insertGoal(
  stmts: GoalStatements,
  input: GoalInput,
  goalId?: string,
): Goal {
  const id = goalId ?? generateMemoryId();
  const now = input.startedAt ?? nowIso();

  // Codex Step 3 review: block the trivial self-cycle case. Full
  // recursive DAG enforcement remains debt — SQLite cannot express it
  // cleanly and the current application paths do not support raw-SQL
  // goal authoring.
  if (input.parentGoalId && input.parentGoalId === id) {
    throw new Error(
      `insertGoal: parent_goal_id ${id} cannot equal goal_id ${id}`,
    );
  }

  stmts.insertGoal.run(
    id,
    input.userId,
    input.parentGoalId ?? null,
    input.goalText,
    input.goalGist ?? null,
    input.goalType ?? null,
    input.goalHorizon,
    input.priority ?? 3,
    input.state ?? 'active',
    input.blockedBy ? JSON.stringify(input.blockedBy) : null,
    input.abandonReason ?? null,
    input.constraints ? JSON.stringify(input.constraints) : null,
    input.successCriteriaText ?? null,
    input.successCriteria ? JSON.stringify(input.successCriteria) : null,
    input.failureSignals ? JSON.stringify(input.failureSignals) : null,
    now,
    null, // ended_at
    null, // reopened_at
    now, // last_touched_at
    input.ownerAgent ?? null,
    input.ownerMode ?? null,
    input.contextSnapshot ? JSON.stringify(input.contextSnapshot) : null,
    input.outcomeSummary ?? null,
  );

  const row = stmts.getGoalById.get(id) as GoalRow;
  return rowToGoal(row);
}

export interface CloseGoalOptions {
  readonly state?: Extract<GoalState, 'achieved' | 'abandoned' | 'paused'>;
  readonly endedAt?: string;
  readonly abandonReason?: string;
  readonly outcomeSummary?: string;
}

export function closeGoal(
  stmts: GoalStatements,
  goalId: string,
  options: CloseGoalOptions = {},
): void {
  const now = options.endedAt ?? nowIso();
  const state = options.state ?? 'achieved';
  stmts.updateState.run(
    state,
    state === 'paused' ? null : now,
    options.abandonReason ?? null,
    now,
    options.outcomeSummary ?? null,
    goalId,
  );
}

export function reopenGoal(
  stmts: GoalStatements,
  goalId: string,
  reopenedAt?: string,
): void {
  const now = reopenedAt ?? nowIso();
  stmts.reopenGoal.run(now, now, goalId);
}

export function blockGoal(
  stmts: GoalStatements,
  goalId: string,
  blockers: readonly BlockerRecord[],
): void {
  stmts.updateBlockedBy.run(JSON.stringify(blockers), nowIso(), goalId);
}

export function touchGoal(stmts: GoalStatements, goalId: string): void {
  stmts.touchGoal.run(nowIso(), goalId);
}

export function setGoalOutcome(
  stmts: GoalStatements,
  goalId: string,
  outcomeSummary: string,
): void {
  stmts.updateOutcome.run(outcomeSummary, nowIso(), goalId);
}

export function getGoalById(
  stmts: GoalStatements,
  goalId: string,
): Goal | null {
  const row = stmts.getGoalById.get(goalId) as GoalRow | undefined;
  return row ? rowToGoal(row) : null;
}

export function getActiveGoalsForUser(
  stmts: GoalStatements,
  userId: string,
): readonly Goal[] {
  const rows = stmts.getActiveGoalsForUser.all(userId) as readonly GoalRow[];
  return rows.map(rowToGoal);
}

export function getGoalsByParent(
  stmts: GoalStatements,
  parentGoalId: string,
): readonly Goal[] {
  const rows = stmts.getGoalsByParent.all(parentGoalId) as readonly GoalRow[];
  return rows.map(rowToGoal);
}

export interface GoalLinkInput {
  readonly goalId: string;
  readonly memoryId: string;
  readonly linkRole?: GoalMemoryLinkRole;
  readonly linkWeight?: number;
}

export function linkMemoryToGoal(
  stmts: GoalStatements,
  input: GoalLinkInput,
): void {
  stmts.linkMemory.run(
    input.goalId,
    input.memoryId,
    input.linkRole ?? 'step',
    input.linkWeight ?? 1.0,
    nowIso(),
  );
  // Any link activity counts as "touching" the goal so recency-sensitive
  // retrieval sees active goals surface first even without a state change.
  stmts.touchGoal.run(nowIso(), input.goalId);
}

export function getLinksByGoal(
  stmts: GoalStatements,
  goalId: string,
): readonly GoalMemoryLink[] {
  const rows = stmts.getLinksByGoal.all(goalId) as readonly GoalLinkRow[];
  return rows.map(rowToLink);
}

export function getLinksByMemory(
  stmts: GoalStatements,
  memoryId: string,
): readonly GoalMemoryLink[] {
  const rows = stmts.getLinksByMemory.all(memoryId) as readonly GoalLinkRow[];
  return rows.map(rowToLink);
}
