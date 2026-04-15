import type { SyncOp, SyncPushResult, SyncPulledOp } from '@memrosetta/types';

export interface ISyncStorage {
  initialize(): Promise<void>;
  pushOps(userId: string, ops: readonly SyncOp[]): Promise<readonly SyncPushResult[]>;
  pullOps(userId: string, since: number, limit: number): Promise<{ readonly ops: readonly SyncPulledOp[]; readonly hasMore: boolean }>;
  getHighWatermark(userId: string): Promise<number>;
  close(): Promise<void>;
}
