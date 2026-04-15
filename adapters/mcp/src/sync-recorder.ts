import type { Memory, MemoryRelation } from '@memrosetta/types';

/**
 * Narrow interface for recording sync operations from MCP tools.
 * tools.ts depends on this interface, not on the concrete SyncClient.
 */
export interface SyncRecorder {
  recordMemoryCreated(memory: Memory): void;
  recordRelationCreated(relation: MemoryRelation): void;
  recordMemoryInvalidated(memoryId: string, invalidatedAt: string, reason?: string): void;
  recordFeedbackGiven(memoryId: string, helpful: boolean, recordedAt: string): void;
}
