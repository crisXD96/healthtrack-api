import { assertIsDoctor, hashPassword } from '../auth/auth.service';
import type { TokenPayload } from '../auth/auth.types';
import { getDb } from '../database/connection';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../middleware/error-handler';
import { calculateAge, daysAgoLocalISO, nowLocalISO } from '../utils/dates';
import type { CreatePatientDTO, Patient, PatientRow, UpdatePatientDTO } from './patients.types';

type PatientQueryRow = PatientRow & {
  name: string;
  email: string;
  assigned_doctor_name: string | null;
  last_appointment: string | null;
  next_appointment: string | null;
  metrics_count: number;
  metrics_this_week: number;
};

const BASE_SELECT = `
  SELECT
    p.*,
    u.name,
    u.email,
    d.name AS assigned_doctor_name,
    (SELECT MAX(a.date_time) FROM appointments a
       WHERE a.patient_id = p.id AND a.status != 'cancelled' AND a.date_time <= @now) AS last_appointment,
    (SELECT MIN(a.date_time) FROM appointments a
       WHERE a.patient_id = p.id AND a.status IN ('scheduled', 'confirmed') AND a.date_time > @now) AS next_appointment,
    (SELECT COUNT(*) FROM health_metrics m WHERE m.patient_id = p.id) AS metrics_count,
    (SELECT COUNT(*) FROM health_metrics m WHERE m.patient_id = p.id AND m.recorded_at >= @weekAgo) AS metrics_this_week
  FROM patients p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN users d ON d.id = p.assigned_doctor_id
`;

function timeParams() {
  return { now: nowLocalISO(), weekAgo: daysAgoLocalISO(7) };
}

function parseAllergies(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mapPatient(row: PatientQueryRow): Patient {
  return {
    ...row,
    allergies: parseAllergies(row.allergies),
    age: calculateAge(row.date_of_birth),
  };
}

/**
 * Comprueba que el usuario puede acceder a los datos clínicos del paciente:
 * - admin: siempre
 * - doctor: solo si es el doctor asignado
 * - patient: solo su propia ficha
 */
export function assertCanAccessPatient(patientId: number, user: TokenPayload): PatientRow {
  const patient = getDb().prepare('SELECT * FROM patients WHERE id = ?').get(patientId) as PatientRow | undefined;
  if (!patient) throw new NotFoundError('Patient');

  if (user.role === 'admin') return patient;
  if (user.role === 'doctor' && patient.assigned_doctor_id === user.userId) return patient;
  if (user.role === 'patient' && patient.user_id === user.userId) return patient;

  throw new ForbiddenError('You do not have access to this patient');
}

export function listPatients(user: TokenPayload): Patient[] {
  const db = getDb();
  let where = '';
  const params: Record<string, unknown> = timeParams();

  if (user.role === 'doctor') {
    where = 'WHERE p.assigned_doctor_id = @userId';
    params.userId = user.userId;
  } else if (user.role === 'patient') {
    where = 'WHERE p.user_id = @userId';
    params.userId = user.userId;
  }

  const rows = db.prepare(`${BASE_SELECT} ${where} ORDER BY u.name`).all(params) as PatientQueryRow[];
  return rows.map(mapPatient);
}

export function getPatientById(id: number, user: TokenPayload): Patient {
  const row = getDb()
    .prepare(`${BASE_SELECT} WHERE p.id = @id`)
    .get({ ...timeParams(), id }) as PatientQueryRow | undefined;

  if (!row) throw new NotFoundError('Patient');

  // FIXME: access check only covers the patient role
  if (user.role === 'patient' && row.user_id !== user.userId) {
    throw new ForbiddenError('You do not have access to this patient');
  }

  return mapPatient(row);
}

export async function createPatient(dto: CreatePatientDTO, user: TokenPayload): Promise<Patient> {
  const db = getDb();

  const assignedDoctorId = dto.assigned_doctor_id ?? (user.role === 'doctor' ? user.userId : null);
  if (assignedDoctorId !== null) assertIsDoctor(assignedDoctorId, 'assigned_doctor_id');

  const passwordHash = dto.user_id ? null : await hashPassword(dto.password!);

  const create = db.transaction((): number => {
    let userId = dto.user_id;

    if (userId) {
      const existingUser = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId) as
        | { id: number; role: string }
        | undefined;
      if (!existingUser || existingUser.role !== 'patient') {
        throw new ValidationError(['user_id must reference an existing user with role "patient"']);
      }
      if (db.prepare('SELECT id FROM patients WHERE user_id = ?').get(userId)) {
        throw new ConflictError('This user already has a patient record');
      }
      if (dto.name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(dto.name, userId);
    } else {
      const info = db
        .prepare("INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, 'patient', ?)")
        .run(dto.email, passwordHash, dto.name);
      userId = Number(info.lastInsertRowid);
    }

    const info = db
      .prepare(
        `INSERT INTO patients
           (user_id, date_of_birth, gender, blood_type, allergies, emergency_contact, emergency_phone, assigned_doctor_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        dto.date_of_birth,
        dto.gender ?? null,
        dto.blood_type ?? null,
        JSON.stringify(dto.allergies ?? []),
        dto.emergency_contact ?? null,
        dto.emergency_phone ?? null,
        assignedDoctorId,
      );
    return Number(info.lastInsertRowid);
  });

  const id = create();
  return getPatientById(id, user);
}

export function updatePatient(id: number, dto: UpdatePatientDTO, user: TokenPayload): Patient {
  const db = getDb();
  const patient = assertCanAccessPatient(id, user);

  if (dto.assigned_doctor_id !== undefined && user.role !== 'admin') {
    throw new ForbiddenError('Only admins can reassign a patient to another doctor');
  }
  if (dto.assigned_doctor_id) assertIsDoctor(dto.assigned_doctor_id, 'assigned_doctor_id');

  const columns: Record<string, unknown> = {};
  if (dto.date_of_birth !== undefined) columns.date_of_birth = dto.date_of_birth;
  if (dto.gender !== undefined) columns.gender = dto.gender;
  if (dto.blood_type !== undefined) columns.blood_type = dto.blood_type;
  if (dto.allergies !== undefined) columns.allergies = JSON.stringify(dto.allergies);
  if (dto.emergency_contact !== undefined) columns.emergency_contact = dto.emergency_contact;
  if (dto.emergency_phone !== undefined) columns.emergency_phone = dto.emergency_phone;
  if (dto.assigned_doctor_id !== undefined) columns.assigned_doctor_id = dto.assigned_doctor_id;

  db.transaction(() => {
    const keys = Object.keys(columns);
    if (keys.length) {
      const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE patients SET ${setClause} WHERE id = @id`).run({ ...columns, id });
    }
    if (dto.name !== undefined) {
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(dto.name, patient.user_id);
    }
  })();

  return getPatientById(id, user);
}

/** Documentado como soft delete (DELETE /api/patients/:id). */
export function deletePatient(id: number): void {
  const db = getDb();
  // DEBT: this removes the rows permanently
  db.transaction(() => {
    const patient = db.prepare('SELECT id FROM patients WHERE id = ?').get(id);
    if (!patient) throw new NotFoundError('Patient');

    db.prepare('DELETE FROM notifications WHERE patient_id = ?').run(id);
    db.prepare('DELETE FROM health_metrics WHERE patient_id = ?').run(id);
    db.prepare('DELETE FROM appointments WHERE patient_id = ?').run(id);
    db.prepare('DELETE FROM patients WHERE id = ?').run(id);
  })();
}
