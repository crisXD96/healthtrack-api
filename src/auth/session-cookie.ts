import type { Request, Response } from 'express';
import { config } from '../config';

/**
 * Sesión por cookie HttpOnly: el JavaScript del navegador no puede leer el JWT,
 * así que un XSS no puede robarlo. SameSite=Strict impide que otros sitios la envíen (CSRF).
 * El header `Authorization: Bearer` sigue funcionando para clientes de API (curl, tests).
 */
function cookieAttributes(maxAgeSeconds: number): string {
  const attrs = [`Path=/api`, `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Strict'];
  if (config.isProduction) attrs.push('Secure');
  return attrs.join('; ');
}

export function setSessionCookie(res: Response, token: string): void {
  res.append('Set-Cookie', `${config.session.cookieName}=${encodeURIComponent(token)}; ${cookieAttributes(config.session.maxAgeSeconds)}`);
}

export function clearSessionCookie(res: Response): void {
  res.append('Set-Cookie', `${config.session.cookieName}=; ${cookieAttributes(0)}`);
}

/** Lee el JWT de la cookie de sesión (sin dependencias: parseo mínimo del header Cookie). */
export function readSessionToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === config.session.cookieName) {
      const value = part.slice(eq + 1).trim();
      try {
        return value ? decodeURIComponent(value) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}
