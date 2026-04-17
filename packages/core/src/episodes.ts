import type Database from 'better-sqlite3';
import type {
  Episode,
  EpisodeInput,
  MemoryEpisodicBinding,
  Segment,
  SegmentInput,
  StateVector,
} from '@memrosetta/types';
import { generateMemoryId, nowIso } from './utils.js';

interface EpisodeRow {
  readonly episode_id: string;
  readonly user_id: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly boundary_reason: string | null;
  readonly episode_gist: string | null;
  readonly dominant_goal_id: string | null;
  readonly all_goal_ids_json: string | null;
  readonly context_snapshot: string | null;
  readonly source_artifact_ids: string | null;
}

interface SegmentRow {
  readonly segment_id: string;
  readonly episode_id: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly segment_position: number | null;
  readonly boundary_reason: string | null;
  readonly task_mode: string | null;
  readonly dominant_goal_id: string | null;
  readonly state_vector_json: string | null;
}

interface BindingRow {
  readonly memory_id: string;
  readonly episode_id: string;
  readonly segment_id: string | null;
  readonly segment_position: number | null;
  readonly binding_strength: number;
}

export interface EpisodeStatements {
  readonly insertEpisode: Database.Statement;
  readonly updateEpisodeEnd: Database.Statement;
  readonly getEpisodeById: Database.Statement;
  readonly getOpenEpisodeForUser: Database.Statement;

  readonly insertSegment: Database.Statement;
  readonly updateSegmentEnd: Database.Statement;
  readonly getSegmentById: Database.Statement;
  readonly getLatestOpenSegment: Database.Statement;
  readonly nextSegmentPosition: Database.Statement;

  readonly insertBinding: Database.Statement;
  readonly getBindingsByMemory: Database.Statement;
  readonly getBindingsByEpisode: Database.Statement;
}

