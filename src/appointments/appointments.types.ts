export const APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'completed', 'cancelled'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Transiciones de estado permitidas */
export const STATUS_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['confirmed', 'completed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/** Horario de consulta (hora local): las citas deben empezar y terminar dentro de este rango */
export const BUSINESS_HOURS = { startHour: 8, endHour: 18 } as const;

export const MIN_DURATION_MINUTES = 15;
export const MAX_DURATION_MINUTES = 240;

export interface AppointmentRow {
  id: number;
  patient_id: number;
  doctor_id: number;
  date_time: string;
  duration_minutes: number;
  status: AppointmentStatus;
  reason: string | null;
  notes: string | null;
  created_at: string;
}

export interface Appointment extends AppointmentRow {
  patient_name: string;
  doctor_name: string;
  patient_user_id: number;
  assigned_doctor_id: number | null;
}

export interface CreateAppointmentDTO {
  patient_id: number;
  doctor_id?: number;
  date_time: string;
  duration_minutes?: number;
  reason?: string | null;
}

export interface UpdateAppointmentDTO {
  date_time?: string;
  duration_minutes?: number;
  status?: AppointmentStatus;
  reason?: string | null;
  notes?: string | null;
}

export interface AppointmentFilters {
  status?: AppointmentStatus;
  patientId?: number;
  dateFrom?: string;
  dateTo?: string;
}
