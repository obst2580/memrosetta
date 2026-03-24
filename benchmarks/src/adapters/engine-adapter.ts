import type {
  IMemoryEngine,
  Memory,
  MemoryInput,
  MemoryRelation,
  RelationType,
  SearchQuery,
  SearchResponse,
} from '@memrosetta/types';
import { startTimer } from '../utils/timer.js';

/**
 * Wraps any IMemoryEngine to automatically measure latency on every operation.
 * Latency samples are stored per operation name for later analysis.
 */
export class InstrumentedEngine {
  private readonly latencySamples: Map<string, number[]> = new Map();

  constructor(private readonly engine: IMemoryEngine) {}

  async initialize(): Promise<void> {
    const elapsed = startTimer();
    await this.engine.initialize();
    this.recordSample('initialize', elapsed());
  }

  async close(): Promise<void> {
    const elapsed = startTimer();
    await this.engine.close();
    this.recordSample('close', elapsed());
  }

  async store(
    input: MemoryInput,
  ): Promise<{ readonly memory: Memory; readonly latencyMs: number }> {
    const elapsed = startTimer();
    const memory = await this.engine.store(input);
    const latencyMs = elapsed();
    this.recordSample('store', latencyMs);
    return { memory, latencyMs };
  }

  async storeBatch(
    inputs: readonly MemoryInput[],
  ): Promise<{
    readonly memories: readonly Memory[];
    readonly latencyMs: number;
  }> {
    const elapsed = startTimer();
    const memories = await this.engine.storeBatch(inputs);
    const latencyMs = elapsed();
    this.recordSample('storeBatch', latencyMs);
    return { memories, latencyMs };
  }

  async getById(
    memoryId: string,
  ): Promise<{ readonly memory: Memory | null; readonly latencyMs: number }> {
    const elapsed = startTimer();
    const memory = await this.engine.getById(memoryId);
    const latencyMs = elapsed();
    this.recordSample('getById', latencyMs);
    return { memory, latencyMs };
  }

  async search(
    query: SearchQuery,
  ): Promise<{
    readonly response: SearchResponse;
    readonly latencyMs: number;
  }> {
    const elapsed = startTimer();
    const response = await this.engine.search(query);
    const latencyMs = elapsed();
    this.recordSample('search', latencyMs);
    return { response, latencyMs };
  }

  async relate(
    srcMemoryId: string,
    dstMemoryId: string,
    relationType: RelationType,
    reason?: string,
  ): Promise<{
    readonly relation: MemoryRelation;
    readonly latencyMs: number;
  }> {
    const elapsed = startTimer();
    const relation = await this.engine.relate(
      srcMemoryId,
      dstMemoryId,
      relationType,
      reason,
    );
    const latencyMs = elapsed();
    this.recordSample('relate', latencyMs);
    return { relation, latencyMs };
  }

  async count(
    userId: string,
  ): Promise<{ readonly count: number; readonly latencyMs: number }> {
    const elapsed = startTimer();
    const count = await this.engine.count(userId);
    const latencyMs = elapsed();
    this.recordSample('count', latencyMs);
    return { count, latencyMs };
  }

  async clear(userId: string): Promise<void> {
    const elapsed = startTimer();
    await this.engine.clear(userId);
    this.recordSample('clear', elapsed());
  }

  getSamples(operation: string): readonly number[] {
    return this.latencySamples.get(operation) ?? [];
  }

  getAllSamples(): ReadonlyMap<string, readonly number[]> {
    return this.latencySamples;
  }

  clearSamples(): void {
    this.latencySamples.clear();
  }

  private recordSample(operation: string, latencyMs: number): void {
    const existing = this.latencySamples.get(operation);
    if (existing) {
      existing.push(latencyMs);
    } else {
      this.latencySamples.set(operation, [latencyMs]);
    }
  }
}
