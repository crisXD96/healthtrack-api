import path from 'path';

const env = process.env.NODE_ENV ?? 'development';

/**
 * Configuración centralizada de la aplicación.
 * Todos los valores configurables por entorno se leen aquí.
 */
export const config = {
  env,
  isProduction: env === 'production',
  isTest: env === 'test',

  port: Number(process.env.PORT ?? 3000),

  /** Ruta del archivo SQLite. Usa ':memory:' para tests. */
  dbPath: process.env.DB_PATH ?? path.join(process.cwd(), 'healthtrack.db'),

  /** Si la BD está vacía al arrancar, se ejecuta el seed automáticamente. */
  autoSeed: process.env.AUTO_SEED !== 'false',

  /** Carpeta de estáticos (funciona tanto desde src/ con tsx como desde dist/). */
  publicDir: path.join(__dirname, '..', 'public'),

  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    expiresIn: '24h',
  },

  /** Cookie de sesión HttpOnly (el dashboard la usa en lugar de guardar el JWT en localStorage). */
  session: {
    cookieName: 'ht_session',
    maxAgeSeconds: 24 * 60 * 60, // igual que jwt.expiresIn
  },

  bcryptRounds: env === 'test' ? 4 : 10,

  rateLimit: {
    windowMs: 60_000,
    maxRequests: env === 'test' ? 10_000 : 100,
  },

  cors: {
    allowedOrigin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  },
} as const;
