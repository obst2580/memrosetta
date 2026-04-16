import type { ISyncStorage as BaseSyncStorage } from '@memrosetta/types';

export type OAuthProvider = 'github' | 'google';

export interface AuthenticatedUser {
  readonly userId: string;
  readonly provider: OAuthProvider;
  readonly providerSubject: string;
  readonly email: string | null;
  readonly displayName: string | null;
}

export interface DeviceAuthStart {
  readonly provider: OAuthProvider;
  readonly deviceId: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly intervalSeconds: number;
  readonly expiresAt: string;
  readonly providerDeviceCode: string;
}

export interface StoredDeviceAuthRequest extends DeviceAuthStart {
  readonly id: string;
  readonly status: 'pending' | 'completed' | 'expired';
  readonly createdAt: string;
  readonly completedAt?: string | null;
}

export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt: string;
  readonly refreshExpiresAt: string;
}

export interface AuthStorage {
  createDeviceAuthRequest(input: DeviceAuthStart): Promise<StoredDeviceAuthRequest>;
  getDeviceAuthRequest(id: string): Promise<StoredDeviceAuthRequest | null>;
  markDeviceAuthRequestCompleted(id: string): Promise<void>;
  markDeviceAuthRequestExpired(id: string): Promise<void>;

  upsertAuthenticatedUser(user: AuthenticatedUser): Promise<{ readonly userId: string }>;

  createSession(
    userId: string,
    deviceId: string,
    tokens: SessionTokens,
  ): Promise<void>;

  refreshSession(
    refreshToken: string,
    nextTokens: SessionTokens,
  ): Promise<{ readonly userId: string; readonly deviceId: string } | null>;

  getSessionByAccessToken(
    accessToken: string,
  ): Promise<{ readonly userId: string; readonly deviceId: string } | null>;

  revokeSessionByAccessToken(accessToken: string): Promise<boolean>;
}

export interface ISyncStorage extends BaseSyncStorage, AuthStorage {}
