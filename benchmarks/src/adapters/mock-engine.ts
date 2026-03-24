import type {
  IMemoryEngine,
  Memory,
  MemoryInput,
  MemoryRelation,
  RelationType,
  SearchQuery,
  SearchResponse,
} from '@memrosetta/types';
import { randomUUID } from 'node:crypto';

/**
 * In-memory implementation of IMemoryEngine for benchmark infrastructure
 * validation. Provides simple string-matching search without embeddings.
 */
export class MockEngine implements IMemoryEngine {
  private memories: Map<string, Memory> = new Map();
  private relations: MemoryRelation[] = [];

  async initialize(): Promise<void> {
    // no-op
  }

  async close(): Promise<void> {
    this.memories.clear();
    this.relations = [];
  }

  async store(input: MemoryInput): Promise<Memory> {
    const memory: Memory = {
      ...input,
      memoryId: randomUUID(),
      learnedAt: new Date().toISOString(),
      isLatest: true,
    };
    this.memories.set(memory.memoryId, memory);
    return memory;
  }

  async storeBatch(inputs: readonly MemoryInput[]): Promise<readonly Memory[]> {
    const results: Memory[] = [];
    for (const input of inputs) {
      results.push(await this.store(input));
    }
    return results;
  }

  async getById(memoryId: string): Promise<Memory | null> {
    return this.memories.get(memoryId) ?? null;
  }

  async search(query: SearchQuery): Promise<SearchResponse> {
    const start = performance.now();
    const limit = query.limit ?? 10;

    // Simple string inclusion matching
    const results = [...this.memories.values()]
      .filter((m) => m.userId === query.userId)
      .filter((m) => {
        const queryLower = query.query.toLowerCase();
        const contentLower = m.content.toLowerCase();
        // Check if any query word appears in content
        const queryWords = queryLower.split(/\s+/);
        return queryWords.some((word) => contentLower.includes(word));
      })
      .slice(0, limit)
      .map((memory, index) => ({
        memory,
        score: 1 / (index + 1),
        matchType: 'fts' as const,
      }));

    return {
      results,
      totalCount: results.length,
      queryTimeMs: performance.now() - start,
    };
  }

  async relate(
    srcMemoryId: string,
    dstMemoryId: string,
    relationType: RelationType,
    reason?: string,
  ): Promise<MemoryRelation> {
    const relation: MemoryRelation = {
      srcMemoryId,
      dstMemoryId,
      relationType,
      createdAt: new Date().toISOString(),
      reason,
    };
    this.relations = [...this.relations, relation];
    return relation;
  }

  async count(userId: string): Promise<number> {
    return [...this.memories.values()].filter((m) => m.userId === userId)
      .length;
  }

  async clear(userId: string): Promise<void> {
    for (const [id, memory] of this.memories) {
      if (memory.userId === userId) {
        this.memories.delete(id);
      }
    }
  }

  async clearNamespace(userId: string, namespace: string): Promise<void> {
    for (const [id, memory] of this.memories) {
      if (memory.userId === userId && memory.namespace === namespace) {
        this.memories.delete(id);
      }
    }
  }
}
