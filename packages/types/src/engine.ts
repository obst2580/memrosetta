import type { Memory, MemoryInput } from './memory.js';
import type { SearchQuery, SearchResponse } from './search.js';
import type { MemoryRelation, RelationType } from './relation.js';

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
}
