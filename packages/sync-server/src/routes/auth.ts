import { Hono } from 'hono';
import { z } from 'zod';
import type { SyncAppContext } from '../app.js';
import { startProviderDeviceFlow, pollProviderDeviceFlow } from '../auth/providers.js';
import { generateSessionTokens, isRefreshToken } from '../auth/tokens.js';

const providerSchema = z.enum(['github', 'google']);

const startSchema = z.object({
  provider: providerSchema,
  deviceId: z.string().min(1),
});

const pollSchema = z.object({
  deviceRequestId: z.string().uuid(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export function authRoutes(ctx: SyncAppContext): Hono {
  const router = new Hono();

  router.post('/device/start', async (c) => {
    const body = startSchema.parse(await c.req.json());
    const started = await startProviderDeviceFlow(body.provider, body.deviceId);
    const stored = await ctx.storage.createDeviceAuthRequest(started);

    return c.json({
      success: true as const,
      data: {
        deviceRequestId: stored.id,
        provider: stored.provider,
        userCode: stored.userCode,
        verificationUri: stored.verificationUri,
        intervalSeconds: stored.intervalSeconds,
        expiresAt: stored.expiresAt,
      },
    });
  });

  router.post('/device/poll', async (c) => {
    const body = pollSchema.parse(await c.req.json());
    const request = await ctx.storage.getDeviceAuthRequest(body.deviceRequestId);
    if (!request) {
      return c.json({ success: false, error: 'Unknown device request' }, 404);
    }

    if (request.status === 'completed') {
      return c.json({ success: false, error: 'Device request already completed' }, 409);
    }

    if (request.status === 'expired' || new Date(request.expiresAt).getTime() <= Date.now()) {
      await ctx.storage.markDeviceAuthRequestExpired(request.id);
      return c.json({ success: false, error: 'Device request expired' }, 410);
    }

    const polled = await pollProviderDeviceFlow(request.provider, request.providerDeviceCode);

    if (polled.status === 'pending') {
      return c.json({
        success: true as const,
        data: {
          status: 'pending',
          intervalSeconds: polled.intervalSeconds ?? request.intervalSeconds,
        },
      });
    }

    if (polled.status === 'denied') {
      await ctx.storage.markDeviceAuthRequestCompleted(request.id);
      return c.json({ success: false, error: polled.reason }, 403);
    }

    if (polled.status === 'expired') {
      await ctx.storage.markDeviceAuthRequestExpired(request.id);
      return c.json({ success: false, error: polled.reason }, 410);
    }

    const upserted = await ctx.storage.upsertAuthenticatedUser(polled.user);
    const tokens = generateSessionTokens();
    await ctx.storage.createSession(upserted.userId, request.deviceId, tokens);
    await ctx.storage.markDeviceAuthRequestCompleted(request.id);

    return c.json({
      success: true as const,
      data: {
        status: 'approved',
        provider: polled.user.provider,
        accountEmail: polled.user.email,
        displayName: polled.user.displayName,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.accessExpiresAt,
      },
    });
  });

  router.post('/refresh', async (c) => {
    const body = refreshSchema.parse(await c.req.json());
    if (!isRefreshToken(body.refreshToken)) {
      return c.json({ success: false, error: 'Invalid refresh token format' }, 401);
    }

    const nextTokens = generateSessionTokens();
    const refreshed = await ctx.storage.refreshSession(body.refreshToken, nextTokens);
    if (!refreshed) {
      return c.json({ success: false, error: 'Invalid or expired refresh token' }, 401);
    }

    return c.json({
      success: true as const,
      data: {
        accessToken: nextTokens.accessToken,
        refreshToken: nextTokens.refreshToken,
        tokenExpiresAt: nextTokens.accessExpiresAt,
      },
    });
  });

  router.post('/logout', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ success: false, error: 'Missing Authorization header' }, 401);
    }
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return c.json({ success: false, error: 'Invalid Authorization format. Expected: Bearer <token>' }, 401);
    }
    const ok = await ctx.storage.revokeSessionByAccessToken(parts[1]);
    if (!ok) {
      return c.json({ success: false, error: 'Invalid access token' }, 401);
    }
    return c.json({ success: true as const, data: { revoked: true } });
  });

  return router;
}
