import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { IMemoryEngine } from '@memrosetta/types';
import { memoriesRoutes } from './routes/memories.js';
import { searchRoutes } from './routes/search.js';
import { relationsRoutes } from './routes/relations.js';
import { healthRoutes } from './routes/health.js';
import { workingMemoryRoutes } from './routes/working-memory.js';
import { qualityRoutes } from './routes/quality.js';
import { errorHandler } from './middleware/error-handler.js';
import { apiKeyAuthMiddleware } from './middleware/api-key-auth.js';

export interface AppContext {
  readonly engine: IMemoryEngine;
}

export interface CreateAppOptions {
  readonly apiKeys?: readonly string[];
}

export function createApp(engine: IMemoryEngine, options: CreateAppOptions = {}): Hono {
  const app = new Hono();

  // Middleware
  const allowedOrigins = process.env.CORS_ORIGINS?.split(',').filter(Boolean) ?? [];
  app.use('*', cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : ['http://localhost:3100', 'http://127.0.0.1:3100'],
  }));
  if ((options.apiKeys?.length ?? 0) > 0) {
    app.use('/api/*', apiKeyAuthMiddleware(options.apiKeys ?? []));
  }
  app.onError(errorHandler);

  // Store engine in context via closure
  const ctx: AppContext = { engine };

  // Routes
  app.route('/api', healthRoutes());
  app.route('/api', memoriesRoutes(ctx));
  app.route('/api', searchRoutes(ctx));
  app.route('/api', relationsRoutes(ctx));
  app.route('/api', workingMemoryRoutes(ctx));
  app.route('/api', qualityRoutes(ctx));

  return app;
}
