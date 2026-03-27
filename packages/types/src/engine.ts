import type { Memory, MemoryInput, MemoryTier } from './memory.js';
import type { SearchQuery, SearchResponse } from './search.js';
import type { MemoryRelation, RelationType } from './relation.js';

/** Result of a maintenance run. */
export interface MaintenanceResult {
  readonly activationUpdated: number;
  readonly tiersUpdated: number;
  readonly compressed: number;
  readonly removed: number;
}

/** Result of a compress operation. */
export interface CompressResult {
  readonly compressed: number;
  readonly removed: number;
}

/** Configuration for tier boundaries. */
export interface TierConfig {
  readonly hotMaxTokens: number;
  readonly warmDays: number;
  readonly coldActivationThreshold: number;
}

/** Quality statistics about a user's memory store. */
export interface MemoryQuality {
  /** Total number of memories for the user. */
  readonly total: number;
  /** Memories that are is_latest=1 AND invalidated_at IS NULL. */
  readonly fresh: number;
  /** Memories with invalidated_at set. */
  readonly invalidated: number;
  /** Memories with is_latest=0 (superseded by a newer version). */
  readonly superseded: number;
  /** Distinct memories that participate in at least one relation. */
  readonly withRelations: number;
  /** Average activation score across all is_latest=1 memories (0 if none). */
  readonly avgActivation: number;
}

export interface IMemoryEngine {
  initialize(): Promise<void>;
  close(): Promise<void>;

  store(input: MemoryInput): Promise<Memory>;
  storeBatch(inputs: readonly MemoryInput[]): Promise<readonly Memory[]>;
  getById(memoryId: string): Promise<Memory | null>;

  search(query: SearchQuery): Promise<SearchResponse>;

  relate(
    srcMemoryId: string,
    dstMemoryId: string,
    relationType: RelationType,
    reason?: string,
  ): Promise<MemoryRelation>;

  getRelations(memoryId: string): Promise<readonly MemoryRelation[]>;

  count(userId: string): Promise<number>;
  clear(userId: string): Promise<void>;
  clearNamespace(userId: string, namespace: string): Promise<void>;

  /** Mark a memory as invalidated. Sets invalidated_at to current timestamp. */
  invalidate(memoryId: string, reason?: string): Promise<void>;

  /** Return working memory for a user, fitting within maxTokens (~3K default). */
  workingMemory(userId: string, maxTokens?: number): Promise<readonly Memory[]>;

  /** Compress cold low-activation memories into summaries. */
  compress(userId: string): Promise<CompressResult>;

  /** Run full maintenance: recompute activations, update tiers, compress. */
  maintain(userId: string): Promise<MaintenanceResult>;

  /** Promote or demote a memory to a specific tier. */
  setTier(memoryId: string, tier: MemoryTier): Promise<void>;

  /** Return quality statistics about a user's memory store. */
  quality(userId: string): Promise<MemoryQuality>;
}
