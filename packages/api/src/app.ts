import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { IMemoryEngine } from '@memrosetta/types';
import { memoriesRoutes } from './routes/memories.js';
import { searchRoutes } from './routes/search.js';
import { relationsRoutes } from './routes/relations.js';
import { healthRoutes } from './routes/health.js';
import { errorHandler } from './middleware/error-handler.js';

export interface AppContext {
  readonly engine: IMemoryEngine;
}

export function createApp(engine: IMemoryEngine): Hono {
  const app = new Hono();

  // Middleware
  app.use('*', cors());
  app.onError(errorHandler);

  // Store engine in context via closure
  const ctx: AppContext = { engine };

  // Routes
  app.route('/api', healthRoutes());
  app.route('/api', memoriesRoutes(ctx));
  app.route('/api', searchRoutes(ctx));
  app.route('/api', relationsRoutes(ctx));

  return app;
}