export function createEpisodeStatements(db: Database.Database): EpisodeStatements {
  return {
    insertEpisode: db.prepare(`
      INSERT INTO episodes
        (episode_id, user_id, started_at, ended_at, boundary_reason,
         episode_gist, dominant_goal_id, all_goal_ids_json,
         context_snapshot, source_artifact_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateEpisodeEnd: db.prepare(
      'UPDATE episodes SET ended_at = ? WHERE episode_id = ? AND ended_at IS NULL',
    ),
    getEpisodeById: db.prepare('SELECT * FROM episodes WHERE episode_id = ?'),
    getOpenEpisodeForUser: db.prepare(
      `SELECT * FROM episodes
       WHERE user_id = ? AND ended_at IS NULL
       ORDER BY started_at DESC
       LIMIT 1`,
    ),

    insertSegment: db.prepare(`
      INSERT INTO segments
        (segment_id, episode_id, started_at, ended_at, segment_position,
         boundary_reason, task_mode, dominant_goal_id, state_vector_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateSegmentEnd: db.prepare(
      'UPDATE segments SET ended_at = ? WHERE segment_id = ? AND ended_at IS NULL',
    ),
    getSegmentById: db.prepare('SELECT * FROM segments WHERE segment_id = ?'),
    getLatestOpenSegment: db.prepare(
      `SELECT * FROM segments
       WHERE episode_id = ? AND ended_at IS NULL
       ORDER BY segment_position DESC, started_at DESC
       LIMIT 1`,
    ),
    nextSegmentPosition: db.prepare(
      `SELECT COALESCE(MAX(segment_position), -1) + 1 AS next_pos
       FROM segments WHERE episode_id = ?`,
    ),

    // Targeted idempotency (same pattern as source_attestations):
    // duplicate (memory_id, episode_id) is a no-op, but FK/CHECK
    // violations still throw instead of disappearing.
    insertBinding: db.prepare(`
      INSERT INTO memory_episodic_bindings
        (memory_id, episode_id, segment_id, segment_position, binding_strength)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(memory_id, episode_id) DO NOTHING
    `),
    getBindingsByMemory: db.prepare(
      'SELECT * FROM memory_episodic_bindings WHERE memory_id = ?',
    ),
    getBindingsByEpisode: db.prepare(
      'SELECT * FROM memory_episodic_bindings WHERE episode_id = ?',
    ),
  };
}

function rowToEpisode(row: EpisodeRow): Episode {
  const contextSnapshot = row.context_snapshot
    ? (JSON.parse(row.context_snapshot) as StateVector)
    : undefined;
  const allGoalIds = row.all_goal_ids_json
    ? (JSON.parse(row.all_goal_ids_json) as readonly string[])
    : undefined;
  const sourceArtifactIds = row.source_artifact_ids
    ? (JSON.parse(row.source_artifact_ids) as readonly string[])
    : undefined;

  return {
    episodeId: row.episode_id,
    userId: row.user_id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    boundaryReason:
      (row.boundary_reason as Episode['boundaryReason']) ?? undefined,
    episodeGist: row.episode_gist ?? undefined,
    dominantGoalId: row.dominant_goal_id ?? undefined,
    allGoalIds,
    contextSnapshot,
    sourceArtifactIds,
  };
}

function rowToSegment(row: SegmentRow): Segment {
  const stateVector = row.state_vector_json
    ? (JSON.parse(row.state_vector_json) as StateVector)
    : undefined;

  return {
    segmentId: row.segment_id,
    episodeId: row.episode_id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    segmentPosition: row.segment_position ?? undefined,
    boundaryReason:
      (row.boundary_reason as Segment['boundaryReason']) ?? undefined,
    taskMode: (row.task_mode as Segment['taskMode']) ?? undefined,
    dominantGoalId: row.dominant_goal_id ?? undefined,
    stateVector,
  };
}

function rowToBinding(row: BindingRow): MemoryEpisodicBinding {
  return {
    memoryId: row.memory_id,
    episodeId: row.episode_id,
    segmentId: row.segment_id ?? undefined,
    segmentPosition: row.segment_position ?? undefined,
    bindingStrength: row.binding_strength,
  };
}

export function insertEpisode(
  stmts: EpisodeStatements,
  input: EpisodeInput,
  episodeId?: string,
): Episode {
  const id = episodeId ?? generateMemoryId();
  const startedAt = input.startedAt ?? nowIso();

  stmts.insertEpisode.run(
    id,
    input.userId,
    startedAt,
    null, // ended_at
    input.boundaryReason ?? null,
    null, // episode_gist
    input.dominantGoalId ?? null,
    input.allGoalIds ? JSON.stringify(input.allGoalIds) : null,
    input.contextSnapshot ? JSON.stringify(input.contextSnapshot) : null,
    input.sourceArtifactIds ? JSON.stringify(input.sourceArtifactIds) : null,
  );

  const row = stmts.getEpisodeById.get(id) as EpisodeRow;
  return rowToEpisode(row);
}

export function closeEpisode(
  stmts: EpisodeStatements,
  episodeId: string,
  endedAt?: string,
): void {
  stmts.updateEpisodeEnd.run(endedAt ?? nowIso(), episodeId);
}

export function getEpisodeById(
  stmts: EpisodeStatements,
  episodeId: string,
): Episode | null {
  const row = stmts.getEpisodeById.get(episodeId) as EpisodeRow | undefined;
  return row ? rowToEpisode(row) : null;
}

export function getOpenEpisodeForUser(
  stmts: EpisodeStatements,
  userId: string,
): Episode | null {
  const row = stmts.getOpenEpisodeForUser.get(userId) as EpisodeRow | undefined;
  return row ? rowToEpisode(row) : null;
}

export function insertSegment(
  stmts: EpisodeStatements,
  input: SegmentInput,
  segmentId?: string,
): Segment {
  const id = segmentId ?? generateMemoryId();
  const startedAt = input.startedAt ?? nowIso();
  const position =
    input.segmentPosition ??
    (stmts.nextSegmentPosition.get(input.episodeId) as { next_pos: number })
      .next_pos;

  stmts.insertSegment.run(
    id,
    input.episodeId,
    startedAt,
    null, // ended_at
    position,
    input.boundaryReason ?? null,
    input.taskMode ?? null,
    input.dominantGoalId ?? null,
    input.stateVector ? JSON.stringify(input.stateVector) : null,
  );

  const row = stmts.getSegmentById.get(id) as SegmentRow;
  return rowToSegment(row);
}

export function closeSegment(
  stmts: EpisodeStatements,
  segmentId: string,
  endedAt?: string,
): void {
  stmts.updateSegmentEnd.run(endedAt ?? nowIso(), segmentId);
}

export function getSegmentById(
  stmts: EpisodeStatements,
  segmentId: string,
): Segment | null {
  const row = stmts.getSegmentById.get(segmentId) as SegmentRow | undefined;
  return row ? rowToSegment(row) : null;
}

export function getLatestOpenSegment(
  stmts: EpisodeStatements,
  episodeId: string,
): Segment | null {
  const row = stmts.getLatestOpenSegment.get(episodeId) as
    | SegmentRow
    | undefined;
  return row ? rowToSegment(row) : null;
}

export interface MemoryEpisodicBindingInput {
  readonly memoryId: string;
  readonly episodeId: string;
  readonly segmentId?: string;
  readonly segmentPosition?: number;
  readonly bindingStrength?: number;
}

export function bindMemoryToEpisode(
  stmts: EpisodeStatements,
  input: MemoryEpisodicBindingInput,
): void {
  // Codex Step 2 review, must-fix #1: the FKs to episodes and segments
  // are individually valid but SQLite has no way to enforce that the
  // referenced segment actually belongs to the referenced episode. A
  // binding that points at segment_of_ep2 while claiming episode_id=ep1
  // would silently corrupt the episodic index later. Catch it here.
  if (input.segmentId) {
    const seg = stmts.getSegmentById.get(input.segmentId) as
      | { readonly episode_id: string }
      | undefined;
    if (!seg) {
      throw new Error(
        `bindMemoryToEpisode: segment ${input.segmentId} does not exist`,
      );
    }
    if (seg.episode_id !== input.episodeId) {
      throw new Error(
        `bindMemoryToEpisode: segment ${input.segmentId} belongs to episode ` +
          `${seg.episode_id}, not ${input.episodeId}`,
      );
    }
  }

  stmts.insertBinding.run(
    input.memoryId,
    input.episodeId,
    input.segmentId ?? null,
    input.segmentPosition ?? null,
    input.bindingStrength ?? 1.0,
  );
}

export function getBindingsByMemory(
  stmts: EpisodeStatements,
  memoryId: string,
): readonly MemoryEpisodicBinding[] {
  const rows = stmts.getBindingsByMemory.all(memoryId) as readonly BindingRow[];
  return rows.map(rowToBinding);
}

export function getBindingsByEpisode(
  stmts: EpisodeStatements,
  episodeId: string,
): readonly MemoryEpisodicBinding[] {
  const rows = stmts.getBindingsByEpisode.all(episodeId) as readonly BindingRow[];
  return rows.map(rowToBinding);
}
