export type {
  MemoryType,
  MemoryTier,
  MemoryState,
  MemoryInput,
  Memory,
  SourceKind,
  SourceAttestation,
  MemorySystem,
  MemoryRole,
  MemoryAlias,
  MemoryAliasDerivation,
  MemoryCueInput,
} from './memory.js';

export type {
  EpisodeBoundaryReason,
  SegmentBoundaryReason,
  TaskMode,
  StateVector,
  Episode,
  Segment,
  MemoryEpisodicBinding,
  EpisodeInput,
  SegmentInput,
} from './episode.js';

export type {
  GoalHorizon,
  GoalType,
  GoalState,
  GoalOwnerAgent,
  GoalOwnerMode,
  GoalMemoryLinkRole,
  BlockerRecord,
  SuccessCriterion,
  GoalConstraint,
  Goal,
  GoalInput,
  GoalMemoryLink,
} from './goal.js';

export type {
  FeatureFamily,
  CuePolarity,
  CueFeature,
  EpisodicCue,
  CueAlias,
} from './hippocampal.js';
export { FEATURE_CAPS, DEFAULT_HALF_LIFE_HOURS } from './hippocampal.js';

export type {
  Intent,
  AbstractionLevel,
  IntentRouting,
  RecallEvidence,
  CompletedFeature,
  RecallWarning,
  ReconstructRecallInput,
  ReconstructRecallResult,
  PatternCompletionResult,
} from './recall.js';
export { INTENT_ROUTING } from './recall.js';

export type {
  ExemplarRole,
  AbstractionLevelValue,
  ConstructSlot,
  MemoryConstruct,
  MemoryConstructInput,
  ConstructExemplarLink,
  NoveltyScore,
} from './construct.js';

export type {
  SearchQuery,
  SearchFilters,
  MatchType,
  SearchResult,
  SearchResponse,
} from './search.js';

export type {
  RelationType,
  MemoryRelation,
} from './relation.js';

export type {
  IMemoryEngine,
  MaintenanceResult,
  CompressResult,
  TierConfig,
  MemoryQuality,
  BuildEpisodesOptions,
  BuildEpisodesResult,
} from './engine.js';

export type {
  StableProfile,
  DynamicProfile,
  UserProfile,
} from './profile.js';

export type {
  SyncOpType,
  SyncOp,
  SyncPushRequest,
  SyncPushResult,
  SyncPushResponse,
  SyncPullParams,
  SyncPulledOp,
  SyncPullResponse,
  SyncConfig,
  SyncMemoryPayload,
  SyncRelationPayload,
  SyncInvalidatePayload,
  SyncFeedbackPayload,
  SyncTierPayload,
  ISyncStorage,
} from './sync.js';
