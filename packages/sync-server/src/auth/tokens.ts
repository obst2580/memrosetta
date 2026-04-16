import { createHash, randomBytes } from 'node:crypto';
import type { SessionTokens } from '../storage.js';

const ACCESS_PREFIX = 'mrs_at_';
const REFRESH_PREFIX = 'mrs_rt_';
const ACCESS_TTL_MS = 60 * 60 * 1000; // 1h
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90d

export function generateSessionTokens(now = new Date()): SessionTokens {
  return {
    accessToken: `${ACCESS_PREFIX}${randomBytes(24).toString('base64url')}`,
    refreshToken: `${REFRESH_PREFIX}${randomBytes(32).toString('base64url')}`,
    accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_MS).toISOString(),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS).toISOString(),
  };
}

export function isAccessToken(value: string): boolean {
  return value.startsWith(ACCESS_PREFIX);
}

export function isRefreshToken(value: string): boolean {
  return value.startsWith(REFRESH_PREFIX);
}

export function hashOpaqueToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
