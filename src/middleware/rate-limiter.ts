import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';

interface Bucket {
  count: number;
  resetAt: number;
}

/** Rate limiting básico in-memory por IP (ventana fija). */
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

/** Elimina las ventanas caducadas para que el Map no crezca sin límite con IPs que no vuelven. */
function sweepExpired(now: number, windowMs: number): void {
  if (now - lastSweep < windowMs) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const { windowMs, maxRequests } = config.rateLimit;
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  sweepExpired(now, windowMs);

  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count++;

  const remaining = Math.max(0, maxRequests - bucket.count);
  const resetSeconds = Math.ceil((bucket.resetAt - now) / 1000);
  res.setHeader('X-RateLimit-Limit', String(maxRequests));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(resetSeconds));

  if (bucket.count > maxRequests) {
    res.setHeader('Retry-After', String(resetSeconds));
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
    });
    return;
  }

  next();
}

export function resetRateLimiter(): void {
  buckets.clear();
  lastSweep = Date.now();
}
