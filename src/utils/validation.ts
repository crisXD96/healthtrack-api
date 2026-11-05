import { ValidationError } from '../middleware/error-handler';

/** Helpers de validación compartidos por los módulos *.validation.ts */

export type Body = Record<string, unknown>;

export function asBody(input: unknown): Body {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError(['Request body must be a JSON object']);
  }
  return input as Body;
}

export function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function isNonEmptyString(value: unknown, maxLength = Infinity): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

export function isOptionalString(value: unknown, maxLength: number): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= maxLength);
}

export function parseIdParam(raw: string | undefined, name = 'id'): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError([`${name} must be a positive integer`]);
  }
  return id;
}

export function optionalTrimmed(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}
