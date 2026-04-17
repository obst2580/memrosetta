/**
 * Event segmentation types for reconstructive-memory v1.0.
 *
 * Episodes are coarse boundaries (session, repo, long gap, explicit
 * goal reset). Segments are fine-grained chunks inside an episode
 * that capture intra-session shifts. Memories are bound to episodes
 * (and optionally to one segment within) via memory_episodic_bindings.
 */

export type EpisodeBoundaryReason =
  | 'session'
  | 'repo_switch'
  | 'gap'
  | 'goal_reset'
  | 'explicit';

export type SegmentBoundaryReason =
  | 'task_mode'
  | 'intent'
  | 'branch'
  | 'tool'
  | 'prediction_error';

export type TaskMode =
  | 'debug'
  | 'implement'
  | 'review'
  | 'design'
  | 'ship'
  | 'explore';

/**
 * Structured retrieval state snapshot. Stored as JSON on segments and
 * passed as a first-class input to reconstructRecall so retrieval
 * can match on state rather than on free-form context strings.
 */
export interface StateVector {
  readonly activeGoals?: readonly { goalId: string; dominant?: boolean }[];
  readonly taskMode?: TaskMode;
  readonly toolRegime?: readonly string[];
  readonly project?: string;
  readonly repo?: string;
  readonly branch?: string;
  readonly language?: string;
  readonly framework?: string;
  readonly timeBand?: string;
  readonly actor?: string;
  readonly conversationTopic?: string;
}

export interface Episode {
  readonly episodeId: string;
  readonly userId: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly boundaryReason?: EpisodeBoundaryReason;
  readonly episodeGist?: string;
  readonly dominantGoalId?: string;
  readonly allGoalIds?: readonly string[];
  readonly contextSnapshot?: StateVector;
  readonly sourceArtifactIds?: readonly string[];
}

export interface Segment {
  readonly segmentId: string;
  readonly episodeId: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly segmentPosition?: number;
  readonly boundaryReason?: SegmentBoundaryReason;
  readonly taskMode?: TaskMode;
  readonly dominantGoalId?: string;
  readonly stateVector?: StateVector;
}

export interface MemoryEpisodicBinding {
  readonly memoryId: string;
  readonly episodeId: string;
  readonly segmentId?: string;
  readonly segmentPosition?: number;
  readonly bindingStrength: number;
}

/**
 * Partial input for creating a new episode. userId + startedAt are
 * required at persistence time; the helper fills them from context
 * if omitted.
 */
export interface EpisodeInput {
  readonly userId: string;
  readonly startedAt?: string;
  readonly boundaryReason?: EpisodeBoundaryReason;
  readonly dominantGoalId?: string;
  readonly allGoalIds?: readonly string[];
  readonly contextSnapshot?: StateVector;
  readonly sourceArtifactIds?: readonly string[];
}

export interface SegmentInput {
  readonly episodeId: string;
  readonly startedAt?: string;
  readonly segmentPosition?: number;
  readonly boundaryReason?: SegmentBoundaryReason;
  readonly taskMode?: TaskMode;
  readonly dominantGoalId?: string;
  readonly stateVector?: StateVector;
}
