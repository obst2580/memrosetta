import type { ErrorHandler } from 'hono';
import { ZodError } from 'zod';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof ZodError) {
    return c.json(
      {
        success: false as const,
        error: 'Validation error',
        details: err.errors,
      },
      400,
    );
  }

  const message = err instanceof Error ? err.message : 'Internal server error';
  const status =
    message.includes('not found') || message.includes('Not found') ? 404 : 500;

  return c.json({ success: false as const, error: message }, status);
};
