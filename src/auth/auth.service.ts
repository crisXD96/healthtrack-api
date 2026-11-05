import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { getDb } from '../database/connection';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../middleware/error-handler';
import { asBody, isNonEmptyString } from '../utils/validation';
import {
  ROLES,
  SELF_REGISTER_ROLES,
  type AuthResult,
  type DoctorSummary,
  type LoginDTO,
  type PublicUser,
  type RegisterDTO,
  type Role,
  type TokenPayload,
  type User,
} from './auth.types';

// DEBT: secret lives in code
const JWT_SECRET = 'healthtrack-secret-key-2024';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

// ---------------------------------------------------------------------------
// Tokens y passwords
// ---------------------------------------------------------------------------

export function signToken(user: Pick<User, 'id' | 'email' | 'role' | 'name'>): string {
  const payload: TokenPayload = { userId: user.id, email: user.email, role: user.role, name: user.name };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: config.jwt.expiresIn });
}

export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as unknown as TokenPayload;
    if (!decoded || typeof decoded.userId !== 'number' || !ROLES.includes(decoded.role)) {
      throw new Error('Malformed token payload');
    }
    return decoded;
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.bcryptRounds);
}

export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

export function isValidPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH && password.length <= 128;
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

function validateRegister(input: unknown): RegisterDTO {
  const body = asBody(input);
  const errors: string[] = [];

  if (!isValidEmail(body.email)) errors.push('email must be a valid email address');
  if (!isValidPassword(body.password)) errors.push(`password must be between ${MIN_PASSWORD_LENGTH} and 128 characters`);
  if (!isNonEmptyString(body.name, 100)) errors.push('name is required (max 100 characters)');
  // role es opcional: por defecto 'patient' (el único rol con autorregistro).
  if (body.role !== undefined && (typeof body.role !== 'string' || !ROLES.includes(body.role as Role))) {
    errors.push(`role must be one of: ${ROLES.join(', ')}`);
  }
  if (errors.length) throw new ValidationError(errors);

  return {
    email: (body.email as string).trim().toLowerCase(),
    password: body.password as string,
    name: (body.name as string).trim(),
    role: (body.role as Role | undefined) ?? 'patient',
  };
}

function validateLogin(input: unknown): LoginDTO {
  const body = asBody(input);
  const errors: string[] = [];
  if (!isNonEmptyString(body.email)) errors.push('email is required');
  if (!isNonEmptyString(body.password)) errors.push('password is required');
  if (errors.length) throw new ValidationError(errors);
  return { email: (body.email as string).trim().toLowerCase(), password: body.password as string };
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

function toPublicUser(user: User): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash, ...rest } = user;
  let patientId: number | null = null;
  if (user.role === 'patient') {
    const row = getDb().prepare('SELECT id FROM patients WHERE user_id = ?').get(user.id) as { id: number } | undefined;
    patientId = row?.id ?? null;
  }
  return { ...rest, patientId };
}

export function findUserByEmail(email: string): User | undefined {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as User | undefined;
}

export function getUserById(id: number): PublicUser {
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  if (!user) throw new NotFoundError('User');
  return toPublicUser(user);
}

/** Lanza ValidationError si el id no corresponde a un usuario con role=doctor. */
export function assertIsDoctor(userId: number, field = 'doctor_id'): void {
  const doctor = getDb().prepare("SELECT id FROM users WHERE id = ? AND role = 'doctor'").get(userId);
  if (!doctor) throw new ValidationError([`${field} ${userId} does not reference a doctor`]);
}

export function listDoctors(): DoctorSummary[] {
  return getDb()
    .prepare(
      `SELECT u.id, u.name, u.email, COUNT(p.id) AS patient_count
       FROM users u
       LEFT JOIN patients p ON p.assigned_doctor_id = u.id
       WHERE u.role = 'doctor'
       GROUP BY u.id
       ORDER BY u.name`,
    )
    .all() as DoctorSummary[];
}

export async function register(input: unknown): Promise<AuthResult> {
  const dto = validateRegister(input);

  if (!SELF_REGISTER_ROLES.includes(dto.role)) {
    throw new ForbiddenError(`Accounts with role "${dto.role}" cannot be self-registered`);
  }
  if (findUserByEmail(dto.email)) {
    throw new ConflictError('An account with this email already exists');
  }

  const passwordHash = await hashPassword(dto.password);
  const info = getDb()
    .prepare('INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)')
    .run(dto.email, passwordHash, dto.role, dto.name);

  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as User;
  return { token: signToken(user), user: toPublicUser(user) };
}

export async function login(input: unknown): Promise<AuthResult> {
  const dto = validateLogin(input);
  const user = findUserByEmail(dto.email);

  const valid = user ? await bcrypt.compare(dto.password, user.password_hash) : false;
  if (!user || !valid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  return { token: signToken(user), user: toPublicUser(user) };
}
