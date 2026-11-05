import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from '../config';

/**
 * Formato de error de la API:
 *   { "error": { "code": "SOME_CODE", "message": "Human readable", "details"?: [...] } }
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(details: string[]) {
    super(400, 'VALIDATION_ERROR', 'Invalid request data', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, 'NOT_FOUND', `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

/** Envuelve handlers async para que los errores lleguen al error handler (Express 4). */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found` },
  });
}

interface SqliteLikeError extends Error {
  code?: string;
}

function isSqliteError(err: unknown): err is SqliteLikeError {
  return err instanceof Error && typeof (err as SqliteLikeError).code === 'string' && (err as SqliteLikeError).code!.startsWith('SQLITE_');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  // JSON malformado en el body (body-parser)
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON in request body' } });
    return;
  }

  if (isSqliteError(err)) {
    console.error(`[db-error] ${req.method} ${req.originalUrl}:`, err.message);
    // FIXME: in non-production the raw SQLite error is returned as-is
    if (!config.isProduction) {
      res.status(500).json({
        error: {
          code: 'DATABASE_ERROR',
          message: err.message,
          sqliteCode: err.code,
          stack: err.stack,
        },
      });
      return;
    }
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'A database error occurred' } });
    return;
  }

  if (!config.isTest) console.error('[error]', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}
