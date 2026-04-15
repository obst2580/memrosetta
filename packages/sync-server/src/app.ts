import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ISyncStorage } from './storage.js';
import { apiKeyAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { pushRoutes } from './routes/push.js';
import { pullRoutes } from './routes/pull.js';
import { healthRoutes } from './routes/health.js';

export interface SyncAppContext {
  readonly storage: ISyncStorage;
}

export function createApp(storage: ISyncStorage): Hono {
  const app = new Hono();

  // Middleware
  const allowedOrigins = process.env.CORS_ORIGINS?.split(',').filter(Boolean) ?? [];
  app.use('*', cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : ['http://localhost:8081', 'http://127.0.0.1:8081'],
  }));
  app.use('/sync/push', apiKeyAuth());
  app.use('/sync/pull', apiKeyAuth());
  app.onError(errorHandler);

  const ctx: SyncAppContext = { storage };

  // Routes
  app.route('/sync', healthRoutes(ctx));
  app.route('/sync', pushRoutes(ctx));
  app.route('/sync', pullRoutes(ctx));

  return app;
}
