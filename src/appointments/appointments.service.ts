import { assertIsDoctor } from '../auth/auth.service';
import type { TokenPayload } from '../auth/auth.types';
import { getDb } from '../database/connection';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../middleware/error-handler';
import { assertCanAccessPatient } from '../patients/patients.service';
import { parseLocal, toLocalISO } from '../utils/dates';
import {
  BUSINESS_HOURS,
  STATUS_TRANSITIONS,
  type Appointment,
  type AppointmentFilters,
  type CreateAppointmentDTO,
  type UpdateAppointmentDTO,
} from './appointments.types';

const BASE_SELECT = `
  SELECT
    a.*,
    pu.name AS patient_name,
    d.name AS doctor_name,
    p.user_id AS patient_user_id,
    p.assigned_doctor_id
  FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  JOIN users pu ON pu.id = p.user_id
  JOIN users d ON d.id = a.doctor_id
`;

function canAccess(appointment: Appointment, user: TokenPayload): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'doctor') {
    return appointment.doctor_id === user.userId || appointment.assigned_doctor_id === user.userId;
  }
  return appointment.patient_user_id === user.userId;
}

function assertInFuture(dateTime: string): void {
  if (parseLocal(dateTime).getTime() <= Date.now()) {
    throw new ValidationError(['date_time must be in the future']);
  }
}

/**
 * Valida horario de consulta y solapamiento con otras citas activas del doctor.
 */
function assertSlotAvailable(doctorId: number, dateTime: string, durationMinutes: number, excludeId?: number): void {
  const start = parseLocal(dateTime);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = startMinutes + durationMinutes;

  if (startMinutes < BUSINESS_HOURS.startHour * 60 || endMinutes > BUSINESS_HOURS.endHour * 60) {
    throw new ValidationError([
      `Appointments must start and end between ${String(BUSINESS_HOURS.startHour).padStart(2, '0')}:00 and ${BUSINESS_HOURS.endHour}:00`,
    ]);
  }

  const end = toLocalISO(new Date(start.getTime() + durationMinutes * 60_000));
  const conflict = getDb()
    .prepare(
      `SELECT id, date_time FROM appointments
       WHERE doctor_id = @doctorId
         AND status IN ('scheduled', 'confirmed')
         AND id != @excludeId
         AND julianday(date_time) < julianday(@end)
         AND julianday(date_time, '+' || duration_minutes || ' minutes') > julianday(@start)
       LIMIT 1`,
    )
    .get({ doctorId, excludeId: excludeId ?? -1, start: toLocalISO(start), end }) as
    | { id: number; date_time: string }
    | undefined;

  if (conflict) {
    throw new ConflictError(`The doctor already has an appointment at ${conflict.date_time.replace('T', ' ').slice(0, 16)}`);
  }
}

export function listAppointments(user: TokenPayload, filters: AppointmentFilters): Appointment[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (user.role === 'doctor') {
    // Misma regla que canAccess(): sus propias citas y las de sus pacientes asignados (aunque las atienda otro doctor).
    where.push('(a.doctor_id = @userId OR p.assigned_doctor_id = @userId)');
    params.userId = user.userId;
  } else if (user.role === 'patient') {
    where.push('p.user_id = @userId');
    params.userId = user.userId;
  }

  if (filters.status) {
    where.push('a.status = @status');
    params.status = filters.status;
  }
  if (filters.patientId) {
    where.push('a.patient_id = @patientId');
    params.patientId = filters.patientId;
  }
  if (filters.dateFrom) {
    where.push('a.date_time >= @dateFrom');
    params.dateFrom = filters.dateFrom;
  }
  if (filters.dateTo) {
    where.push('a.date_time <= @dateTo');
    params.dateTo = filters.dateTo;
  }

  const sql = `${BASE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.date_time ASC`;
  return getDb().prepare(sql).all(params) as Appointment[];
}

export function getAppointment(id: number, user: TokenPayload): Appointment {
  const appointment = getDb().prepare(`${BASE_SELECT} WHERE a.id = ?`).get(id) as Appointment | undefined;
  if (!appointment) throw new NotFoundError('Appointment');
  if (!canAccess(appointment, user)) throw new ForbiddenError('You do not have access to this appointment');
  return appointment;
}

export function createAppointment(dto: CreateAppointmentDTO, user: TokenPayload): Appointment {
  const patient = assertCanAccessPatient(dto.patient_id, user);

  const doctorId = dto.doctor_id ?? (user.role === 'doctor' ? user.userId : patient.assigned_doctor_id);
  if (!doctorId) throw new ValidationError(['doctor_id is required (patient has no assigned doctor)']);
  assertIsDoctor(doctorId);

  const duration = dto.duration_minutes ?? 30;
  assertInFuture(dto.date_time);
  assertSlotAvailable(doctorId, dto.date_time, duration);

  const info = getDb()
    .prepare(
      `INSERT INTO appointments (patient_id, doctor_id, date_time, duration_minutes, status, reason)
       VALUES (?, ?, ?, ?, 'scheduled', ?)`,
    )
    .run(dto.patient_id, doctorId, dto.date_time, duration, dto.reason ?? null);

  return getAppointment(Number(info.lastInsertRowid), user);
}

export function updateAppointment(id: number, dto: UpdateAppointmentDTO, user: TokenPayload): Appointment {
  const current = getAppointment(id, user);

  if (user.role === 'patient') {
    const allowedKeys = ['status'];
    const extraKeys = Object.keys(dto).filter((k) => !allowedKeys.includes(k));
    if (extraKeys.length || (dto.status && !['confirmed', 'cancelled'].includes(dto.status))) {
      throw new ForbiddenError('Patients can only confirm or cancel their appointments');
    }
  }

  if (dto.status && dto.status !== current.status && !STATUS_TRANSITIONS[current.status].includes(dto.status)) {
    throw new ValidationError([`Cannot change status from "${current.status}" to "${dto.status}"`]);
  }

  const reschedule = dto.date_time !== undefined || dto.duration_minutes !== undefined;
  if (reschedule) {
    if (current.status === 'completed' || current.status === 'cancelled') {
      throw new ValidationError([`Cannot reschedule a ${current.status} appointment`]);
    }
    const newDateTime = dto.date_time ?? current.date_time;
    const newDuration = dto.duration_minutes ?? current.duration_minutes;
    if (dto.date_time !== undefined) assertInFuture(newDateTime);
    assertSlotAvailable(current.doctor_id, newDateTime, newDuration, id);
  }

  const columns = Object.entries(dto).filter(([, v]) => v !== undefined);
  if (columns.length) {
    const setClause = columns.map(([k]) => `${k} = @${k}`).join(', ');
    getDb()
      .prepare(`UPDATE appointments SET ${setClause} WHERE id = @id`)
      .run({ ...Object.fromEntries(columns), id });
  }

  return getAppointment(id, user);
}

export function cancelAppointment(id: number, user: TokenPayload): Appointment {
  const current = getAppointment(id, user);
  if (current.status === 'completed') {
    throw new ValidationError(['Completed appointments cannot be cancelled']);
  }
  if (current.status !== 'cancelled') {
    getDb().prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?").run(id);
  }
  return getAppointment(id, user);
}
