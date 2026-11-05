import type { NextFunction, Request, Response } from 'express';

/**
 * Cabeceras de seguridad básicas (sin dependencias externas).
 * SAMEORIGIN en lugar de DENY: permite embeber el dashboard en páginas del mismo origen.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

/** Las respuestas de la API contienen datos clínicos: que no queden en cachés intermedias ni del navegador. */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
