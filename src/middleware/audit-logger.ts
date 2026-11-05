import type { NextFunction, Request, Response } from 'express';
import { getDb } from '../database/connection';
import { nowLocalISO } from '../utils/dates';

interface AuditAction {
  action: string;
  resource: string;
  resourceId: number | null;
}

const METHOD_ACTIONS: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

/** Lecturas de datos clínicos sensibles que también se auditan. */
const AUDITED_READ_RESOURCES = new Set(['patients', 'health-metrics']);

function resolveAction(req: Request, statusCode: number): AuditAction | null {
  const path = req.originalUrl.split('?')[0];
  const [, api, resource, rawId] = path.split('/');
  if (api !== 'api' || !resource) return null;

  const id = Number(rawId);
  const resourceId = Number.isInteger(id) && id > 0 ? id : null;

  if (resource === 'auth') {
    if (rawId === 'login') return { action: statusCode < 400 ? 'login' : 'login_failed', resource: 'auth', resourceId: null };
    if (rawId === 'register') return { action: 'register', resource: 'auth', resourceId: null };
    if (rawId === 'logout') return { action: 'logout', resource: 'auth', resourceId: null };
    return null;
  }

  if (req.method === 'GET') {
    if (AUDITED_READ_RESOURCES.has(resource) && resourceId !== null) {
      return { action: 'read', resource, resourceId };
    }
    return null;
  }

  const action = METHOD_ACTIONS[req.method];
  return action ? { action, resource, resourceId } : null;
}

/**
 * Registra en audit_log las acciones relevantes cuando la respuesta termina.
 * Las rutas pueden fijar res.locals.auditUserId (p. ej. login) o
 * res.locals.auditResourceId (p. ej. recurso recién creado).
 */
export function auditLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();

  res.on('finish', () => {
    const entry = resolveAction(req, res.statusCode);
    if (!entry) return;

    const userId = req.user?.userId ?? (res.locals.auditUserId as number | undefined) ?? null;
    const resourceId = entry.resourceId ?? (res.locals.auditResourceId as number | undefined) ?? null;
    const details = JSON.stringify({
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Date.now() - startedAt,
    });

    try {
      getDb()
        .prepare(
          `INSERT INTO audit_log (user_id, action, resource, resource_id, details, ip_address, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, entry.action, entry.resource, resourceId, details, req.ip ?? null, nowLocalISO());
    } catch (err) {
      console.error('[audit] failed to write audit log entry:', (err as Error).message);
    }
  });

  next();
}
