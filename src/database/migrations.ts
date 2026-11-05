import type Database from 'better-sqlite3';
import { getDb } from './connection';

interface Migration {
  version: number;
  name: string;
  up: string;
}

/**
 * Sistema de migraciones simple: cada migración se aplica una sola vez
 * y queda registrada en la tabla schema_migrations.
 * Para cambios de esquema, añade una nueva entrada con version incremental
 * (y genera el SQL equivalente en db-scripts/ para revisión del DBA).
 */
const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      -- Users: doctores, pacientes, admins
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('doctor', 'patient', 'admin')),
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Patients: datos clínicos del paciente (ligado a user con role=patient)
      CREATE TABLE patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        date_of_birth TEXT NOT NULL,
        gender TEXT CHECK(gender IN ('male', 'female', 'other')),
        blood_type TEXT CHECK(blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
        allergies TEXT,
        emergency_contact TEXT,
        emergency_phone TEXT,
        assigned_doctor_id INTEGER REFERENCES users(id),
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Appointments: citas médicas
      CREATE TABLE appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL REFERENCES patients(id),
        doctor_id INTEGER NOT NULL REFERENCES users(id),
        date_time TEXT NOT NULL,
        duration_minutes INTEGER DEFAULT 30,
        status TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled','confirmed','completed','cancelled')),
        reason TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Health Metrics: métricas de salud registradas
      CREATE TABLE health_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL REFERENCES patients(id),
        metric_type TEXT NOT NULL CHECK(metric_type IN ('blood_pressure','glucose','weight','heart_rate','temperature','oxygen_saturation')),
        value REAL NOT NULL,
        secondary_value REAL,
        unit TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        recorded_by INTEGER REFERENCES users(id),
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Notifications: alertas automáticas
      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL REFERENCES patients(id),
        type TEXT NOT NULL CHECK(type IN ('metric_warning','metric_critical','appointment_reminder','general')),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT DEFAULT 'info' CHECK(severity IN ('info','warning','critical')),
        read INTEGER DEFAULT 0,
        related_metric_id INTEGER REFERENCES health_metrics(id),
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Audit Log: registro de acciones (seguridad/compliance)
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        resource_id INTEGER,
        details TEXT,
        ip_address TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `,
  },
];

export function runMigrations(db: Database.Database = getDb()): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );

  let count = 0;
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.up);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
    })();
    count++;
  }
  return count;
}
