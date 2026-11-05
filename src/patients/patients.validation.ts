import { isValidEmail, isValidPassword } from '../auth/auth.service';
import { ValidationError } from '../middleware/error-handler';
import { calculateAge, isValidDate } from '../utils/dates';
import { asBody, isNonEmptyString, isOptionalString, isPositiveInt, optionalTrimmed, type Body } from '../utils/validation';
import { BLOOD_TYPES, GENDERS, type BloodType, type CreatePatientDTO, type Gender, type UpdatePatientDTO } from './patients.types';

const PHONE_RE = /^\+?[\d\s().-]{7,20}$/;
const MAX_ALLERGIES = 20;

function validateClinicalFields(body: Body, errors: string[], partial: boolean): void {
  if (!partial || body.date_of_birth !== undefined) {
    if (!isValidDate(body.date_of_birth)) {
      errors.push('date_of_birth must be a valid date (YYYY-MM-DD)');
    } else {
      const age = calculateAge(body.date_of_birth);
      if (new Date(`${body.date_of_birth}T00:00:00`) > new Date()) errors.push('date_of_birth cannot be in the future');
      else if (age > 130) errors.push('date_of_birth is not realistic');
    }
  }

  if (body.gender !== undefined && body.gender !== null && !GENDERS.includes(body.gender as Gender)) {
    errors.push(`gender must be one of: ${GENDERS.join(', ')}`);
  }

  if (body.blood_type !== undefined && body.blood_type !== null && !BLOOD_TYPES.includes(body.blood_type as BloodType)) {
    errors.push(`blood_type must be one of: ${BLOOD_TYPES.join(', ')}`);
  }

  if (body.allergies !== undefined && body.allergies !== null) {
    if (
      !Array.isArray(body.allergies) ||
      body.allergies.length > MAX_ALLERGIES ||
      body.allergies.some((a) => !isNonEmptyString(a, 100))
    ) {
      errors.push(`allergies must be an array of up to ${MAX_ALLERGIES} non-empty strings`);
    }
  }

  if (!isOptionalString(body.emergency_contact, 100)) errors.push('emergency_contact must be a string (max 100 characters)');

  if (body.emergency_phone !== undefined && body.emergency_phone !== null && body.emergency_phone !== '') {
    if (typeof body.emergency_phone !== 'string' || !PHONE_RE.test(body.emergency_phone)) {
      errors.push('emergency_phone must be a valid phone number');
    }
  }

  if (body.assigned_doctor_id !== undefined && body.assigned_doctor_id !== null && !isPositiveInt(body.assigned_doctor_id)) {
    errors.push('assigned_doctor_id must be a positive integer');
  }

  if (body.name !== undefined && !isNonEmptyString(body.name, 100)) {
    errors.push('name must be a non-empty string (max 100 characters)');
  }
}

function pickClinicalFields(body: Body): UpdatePatientDTO {
  const dto: UpdatePatientDTO = {};
  if (body.name !== undefined) dto.name = String(body.name).trim();
  if (body.date_of_birth !== undefined) dto.date_of_birth = body.date_of_birth as string;
  if (body.gender !== undefined) dto.gender = (body.gender as Gender | null) ?? null;
  if (body.blood_type !== undefined) dto.blood_type = (body.blood_type as BloodType | null) ?? null;
  if (body.allergies !== undefined) {
    dto.allergies = Array.isArray(body.allergies) ? (body.allergies as string[]).map((a) => a.trim()) : [];
  }
  if (body.emergency_contact !== undefined) dto.emergency_contact = optionalTrimmed(body.emergency_contact);
  if (body.emergency_phone !== undefined) dto.emergency_phone = optionalTrimmed(body.emergency_phone);
  if (body.assigned_doctor_id !== undefined) dto.assigned_doctor_id = (body.assigned_doctor_id as number | null) ?? null;
  return dto;
}

export function validateCreatePatient(input: unknown): CreatePatientDTO {
  const body = asBody(input);
  const errors: string[] = [];

  if (body.user_id !== undefined) {
    if (!isPositiveInt(body.user_id)) errors.push('user_id must be a positive integer');
  } else {
    if (!isNonEmptyString(body.name, 100)) errors.push('name is required (max 100 characters)');
    if (!isValidEmail(body.email)) errors.push('email must be a valid email address');
    if (!isValidPassword(body.password)) errors.push('password must be between 8 and 128 characters');
  }

  validateClinicalFields(body, errors, false);
  if (errors.length) throw new ValidationError(errors);

  return {
    ...pickClinicalFields(body),
    date_of_birth: body.date_of_birth as string,
    user_id: body.user_id as number | undefined,
    email: typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined,
    password: body.password as string | undefined,
  };
}

export function validateUpdatePatient(input: unknown): UpdatePatientDTO {
  const body = asBody(input);
  const errors: string[] = [];

  const forbidden = ['id', 'user_id', 'email', 'password', 'created_at'].filter((k) => body[k] !== undefined);
  if (forbidden.length) errors.push(`These fields cannot be updated here: ${forbidden.join(', ')}`);

  validateClinicalFields(body, errors, true);
  if (errors.length) throw new ValidationError(errors);

  const dto = pickClinicalFields(body);
  if (Object.keys(dto).length === 0) throw new ValidationError(['No updatable fields provided']);
  return dto;
}
