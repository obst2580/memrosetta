import type { ISyncStorage as BaseSyncStorage } from '@memrosetta/types';

export interface AuthenticatedUser {
  readonly ownerUserId: string;
  readonly email: string;
  readonly roles: readonly string[];
}

export interface AuthStorage {
  upsertAuthenticatedUser(user: AuthenticatedUser): Promise<void>;
}

export interface ISyncStorage extends BaseSyncStorage, AuthStorage {}
