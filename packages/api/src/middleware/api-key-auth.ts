import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

function extractApiKey(headers: {
  readonly xApiKey?: string;
  readonly authorization?: string;
}): string | null {
  if (headers.xApiKey) {
    return headers.xApiKey;
  }

  if (!headers.authorization) {
    return null;
  }

  const [scheme, value] = headers.authorization.split(' ', 2);
  if (scheme?.toLowerCase() !== 'bearer' || !value) {
    return null;
  }

  return value;
}

function matchesApiKey(expected: string, provided: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function apiKeyAuthMiddleware(apiKeys: readonly string[]): MiddlewareHandler {
  const validKeys = apiKeys.map(key => key.trim()).filter(Boolean);

  return async (c, next) => {
    if (c.req.method === 'OPTIONS' || c.req.path === '/api/health') {
      await next();
      return;
    }

    const provided = extractApiKey({
      xApiKey: c.req.header('x-api-key'),
      authorization: c.req.header('authorization'),
    });

    if (!provided || !validKeys.some(expected => matchesApiKey(expected, provided))) {
      return c.json({ success: false as const, error: 'Unauthorized' }, 401);
    }

    await next();
  };
}
