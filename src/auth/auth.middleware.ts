import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../middleware/error-handler';
import { verifyToken } from './auth.service';
import type { Role } from './auth.types';
import { readSessionToken } from './session-cookie';

/**
 * Autentica con `Authorization: Bearer <jwt>` (clientes de API) o, si no hay header,
 * con la cookie de sesión HttpOnly (dashboard). Adjunta req.user.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  let token: string | null = null;
  if (header) {
    if (!header.startsWith('Bearer ')) {
      next(new UnauthorizedError('Missing or invalid Authorization header'));
      return;
    }
    token = header.slice('Bearer '.length).trim();
  } else {
    token = readSessionToken(req);
  }
  if (!token) {
    next(new UnauthorizedError('Missing or invalid Authorization header'));
    return;
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    next(err);
  }
}

/** Restringe la ruta a los roles indicados. Debe usarse después de authenticate. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError(`This action requires role: ${roles.join(' or ')}`));
      return;
    }
    next();
  };
}
