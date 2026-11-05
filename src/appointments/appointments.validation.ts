import { ValidationError } from '../middleware/error-handler';
import { isValidDateTime, normalizeDateTime } from '../utils/dates';
import { asBody, isOptionalString, isPositiveInt, optionalTrimmed } from '../utils/validation';
import {
  APPOINTMENT_STATUSES,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  type AppointmentFilters,
  type AppointmentStatus,
  type CreateAppointmentDTO,
  type UpdateAppointmentDTO,
} from './appointments.types';

function isValidDuration(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_DURATION_MINUTES &&
    value <= MAX_DURATION_MINUTES
  );
}

export function validateCreateAppointment(input: unknown): CreateAppointmentDTO {
  const body = asBody(input);
  const errors: string[] = [];

  if (!isPositiveInt(body.patient_id)) errors.push('patient_id must be a positive integer');
  if (body.doctor_id !== undefined && body.doctor_id !== null && !isPositiveInt(body.doctor_id)) {
    errors.push('doctor_id must be a positive integer');
  }
  if (!isValidDateTime(body.date_time)) errors.push('date_time must be a valid date-time (YYYY-MM-DDTHH:MM)');
  if (body.duration_minutes !== undefined && !isValidDuration(body.duration_minutes)) {
    errors.push(`duration_minutes must be an integer between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES}`);
  }
  if (!isOptionalString(body.reason, 500)) errors.push('reason must be a string (max 500 characters)');

  if (errors.length) throw new ValidationError(errors);

  return {
    patient_id: body.patient_id as number,
    doctor_id: (body.doctor_id as number | undefined) ?? undefined,
    date_time: normalizeDateTime(body.date_time as string),
    duration_minutes: (body.duration_minutes as number | undefined) ?? 30,
    reason: optionalTrimmed(body.reason) ?? null,
  };
}

export function validateUpdateAppointment(input: unknown): UpdateAppointmentDTO {
  const body = asBody(input);
  const errors: string[] = [];
  const dto: UpdateAppointmentDTO = {};

  if (body.date_time !== undefined) {
    if (!isValidDateTime(body.date_time)) errors.push('date_time must be a valid date-time (YYYY-MM-DDTHH:MM)');
    else dto.date_time = normalizeDateTime(body.date_time);
  }
  if (body.duration_minutes !== undefined) {
    if (!isValidDuration(body.duration_minutes)) {
      errors.push(`duration_minutes must be an integer between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES}`);
    } else dto.duration_minutes = body.duration_minutes;
  }
  if (body.status !== undefined) {
    if (!APPOINTMENT_STATUSES.includes(body.status as AppointmentStatus)) {
      errors.push(`status must be one of: ${APPOINTMENT_STATUSES.join(', ')}`);
    } else dto.status = body.status as AppointmentStatus;
  }
  if (body.reason !== undefined) {
    if (!isOptionalString(body.reason, 500)) errors.push('reason must be a string (max 500 characters)');
    else dto.reason = optionalTrimmed(body.reason);
  }
  if (body.notes !== undefined) {
    if (!isOptionalString(body.notes, 5000)) errors.push('notes must be a string (max 5000 characters)');
    else dto.notes = optionalTrimmed(body.notes);
  }

  const forbidden = ['id', 'patient_id', 'doctor_id', 'created_at'].filter((k) => body[k] !== undefined);
  if (forbidden.length) errors.push(`These fields cannot be updated: ${forbidden.join(', ')}`);

  if (errors.length) throw new ValidationError(errors);
  if (Object.keys(dto).length === 0) throw new ValidationError(['No updatable fields provided']);
  return dto;
}

export function validateAppointmentFilters(query: Record<string, unknown>): AppointmentFilters {
  const errors: string[] = [];
  const filters: AppointmentFilters = {};

  if (query.status !== undefined) {
    if (!APPOINTMENT_STATUSES.includes(query.status as AppointmentStatus)) {
      errors.push(`status must be one of: ${APPOINTMENT_STATUSES.join(', ')}`);
    } else filters.status = query.status as AppointmentStatus;
  }
  if (query.patientId !== undefined) {
    const id = Number(query.patientId);
    if (!Number.isInteger(id) || id <= 0) errors.push('patientId must be a positive integer');
    else filters.patientId = id;
  }
  if (query.dateFrom !== undefined) {
    if (!isValidDateTime(query.dateFrom)) errors.push('dateFrom must be a valid date (YYYY-MM-DD)');
    else filters.dateFrom = normalizeDateTime(query.dateFrom);
  }
  if (query.dateTo !== undefined) {
    if (!isValidDateTime(query.dateTo)) errors.push('dateTo must be a valid date (YYYY-MM-DD)');
    else filters.dateTo = normalizeDateTime(query.dateTo, true);
  }

  if (errors.length) throw new ValidationError(errors);
  return filters;
}
