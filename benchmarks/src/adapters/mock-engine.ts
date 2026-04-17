import type {
  IMemoryEngine,
  Memory,
  MemoryInput,
  MemoryTier,
  MemoryQuality,
  MemoryRelation,
  RelationType,
  SearchQuery,
  SearchResponse,
  CompressResult,
  MaintenanceResult,
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
      tier: 'warm',
      activationScore: 1.0,
      accessCount: 0,
      useCount: 0,
      successCount: 0,
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

  async getRelations(memoryId: string): Promise<readonly MemoryRelation[]> {
    return this.relations.filter(
      (r) => r.srcMemoryId === memoryId || r.dstMemoryId === memoryId,
    );
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

  async invalidate(memoryId: string, _reason?: string): Promise<void> {
    const memory = this.memories.get(memoryId);
    if (memory) {
      this.memories.set(memoryId, {
        ...memory,
        invalidatedAt: new Date().toISOString(),
      });
    }
  }

  async workingMemory(userId: string, maxTokens: number = 3000): Promise<readonly Memory[]> {
    const tierOrder: Record<string, number> = { hot: 0, warm: 1, cold: 2 };
    const userMemories = [...this.memories.values()]
      .filter((m) => m.userId === userId && m.isLatest && !m.invalidatedAt)
      .sort((a, b) => {
        const tierDiff = (tierOrder[a.tier] ?? 1) - (tierOrder[b.tier] ?? 1);
        if (tierDiff !== 0) return tierDiff;
        return b.activationScore - a.activationScore;
      });

    const result: Memory[] = [];
    let totalTokens = 0;

    for (const memory of userMemories) {
      const estimated = Math.ceil(memory.content.length / 4);
      if (totalTokens + estimated > maxTokens) break;
      result.push(memory);
      totalTokens += estimated;
    }

    return result;
  }

  async compress(_userId: string): Promise<CompressResult> {
    return { compressed: 0, removed: 0 };
  }

  async maintain(_userId: string): Promise<MaintenanceResult> {
    return { activationUpdated: 0, tiersUpdated: 0, compressed: 0, removed: 0 };
  }

  async setTier(memoryId: string, tier: MemoryTier): Promise<void> {
    const memory = this.memories.get(memoryId);
    if (memory) {
      this.memories.set(memoryId, { ...memory, tier });
    }
  }

  async feedback(memoryId: string, helpful: boolean): Promise<void> {
    const memory = this.memories.get(memoryId);
    if (memory) {
      const newUseCount = memory.useCount + 1;
      const newSuccessCount = helpful ? memory.successCount + 1 : memory.successCount;
      const successRate = newSuccessCount / newUseCount;
      const newSalience = Math.min(1.0, Math.max(0.1, 0.5 + 0.5 * successRate));
      this.memories.set(memoryId, {
        ...memory,
        useCount: newUseCount,
        successCount: newSuccessCount,
        salience: newSalience,
      });
    }
  }

  async reconstructRecall(): Promise<never> {
    // Benchmark MockEngine does not implement the v1.0 reconstructive
    // kernel. Tests that exercise reconstructRecall() should use the
    // real SqliteMemoryEngine — the mock exists to benchmark the
    // legacy Layer A search path, not the reconstructive path.
    throw new Error('MockEngine does not implement reconstructRecall — use SqliteMemoryEngine for Layer A/B benchmarks');
  }

  async quality(userId: string): Promise<MemoryQuality> {
    const userMemories = [...this.memories.values()].filter(m => m.userId === userId);
    const total = userMemories.length;
    const fresh = userMemories.filter(m => m.isLatest && !m.invalidatedAt).length;
    const invalidated = userMemories.filter(m => m.invalidatedAt != null).length;
    const superseded = userMemories.filter(m => !m.isLatest).length;

    const memoryIds = new Set(userMemories.map(m => m.memoryId));
    const withRelationsSet = new Set<string>();
    for (const rel of this.relations) {
      if (memoryIds.has(rel.srcMemoryId)) withRelationsSet.add(rel.srcMemoryId);
      if (memoryIds.has(rel.dstMemoryId)) withRelationsSet.add(rel.dstMemoryId);
    }

    const latestMemories = userMemories.filter(m => m.isLatest);
    const avgActivation = latestMemories.length > 0
      ? latestMemories.reduce((sum, m) => sum + m.activationScore, 0) / latestMemories.length
      : 0;

    return {
      total,
      fresh,
      invalidated,
      superseded,
      withRelations: withRelationsSet.size,
      avgActivation,
    };
  }
}
