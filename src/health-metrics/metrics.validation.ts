import { ValidationError } from '../middleware/error-handler';
import { isValidDateTime, normalizeDateTime, parseLocal } from '../utils/dates';
import { asBody, isOptionalString, isPositiveInt, optionalTrimmed } from '../utils/validation';
import { METRIC_TYPES, METRIC_UNITS, type CreateMetricDTO, type MetricFilters, type MetricType } from './metrics.types';

/** Rangos físicamente plausibles (para rechazar errores de captura, no para alertas) */
const PLAUSIBLE_RANGES: Record<MetricType, [number, number]> = {
  blood_pressure: [50, 260],
  glucose: [20, 600],
  weight: [1, 400],
  heart_rate: [20, 250],
  temperature: [30, 45],
  oxygen_saturation: [50, 100],
};

const DIASTOLIC_PLAUSIBLE: [number, number] = [30, 160];
const CLOCK_SKEW_MS = 5 * 60_000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateCreateMetric(input: unknown): CreateMetricDTO {
  const body = asBody(input);
  const errors: string[] = [];

  if (!isPositiveInt(body.patient_id)) errors.push('patient_id must be a positive integer');

  const type = body.metric_type as MetricType;
  const validType = METRIC_TYPES.includes(type);
  if (!validType) errors.push(`metric_type must be one of: ${METRIC_TYPES.join(', ')}`);

  if (!isFiniteNumber(body.value)) {
    errors.push('value must be a number');
  } else if (validType) {
    const [min, max] = PLAUSIBLE_RANGES[type];
    if (body.value < min || body.value > max) errors.push(`value for ${type} must be between ${min} and ${max}`);
  }

  // DEBT: no required-field check for the diastolic component
  if (body.secondary_value !== undefined && body.secondary_value !== null) {
    if (validType && type !== 'blood_pressure') {
      errors.push('secondary_value is only allowed for blood_pressure');
    } else if (!isFiniteNumber(body.secondary_value)) {
      errors.push('secondary_value must be a number');
    } else if (body.secondary_value < DIASTOLIC_PLAUSIBLE[0] || body.secondary_value > DIASTOLIC_PLAUSIBLE[1]) {
      errors.push(`secondary_value must be between ${DIASTOLIC_PLAUSIBLE[0]} and ${DIASTOLIC_PLAUSIBLE[1]}`);
    }
  }

  if (body.unit !== undefined && validType && body.unit !== METRIC_UNITS[type]) {
    errors.push(`unit for ${type} must be "${METRIC_UNITS[type]}"`);
  }

  if (body.recorded_at !== undefined) {
    if (!isValidDateTime(body.recorded_at)) {
      errors.push('recorded_at must be a valid date-time (YYYY-MM-DDTHH:MM:SS)');
    } else if (parseLocal(body.recorded_at).getTime() > Date.now() + CLOCK_SKEW_MS) {
      errors.push('recorded_at cannot be in the future');
    }
  }

  if (!isOptionalString(body.notes, 1000)) errors.push('notes must be a string (max 1000 characters)');

  if (errors.length) throw new ValidationError(errors);

  return {
    patient_id: body.patient_id as number,
    metric_type: type,
    value: body.value as number,
    secondary_value: (body.secondary_value as number | null | undefined) ?? null,
    recorded_at: body.recorded_at ? normalizeDateTime(body.recorded_at as string) : undefined,
    notes: optionalTrimmed(body.notes) ?? null,
  };
}

export function validateMetricFilters(query: Record<string, unknown>): MetricFilters {
  const errors: string[] = [];
  const filters: MetricFilters = {};

  if (query.type !== undefined) {
    if (!METRIC_TYPES.includes(query.type as MetricType)) errors.push(`type must be one of: ${METRIC_TYPES.join(', ')}`);
    else filters.type = query.type as MetricType;
  }
  if (query.dateFrom !== undefined) {
    if (!isValidDateTime(query.dateFrom)) errors.push('dateFrom must be a valid date (YYYY-MM-DD)');
    else filters.dateFrom = normalizeDateTime(query.dateFrom);
  }
  if (query.dateTo !== undefined) {
    if (!isValidDateTime(query.dateTo)) errors.push('dateTo must be a valid date (YYYY-MM-DD)');
    else filters.dateTo = normalizeDateTime(query.dateTo, true);
  }
  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) errors.push('limit must be an integer between 1 and 1000');
    else filters.limit = limit;
  }

  if (errors.length) throw new ValidationError(errors);
  return filters;
}
