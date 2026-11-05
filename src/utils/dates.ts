/**
 * Utilidades de fechas.
 *
 * Convención: los timestamps de negocio (date_time de citas, recorded_at de métricas,
 * created_at de notificaciones) se guardan como ISO local sin zona horaria:
 * 'YYYY-MM-DDTHH:MM:SS'. Esto permite comparar strings directamente en SQLite.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

export function toLocalISO(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export function nowLocalISO(): string {
  return toLocalISO(new Date());
}

export function daysAgoLocalISO(days: number): string {
  return toLocalISO(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_TIME_RE.test(value)) return false;
  return !Number.isNaN(parseLocal(value).getTime());
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_ONLY_RE.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

/** Normaliza 'YYYY-MM-DD', 'YYYY-MM-DD HH:MM' o 'YYYY-MM-DDTHH:MM' a 'YYYY-MM-DDTHH:MM:SS'. */
export function normalizeDateTime(value: string, endOfDay = false): string {
  const v = value.replace(' ', 'T');
  if (v.length === 10) return `${v}T${endOfDay ? '23:59:59' : '00:00:00'}`;
  if (v.length === 16) return `${v}:00`;
  return v;
}

/** Parsea un ISO local (sin zona) como hora local. */
export function parseLocal(value: string): Date {
  return new Date(normalizeDateTime(value));
}

export function calculateAge(dateOfBirth: string, now = new Date()): number {
  const dob = new Date(`${dateOfBirth}T00:00:00`);
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}
