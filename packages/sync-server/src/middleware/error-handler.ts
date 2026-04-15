import type { ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: ContentfulStatusCode = 500,
    readonly userMessage?: string,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof ZodError) {
    return c.json(
      {
        success: false as const,
        error: 'Validation error',
        details: err.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
      },
      400,
    );
  }

  if (err instanceof AppError) {
    return c.json(
      {
        success: false as const,
        error: err.userMessage ?? 'An error occurred',
      },
      err.statusCode,
    );
  }

  process.stderr.write(`[sync-server] Internal error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  return c.json({ success: false as const, error: 'Internal server error' }, 500);
};
