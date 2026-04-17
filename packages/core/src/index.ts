export { MemoryNotFoundError } from './errors.js';
export { ensureSchema } from './schema.js';
export type { SchemaOptions } from './schema.js';
export { generateMemoryId, nowIso, keywordsToString, stringToKeywords, deriveMemoryState } from './utils.js';
export { rowToMemory, serializeEmbedding } from './mapper.js';
export type { MemoryRow } from './mapper.js';
export { createPreparedStatements, storeMemory, storeBatchInTransaction, storeMemoryAsync, storeBatchAsync } from './store.js';
export type { PreparedStatements } from './store.js';
export { createRelationStatements, createRelation, getRelationsByMemory } from './relations.js';
export type { RelationStatements } from './relations.js';
export { buildFtsQuery, preprocessQuery, buildSearchSql, normalizeScores, ftsSearch, vectorSearch, bruteForceVectorSearch, rrfMerge, rrfMergeWeighted, convexCombinationMerge, searchMemories, updateAccessTracking, deduplicateResults, applyKeywordBoost, extractQueryTokens, applyThreeFactorReranking, applySpreadingBoost } from './search.js';
export type { SearchSqlResult, VectorSearchResult } from './search.js';
export { SqliteMemoryEngine, createEngine } from './engine.js';
export type { SqliteEngineOptions } from './engine.js';
export { computeActivation, computeEbbinghaus } from './activation.js';
export { determineTier, estimateTokens, DEFAULT_TIER_CONFIG } from './tiers.js';
export { recordCoAccess, getCoAccessNeighbors, decayCoAccess } from './coaccess.js';
export { spreadActivation } from './spreading.js';
export { scanDuplicateGroups, collapseExactDuplicates } from './dedupe.js';
export type { DuplicateGroup, DuplicateMember, DedupeResult } from './dedupe.js';
export {
  createSourceStatements,
  insertSourceAttestations,
  getSourceAttestations,
  countSourceAttestations,
  getMemoryWithSources,
} from './source.js';
export type { SourceStatements } from './source.js';
export {
  createEpisodeStatements,
  insertEpisode,
  closeEpisode,
  getEpisodeById,
  getOpenEpisodeForUser,
  insertSegment,
  closeSegment,
  getSegmentById,
  getLatestOpenSegment,
  bindMemoryToEpisode,
  getBindingsByMemory,
  getBindingsByEpisode,
} from './episodes.js';
export type {
  EpisodeStatements,
  MemoryEpisodicBindingInput,
} from './episodes.js';
export {
  createGoalStatements,
  insertGoal,
  closeGoal,
  reopenGoal,
  blockGoal,
  touchGoal,
  setGoalOutcome,
  getGoalById,
  getActiveGoalsForUser,
  getGoalsByParent,
  linkMemoryToGoal,
  getLinksByGoal,
  getLinksByMemory,
} from './goals.js';
export type {
  GoalStatements,
  CloseGoalOptions,
  GoalLinkInput,
} from './goals.js';
export {
  createGistStatements,
  setMemoryGist,
  getCurrentGist,
  getGistVersions,
  getVerbatim,
} from './gists.js';
export type {
  GistStatements,
  GistUpdate,
  GistVersionRow,
} from './gists.js';
export {
  createMemoryAliasStatements,
  resolveMemoryAxes,
  mapLegacyTypeToAxes,
  addMemoryAlias,
  getMemoryAliases,
  removeMemoryAlias,
  MEMORY_ALIAS_MAX_PER_MEMORY,
  MEMORY_ALIAS_MIN_CONFIDENCE,
} from './types.js';
export type {
  MemoryAliasStatements,
  AddMemoryAliasInput,
  ResolvedAxes,
} from './types.js';
export {
  createHippocampalStatements,
  registerCueAlias,
  canonicalizeCue,
  reinforceEpisodicCue,
  getCuesForEpisode,
  getCuesForEpisodeFamily,
  scoreEpisodesByCues,
} from './hippocampal.js';
export type {
  HippocampalStatements,
  HippocampalOptions,
  ReinforceInput,
  EpisodeMatchScore,
} from './hippocampal.js';
export { patternComplete } from './pattern-complete.js';
export type { PatternCompleteInput } from './pattern-complete.js';
export {
  reconstructRecall,
  RecallHookRegistry,
} from './recall.js';
export type {
  HookName,
  HookContext,
  HookHandler,
} from './recall.js';
export {
  createConstructStatements,
  upsertMemoryConstruct,
  getMemoryConstruct,
  listConstructsByAbstraction,
  linkConstructExemplar,
  getConstructExemplars,
  getConstructsForExemplar,
  recordConstructReuse,
} from './constructs.js';
export type {
  ConstructStatements,
  ConstructExemplarInput,
} from './constructs.js';
export { computeNoveltyScore } from './novelty.js';
export type { NoveltyInput } from './novelty.js';
export {
  classifyAsExemplar,
  applyPatternSeparationOutcomes,
} from './pattern-separation.js';
export type {
  PatternSeparationInput,
  PatternSeparationOutcome,
} from './pattern-separation.js';
export { ConsolidationQueue } from './consolidation.js';
export type {
  ConsolidationJob,
  JobHandler,
  JobKind,
  JobStatus,
  AbstractionJobKind,
  MaintenanceJobKind,
} from './consolidation.js';
export { applyAntiInterference } from './anti-interference.js';
export type {
  AntiInterferenceInput,
  ScoredEvidence,
} from './anti-interference.js';
