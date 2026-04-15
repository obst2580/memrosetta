export interface SyncOp {
  readonly opId: string;
  readonly opType: string;
  readonly deviceId: string;
  readonly userId: string;
  readonly payload: string;
  readonly createdAt: string;
  readonly pushedAt?: string | null;
}

export interface SyncPulledOp {
  readonly opId: string;
  readonly opType: string;
  readonly deviceId: string;
  readonly userId: string;
  readonly payload: string;
  readonly createdAt: string;
}

export interface SyncConfig {
  readonly serverUrl: string;
  readonly apiKey: string;
  readonly deviceId: string;
  readonly userId: string;
}

export interface SyncPushResponse {
  readonly pushed: number;
  readonly acknowledged: readonly string[];
}

export interface ServerPushResponse {
  readonly acknowledged: readonly string[];
}

export interface ServerPullResponse {
  readonly ops: readonly SyncPulledOp[];
  readonly cursor?: string;
}
