import type { MiddlewareHandler } from 'hono';

export function apiKeyAuth(): MiddlewareHandler {
  const keysEnv = process.env.MEMROSETTA_API_KEYS ?? '';
  const validKeys: ReadonlySet<string> = new Set(
    keysEnv.split(',').map(k => k.trim()).filter(Boolean),
  );

  return async (c, next) => {
    // Skip auth if no keys are configured (development mode)
    if (validKeys.size === 0) {
      await next();
      return;
    }

    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ success: false, error: 'Missing Authorization header' }, 401);
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return c.json({ success: false, error: 'Invalid Authorization format. Expected: Bearer <api_key>' }, 401);
    }

    const apiKey = parts[1];
    if (!validKeys.has(apiKey)) {
      return c.json({ success: false, error: 'Invalid API key' }, 401);
    }

    await next();
  };
}
