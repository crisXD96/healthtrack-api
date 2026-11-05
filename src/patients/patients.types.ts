export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodType = (typeof BLOOD_TYPES)[number];

/** Fila tal cual está en la tabla patients */
export interface PatientRow {
  id: number;
  user_id: number;
  date_of_birth: string;
  gender: Gender | null;
  blood_type: BloodType | null;
  allergies: string | null; // JSON array de strings
  emergency_contact: string | null;
  emergency_phone: string | null;
  assigned_doctor_id: number | null;
  created_at: string;
}

/** Paciente tal como lo devuelve la API */
export interface Patient extends Omit<PatientRow, 'allergies'> {
  name: string;
  email: string;
  age: number;
  allergies: string[];
  assigned_doctor_name: string | null;
  last_appointment: string | null;
  next_appointment: string | null;
  metrics_count: number;
  metrics_this_week: number;
}

export interface CreatePatientDTO {
  /** Vincular a un usuario existente con role=patient (alternativa a name/email/password) */
  user_id?: number;
  name?: string;
  email?: string;
  password?: string;
  date_of_birth: string;
  gender?: Gender | null;
  blood_type?: BloodType | null;
  allergies?: string[];
  emergency_contact?: string | null;
  emergency_phone?: string | null;
  assigned_doctor_id?: number | null;
}

export type UpdatePatientDTO = Partial<Omit<CreatePatientDTO, 'user_id' | 'email' | 'password'>>;
