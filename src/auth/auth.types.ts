export type Role = 'doctor' | 'patient' | 'admin';

export const ROLES: readonly Role[] = ['doctor', 'patient', 'admin'];

/**
 * Roles que se pueden auto-registrar desde POST /api/auth/register.
 * Solo pacientes: las cuentas de doctor las crea un admin (un doctor accede a datos clínicos).
 */
export const SELF_REGISTER_ROLES: readonly Role[] = ['patient'];

export interface User {
  id: number;
  email: string;
  password_hash: string;
  role: Role;
  name: string;
  created_at: string;
}

export type PublicUser = Omit<User, 'password_hash'> & {
  /** id en la tabla patients (solo para role=patient con ficha clínica) */
  patientId: number | null;
};

export interface TokenPayload {
  userId: number;
  email: string;
  role: Role;
  name: string;
}

export interface RegisterDTO {
  email: string;
  password: string;
  name: string;
  role: Role;
}

export interface LoginDTO {
  email: string;
  password: string;
}

export interface AuthResult {
  token: string;
  user: PublicUser;
}

export interface DoctorSummary {
  id: number;
  name: string;
  email: string;
  patient_count: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}
