import bcrypt from 'bcryptjs';
import { beforeAll, beforeEach } from 'vitest';
import { signToken } from '../src/auth/auth.service';
import type { Role } from '../src/auth/auth.types';
import { getDb } from '../src/database/connection';
import { runMigrations } from '../src/database/migrations';
import { resetRateLimiter } from '../src/middleware/rate-limiter';

/**
 * Setup global de tests.
 * vitest.config.ts fija DB_PATH=':memory:', así que cada archivo de test
 * trabaja con su propia base de datos SQLite en memoria.
 */

beforeAll(() => {
  runMigrations(getDb());
});

beforeEach(() => {
  clearDatabase();
  resetRateLimiter();
});

export function clearDatabase(): void {
  getDb().exec(`
    DELETE FROM audit_log;
    DELETE FROM notifications;
    DELETE FROM health_metrics;
    DELETE FROM appointments;
    DELETE FROM patients;
    DELETE FROM users;
  `);
}

export interface TestUser {
  id: number;
  email: string;
  password: string;
  name: string;
  role: Role;
  token: string;
}

let counter = 0;

export function createTestUser(role: Role, overrides: Partial<Pick<TestUser, 'email' | 'name' | 'password'>> = {}): TestUser {
  counter++;
  const email = overrides.email ?? `${role}${counter}@test.com`;
  const name = overrides.name ?? `Test ${role} ${counter}`;
  const password = overrides.password ?? 'Password123!';

  const info = getDb()
    .prepare('INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)')
    .run(email, bcrypt.hashSync(password, 4), role, name);
  const id = Number(info.lastInsertRowid);

  return { id, email, password, name, role, token: signToken({ id, email, role, name }) };
}

export function createTestPatientRecord(userId: number, doctorId: number | null): number {
  const info = getDb()
    .prepare(
      `INSERT INTO patients (user_id, date_of_birth, gender, blood_type, allergies, assigned_doctor_id)
       VALUES (?, '1980-01-15', 'female', 'O+', '["Penicillin"]', ?)`,
    )
    .run(userId, doctorId);
  return Number(info.lastInsertRowid);
}
