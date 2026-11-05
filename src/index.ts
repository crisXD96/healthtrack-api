import cors from 'cors';
import express, { type Express } from 'express';
import appointmentsRoutes from './appointments/appointments.routes';
import authRoutes from './auth/auth.routes';
import { config } from './config';
import { closeDb, getDb } from './database/connection';
import { runMigrations } from './database/migrations';
import { seedDatabase } from './database/seed';
import metricsRoutes from './health-metrics/metrics.routes';
import { auditLogger } from './middleware/audit-logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { rateLimiter } from './middleware/rate-limiter';
import { noStore, securityHeaders } from './middleware/security-headers';
import notificationsRoutes from './notifications/notifications.routes';
import patientsRoutes from './patients/patients.routes';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(
    cors({
      origin: (origin, callback) => {
        // Peticiones sin Origin (curl, mismo origen) o desde localhost
        callback(null, !origin || config.cors.allowedOrigin.test(origin));
      },
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  // Dashboard (SPA estática)
  app.use(express.static(config.publicDir));

  app.use('/api', noStore);

  app.get('/api/health', (_req, res) => {
    res.json({ data: { status: 'ok', timestamp: new Date().toISOString() } });
  });

  app.use('/api', rateLimiter, auditLogger);
  app.use('/api/auth', authRoutes);
  app.use('/api/patients', patientsRoutes);
  app.use('/api/appointments', appointmentsRoutes);
  app.use('/api/health-metrics', metricsRoutes);
  app.use('/api/notifications', notificationsRoutes);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}

export function start(): void {
  const db = getDb();
  const applied = runMigrations(db);
  if (applied) console.log(`[db] applied ${applied} migration(s)`);

  if (config.autoSeed) {
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    if (count === 0) {
      console.log('[db] empty database detected, loading seed data...');
      const summary = seedDatabase(db);
      console.log('[db] seed complete:', summary);
    }
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`HealthTrack API running at http://localhost:${config.port} (${config.env})`);
  });

  // Apagado ordenado: deja de aceptar conexiones y cierra SQLite (vuelca el WAL) antes de salir.
  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} received, shutting down...`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

const isEntryPoint = typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module;
if (isEntryPoint) {
  start();
}
