import type { MemoryTier } from './memory.js';

export type SyncOpType =
  | 'memory_created'
  | 'relation_created'
  | 'memory_invalidated'
  | 'feedback_given'
  | 'memory_tier_set';

export interface SyncOp {
  /** UUID v7 */
  readonly opId: string;
  readonly opType: SyncOpType;
  readonly deviceId: string;
  readonly userId: string;
  /** ISO 8601 */
  readonly createdAt: string;
  readonly payload: unknown;
}

export interface SyncPushRequest {
  readonly deviceId: string;
  readonly baseCursor: number;
  readonly ops: readonly SyncOp[];
}

export interface SyncPushResult {
  readonly opId: string;
  readonly status: 'accepted' | 'duplicate' | 'rejected';
  readonly cursor: number;
  readonly rejectionCode?: string;
}

export interface SyncPushResponse {
  readonly success: boolean;
  readonly data: {
    readonly results: readonly SyncPushResult[];
    readonly highWatermark: number;
  };
}

export interface SyncPullParams {
  readonly since: number;
  readonly limit?: number;
}

export interface SyncPulledOp extends SyncOp {
  readonly cursor: number;
  readonly receivedAt: string;
  readonly sourceSeq?: number;
}

export interface SyncPullResponse {
  readonly success: boolean;
  readonly data: {
    readonly ops: readonly SyncPulledOp[];
    readonly nextCursor: number;
    readonly hasMore: boolean;
  };
}

export interface SyncConfig {
  readonly enabled: boolean;
  readonly serverUrl?: string;
  readonly apiKey?: string;
  readonly deviceId: string;
  /** Default 300000 (5min) */
  readonly syncIntervalMs?: number;
}

/** Memory payload for memory_created op (excludes local-only fields). */
export interface SyncMemoryPayload {
  readonly memoryId: string;
  readonly userId: string;
  readonly namespace?: string;
  readonly memoryType: string;
  readonly content: string;
  readonly rawText?: string;
  readonly documentDate?: string;
  readonly sourceId?: string;
  readonly confidence: number;
  readonly salience: number;
  readonly keywords?: readonly string[];
  readonly eventDateStart?: string;
  readonly eventDateEnd?: string;
  readonly invalidatedAt?: string;
  readonly learnedAt: string;
}

/** Relation payload for relation_created op. */
export interface SyncRelationPayload {
  readonly srcMemoryId: string;
  readonly dstMemoryId: string;
  readonly relationType: string;
  readonly reason?: string;
  readonly createdAt: string;
}

/** Invalidation payload for memory_invalidated op. */
export interface SyncInvalidatePayload {
  readonly memoryId: string;
  readonly invalidatedAt: string;
  readonly reason?: string;
}

/** Feedback payload for feedback_given op. */
export interface SyncFeedbackPayload {
  readonly memoryId: string;
  readonly helpful: boolean;
  readonly recordedAt: string;
}

/** Tier set payload for memory_tier_set op. */
export interface SyncTierPayload {
  readonly memoryId: string;
  readonly tier: MemoryTier;
  readonly recordedAt: string;
}
