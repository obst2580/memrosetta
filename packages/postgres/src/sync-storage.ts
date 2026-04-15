/**
 * ISyncStorage interface for the sync server persistence layer.
 *
 * Defined locally because @memrosetta/types does not export it yet.
 * Once ISyncStorage is added to @memrosetta/types, this local
 * definition should be removed in favor of the shared one.
 */

import type {
  SyncOp,
  SyncPushResult,
  SyncPulledOp,
} from '@memrosetta/types';

export interface ISyncStorage {
  /** Create tables if they do not exist. */
  initialize(): Promise<void>;

  /**
   * Persist a batch of ops.
   * Returns one result per op: accepted (with new cursor) or duplicate.
   */
  pushOps(
    userId: string,
    ops: readonly SyncOp[],
  ): Promise<readonly SyncPushResult[]>;

  /**
   * Retrieve ops after `since` cursor, up to `limit`.
   * `hasMore` is true when additional ops remain.
   */
  pullOps(
    userId: string,
    since: number,
    limit: number,
  ): Promise<{ readonly ops: readonly SyncPulledOp[]; readonly hasMore: boolean }>;

  /** Return the highest cursor for a user (0 if none). */
  getHighWatermark(userId: string): Promise<number>;

  /** Release connection pool resources. */
  close(): Promise<void>;
}
