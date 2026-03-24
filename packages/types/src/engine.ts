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
}
