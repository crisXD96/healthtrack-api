import bcrypt from 'bcryptjs';
import type Database from 'better-sqlite3';
import fs from 'fs';
import type { AppointmentStatus } from '../appointments/appointments.types';
import { config } from '../config';
import { classifyMetric } from '../health-metrics/metrics.service';
import { METRIC_UNITS, type MetricType } from '../health-metrics/metrics.types';
import {
  createAppointmentReminder,
  createGeneralNotification,
  createMetricAlert,
} from '../notifications/notifications.service';
import type { BloodType, Gender } from '../patients/patients.types';
import { toLocalISO } from '../utils/dates';
import { closeDb, getDb } from './connection';
import { runMigrations } from './migrations';

/**
 * Datos de ejemplo realistas.
 * Las fechas son relativas al día en que se ejecuta el seed, así el dashboard
 * siempre muestra citas de hoy, próximas citas y métricas de los últimos 6 meses.
 * El generador aleatorio es determinista (misma semilla => mismos datos).
 */

export const SEED_PASSWORDS = {
  admin: 'Admin123!',
  doctor: 'Doctor123!',
  patient: 'Patient123!',
} as const;

// ---------------------------------------------------------------------------
// Generador pseudoaleatorio determinista
// ---------------------------------------------------------------------------

const RANDOM_SEED = 20241105;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rand = mulberry32(RANDOM_SEED);
const noise = (amplitude: number): number => (rand() * 2 - 1) * amplitude;
const r0 = (v: number): number => Math.round(v);
const r1 = (v: number): number => Math.round(v * 10) / 10;
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];

// ---------------------------------------------------------------------------
// Definición de datos
// ---------------------------------------------------------------------------

type DoctorKey = 'martinez' | 'chen' | 'okonkwo';

const DOCTORS: { key: DoctorKey; name: string; email: string; specialty: string }[] = [
  { key: 'martinez', name: 'Dr. Elena Martínez', email: 'elena.martinez@healthtrack.com', specialty: 'Cardiology' },
  { key: 'chen', name: 'Dr. James Chen', email: 'james.chen@healthtrack.com', specialty: 'General Medicine' },
  { key: 'okonkwo', name: 'Dr. Sarah Okonkwo', email: 'sarah.okonkwo@healthtrack.com', specialty: 'Endocrinology' },
];

const ADMIN = { name: 'Laura Bennett', email: 'admin@healthtrack.com' };

interface MetricPoint {
  value: number;
  secondary?: number | null;
  notes?: string;
}

interface SeriesSpec {
  type: MetricType;
  count: number;
  /** t va de 0 (hace ~6 meses) a 1 (ayer); i es el índice de la lectura */
  gen: (t: number, i: number) => MetricPoint;
}

interface AppointmentSpec {
  /** Días relativos a hoy (negativo = pasado) */
  day: number;
  time: string;
  duration?: number;
  status: AppointmentStatus;
  reason: string;
  notes?: string;
}

interface PatientSeed {
  name: string;
  email: string;
  dob: string;
  gender: Gender;
  bloodType: BloodType;
  allergies: string[];
  emergencyContact: string;
  emergencyPhone: string;
  doctor: DoctorKey;
  series: SeriesSpec[];
  appointments: AppointmentSpec[];
}

const HOME_NOTES = [
  'Home monitor reading',
  'Measured after breakfast',
  'Morning reading before medication',
  'Felt a bit tired today',
  'After a 30-minute walk',
  'Measured at the pharmacy',
];

const PATIENTS: PatientSeed[] = [
  // Paciente 1: presión arterial subiendo gradualmente (hipertensión incipiente)
  {
    name: 'Carlos Ruiz',
    email: 'carlos.ruiz@email.com',
    dob: '1972-03-14',
    gender: 'male',
    bloodType: 'A+',
    allergies: ['Penicillin'],
    emergencyContact: 'Lucía Ruiz (wife)',
    emergencyPhone: '+1 (555) 201-4433',
    doctor: 'martinez',
    series: [
      {
        type: 'blood_pressure',
        count: 16,
        gen: (t, i) => ({
          value: r0(118 + 28 * t + noise(4)),
          secondary: r0(76 + 16 * t + noise(3)),
          notes: i === 15 ? 'Mild headache in the morning' : undefined,
        }),
      },
      { type: 'heart_rate', count: 8, gen: (t) => ({ value: r0(72 + 8 * t + noise(4)) }) },
      { type: 'weight', count: 6, gen: (t) => ({ value: r1(88 + 2 * t + noise(0.5)) }) },
    ],
    appointments: [
      { day: -150, time: '09:00', status: 'completed', reason: 'Initial cardiology consultation', notes: 'BP 122/78. Family history of hypertension (father). Advised reduced sodium intake and regular exercise. Follow-up in 2 months.' },
      { day: -95, time: '10:30', status: 'completed', reason: 'Blood pressure follow-up', notes: 'BP trending upward (134/86). Started home BP monitoring twice daily. Reinforced lifestyle changes.' },
      { day: -40, time: '11:00', status: 'cancelled', reason: 'Blood pressure follow-up' },
      { day: -20, time: '09:30', duration: 45, status: 'completed', reason: 'Hypertension evaluation', notes: 'Sustained home readings >140/90. Ordered ECG and basic metabolic panel. Will consider ACE inhibitor if trend persists.' },
      { day: 0, time: '10:30', status: 'confirmed', reason: 'Review ECG and lab results' },
      { day: 14, time: '09:00', status: 'scheduled', reason: 'Medication review' },
    ],
  },
  // Paciente 2: glucosa estable con picos esporádicos
  {
    name: 'Aisha Rahman',
    email: 'aisha.rahman@email.com',
    dob: '1985-07-22',
    gender: 'female',
    bloodType: 'B+',
    allergies: ['Sulfa drugs'],
    emergencyContact: 'Omar Rahman (brother)',
    emergencyPhone: '+1 (555) 318-9021',
    doctor: 'okonkwo',
    series: [
      {
        type: 'glucose',
        count: 20,
        gen: (_t, i) => {
          if (i === 5) return { value: 148, notes: 'After family celebration dinner' };
          if (i === 11) return { value: 171, notes: 'Skipped morning medication' };
          if (i === 16) return { value: 132, notes: 'Measured 2h after a large meal' };
          return { value: r0(88 + noise(6)) };
        },
      },
      { type: 'weight', count: 5, gen: () => ({ value: r1(64 + noise(0.6)) }) },
      { type: 'blood_pressure', count: 5, gen: () => ({ value: r0(112 + noise(4)), secondary: r0(72 + noise(3)) }) },
    ],
    appointments: [
      { day: -120, time: '14:00', status: 'completed', reason: 'Diabetes screening', notes: 'Fasting glucose 89 mg/dL, HbA1c 5.6%. Discussed sporadic post-meal spikes; patient will keep a food diary.' },
      { day: -60, time: '15:00', status: 'completed', reason: 'Glucose spikes follow-up', notes: 'Two readings >140 mg/dL linked to missed meals and large dinners. Ordered oral glucose tolerance test.' },
      { day: -30, time: '09:00', status: 'cancelled', reason: 'OGTT results review' },
      { day: 2, time: '15:30', status: 'scheduled', reason: 'OGTT results review' },
    ],
  },
  // Paciente 3: pérdida de peso constante
  {
    name: "Michael O'Brien",
    email: 'michael.obrien@email.com',
    dob: '1990-11-03',
    gender: 'male',
    bloodType: 'O+',
    allergies: [],
    emergencyContact: "Siobhan O'Brien (mother)",
    emergencyPhone: '+1 (555) 742-1180',
    doctor: 'chen',
    series: [
      { type: 'weight', count: 18, gen: (t) => ({ value: r1(104 - 15 * t + noise(0.6)) }) },
      { type: 'heart_rate', count: 6, gen: (t) => ({ value: r0(82 - 10 * t + noise(3)) }) },
      { type: 'blood_pressure', count: 6, gen: (t) => ({ value: r0(130 - 14 * t + noise(3)), secondary: r0(86 - 10 * t + noise(2)) }) },
    ],
    appointments: [
      { day: -170, time: '08:30', duration: 45, status: 'completed', reason: 'Weight management program intake', notes: 'BMI 33.2. Starting supervised diet and exercise plan. Target: -10 kg in 6 months.' },
      { day: -130, time: '09:00', status: 'completed', reason: 'Monthly weight check-in', notes: '-3.8 kg. Good adherence to plan. BP improving.' },
      { day: -90, time: '09:00', status: 'completed', reason: 'Monthly weight check-in', notes: '-7.1 kg cumulative. Patient reports more energy and better sleep.' },
      { day: -60, time: '09:00', status: 'cancelled', reason: 'Monthly weight check-in' },
      { day: -30, time: '09:00', status: 'completed', reason: 'Monthly weight check-in', notes: '-12.4 kg cumulative. BP now within normal range. Continue plan.' },
      { day: 0, time: '14:00', status: 'scheduled', reason: 'Monthly weight check-in' },
      { day: 30, time: '09:00', status: 'scheduled', reason: '6-month program review' },
    ],
  },
  // Paciente 4: todos los valores normales y estables
  {
    name: 'Sofia Rossi',
    email: 'sofia.rossi@email.com',
    dob: '1996-05-18',
    gender: 'female',
    bloodType: 'A-',
    allergies: ['Latex'],
    emergencyContact: 'Marco Rossi (father)',
    emergencyPhone: '+1 (555) 864-3302',
    doctor: 'chen',
    series: [
      { type: 'blood_pressure', count: 8, gen: () => ({ value: r0(clamp(110 + noise(5), 98, 118)), secondary: r0(clamp(71 + noise(4), 64, 79)) }) },
      { type: 'heart_rate', count: 8, gen: () => ({ value: r0(clamp(68 + noise(6), 62, 82)) }) },
      { type: 'weight', count: 5, gen: () => ({ value: r1(58 + noise(0.4)) }) },
      { type: 'glucose', count: 4, gen: () => ({ value: r0(clamp(86 + noise(6), 76, 96)) }) },
      { type: 'temperature', count: 3, gen: () => ({ value: r1(clamp(36.7 + noise(0.25), 36.3, 37.0)) }) },
      { type: 'oxygen_saturation', count: 3, gen: () => ({ value: r0(clamp(98 + noise(1.2), 96, 100)) }) },
    ],
    appointments: [
      { day: -160, time: '10:00', status: 'completed', reason: 'Annual physical', notes: 'All vitals within normal limits. Routine labs normal. Next annual exam in 12 months.' },
      { day: -45, time: '16:00', duration: 15, status: 'completed', reason: 'Travel vaccination', notes: 'Hepatitis A vaccine administered. No adverse reaction observed during 15-minute observation.' },
      { day: 60, time: '10:00', status: 'scheduled', reason: 'Routine check-up' },
    ],
  },
  // Paciente 5: adulto mayor, presión en warning y SpO2 limítrofe
  {
    name: 'Hiroshi Tanaka',
    email: 'hiroshi.tanaka@email.com',
    dob: '1948-09-30',
    gender: 'male',
    bloodType: 'AB+',
    allergies: ['Aspirin', 'Shellfish'],
    emergencyContact: 'Yuki Tanaka (daughter)',
    emergencyPhone: '+1 (555) 590-7714',
    doctor: 'martinez',
    series: [
      { type: 'blood_pressure', count: 10, gen: () => ({ value: r0(132 + noise(6)), secondary: r0(78 + noise(5)) }) },
      {
        type: 'heart_rate',
        count: 10,
        gen: (_t, i) => (i === 4 ? { value: 108, notes: 'Palpitations after coffee' } : { value: r0(76 + noise(8)) }),
      },
      {
        type: 'oxygen_saturation',
        count: 10,
        gen: (_t, i) =>
          i === 6
            ? { value: 89, notes: 'Shortness of breath after climbing stairs' }
            : { value: r0(clamp(94.5 + noise(2), 91, 98)) },
      },
    ],
    appointments: [
      { day: -175, time: '09:00', duration: 45, status: 'completed', reason: 'Cardiology follow-up', notes: 'Stable angina, well controlled. BP 134/80. Continue amlodipine 5 mg daily.' },
      { day: -140, time: '10:00', status: 'completed', reason: 'Shortness of breath evaluation', notes: 'SpO2 93% at rest. Referred to pulmonology for COPD assessment.' },
      { day: -100, time: '10:00', status: 'completed', reason: 'Medication adjustment', notes: 'Amlodipine increased to 10 mg. Monitor for ankle edema.' },
      { day: -70, time: '10:00', status: 'cancelled', reason: 'Routine follow-up' },
      { day: -35, time: '11:30', status: 'completed', reason: 'Routine follow-up', notes: 'Episode of SpO2 89% after exertion reported. Pulmonary rehabilitation recommended.' },
      { day: -7, time: '10:00', status: 'completed', reason: 'Post-rehab assessment', notes: 'Exercise tolerance improved. SpO2 94-96% at rest. 24h Holter monitor placed.' },
      { day: 1, time: '11:00', status: 'confirmed', reason: 'Holter monitor results' },
      { day: 21, time: '10:00', duration: 45, status: 'scheduled', reason: 'Quarterly cardiology review' },
    ],
  },
  // Paciente 6: diabetes tipo 2 en tratamiento (glucosa alta mejorando)
  {
    name: 'Maria González',
    email: 'maria.gonzalez@email.com',
    dob: '1963-12-08',
    gender: 'female',
    bloodType: 'O-',
    allergies: ['Ibuprofen'],
    emergencyContact: 'Andrés González (son)',
    emergencyPhone: '+1 (555) 433-6658',
    doctor: 'okonkwo',
    series: [
      { type: 'glucose', count: 20, gen: (t) => ({ value: r0(128 - 14 * t + noise(8)) }) },
      { type: 'weight', count: 6, gen: (t) => ({ value: r1(79 - 2.5 * t + noise(0.4)) }) },
      { type: 'blood_pressure', count: 6, gen: () => ({ value: r0(124 + noise(4)), secondary: r0(80 + noise(3)) }) },
    ],
    appointments: [
      { day: -165, time: '11:00', duration: 45, status: 'completed', reason: 'Type 2 diabetes review', notes: 'HbA1c 8.1%. Metformin increased to 1000 mg BID. Referred to nutritionist.' },
      { day: -110, time: '11:00', status: 'completed', reason: 'Diabetes follow-up', notes: 'Fasting glucose improving (118-125 mg/dL). HbA1c 7.4%.' },
      { day: -55, time: '11:00', status: 'completed', reason: 'Diabetes follow-up', notes: 'Good adherence. Mild GI side effects have resolved.' },
      { day: 0, time: '11:00', status: 'confirmed', reason: 'Quarterly HbA1c review' },
      { day: 45, time: '11:00', status: 'scheduled', reason: 'Diabetic foot exam' },
    ],
  },
  // Paciente 7: joven, episodio febril puntual
  {
    name: 'Daniel Kim',
    email: 'daniel.kim@email.com',
    dob: '2001-02-25',
    gender: 'male',
    bloodType: 'B-',
    allergies: ['Peanuts'],
    emergencyContact: 'Grace Kim (mother)',
    emergencyPhone: '+1 (555) 276-0945',
    doctor: 'chen',
    series: [
      {
        type: 'temperature',
        count: 8,
        gen: (_t, i) => {
          if (i === 3) return { value: 38.6, notes: 'Fever and body aches (influenza)' };
          if (i === 4) return { value: 37.8, notes: 'Recovering, mild fever' };
          return { value: r1(36.6 + noise(0.25)) };
        },
      },
      {
        type: 'heart_rate',
        count: 8,
        gen: (_t, i) => (i === 3 ? { value: 104, notes: 'During fever episode' } : { value: r0(70 + noise(6)) }),
      },
      { type: 'weight', count: 4, gen: () => ({ value: r1(75 + noise(0.5)) }) },
      { type: 'oxygen_saturation', count: 4, gen: () => ({ value: r0(clamp(98 + noise(1), 96, 100)) }) },
    ],
    appointments: [
      { day: -100, time: '15:00', duration: 20, status: 'completed', reason: 'Flu-like symptoms', notes: 'Fever 38.6 °C, myalgia. Rapid influenza test positive (type A). Rest, fluids, oseltamivir 75 mg BID x5 days.' },
      { day: -93, time: '15:00', duration: 20, status: 'completed', reason: 'Flu follow-up', notes: 'Afebrile. Fully recovered.' },
      { day: -10, time: '16:30', duration: 15, status: 'cancelled', reason: 'Sports physical' },
      { day: 5, time: '16:00', status: 'scheduled', reason: 'Sports physical' },
    ],
  },
  // Paciente 8: control tiroideo, aumento leve de peso
  {
    name: 'Alex Morgan',
    email: 'alex.morgan@email.com',
    dob: '1988-04-02',
    gender: 'other',
    bloodType: 'O+',
    allergies: ['Pollen', 'Dust mites'],
    emergencyContact: 'Jordan Lee (partner)',
    emergencyPhone: '+1 (555) 619-2287',
    doctor: 'okonkwo',
    series: [
      { type: 'weight', count: 10, gen: (t) => ({ value: r1(68 + 4 * t + noise(0.4)) }) },
      { type: 'heart_rate', count: 8, gen: () => ({ value: r0(74 + noise(5)) }) },
      { type: 'blood_pressure', count: 6, gen: () => ({ value: r0(116 + noise(5)), secondary: r0(75 + noise(4)) }) },
      { type: 'glucose', count: 4, gen: () => ({ value: r0(92 + noise(6)) }) },
    ],
    appointments: [
      { day: -150, time: '10:00', status: 'completed', reason: 'Thyroid function review', notes: 'TSH 6.2 mIU/L (mildly elevated). Started levothyroxine 25 mcg daily.' },
      { day: -80, time: '10:00', status: 'completed', reason: 'Thyroid follow-up', notes: 'TSH 4.1 mIU/L. Slight weight gain noted; dietary counseling provided.' },
      { day: -15, time: '10:30', status: 'completed', reason: 'Lab results review', notes: 'TSH 2.8 mIU/L, within target. Continue current dose.' },
      { day: 3, time: '10:00', status: 'confirmed', reason: 'Thyroid follow-up' },
      { day: 40, time: '10:00', status: 'scheduled', reason: 'Routine endocrine review' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function atDay(dayOffset: number, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const d = startOfToday();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
}

function hoursAgo(hours: number): string {
  return toLocalISO(new Date(Date.now() - hours * 3_600_000));
}

function clearAllData(db: Database.Database): void {
  db.exec(`
    DELETE FROM audit_log;
    DELETE FROM notifications;
    DELETE FROM health_metrics;
    DELETE FROM appointments;
    DELETE FROM patients;
    DELETE FROM users;
  `);
  try {
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('audit_log','notifications','health_metrics','appointments','patients','users')");
  } catch {
    // sqlite_sequence no existe todavía
  }
}

export interface SeedSummary {
  users: number;
  patients: number;
  appointments: number;
  metrics: number;
  notifications: number;
  auditEntries: number;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

export function seedDatabase(db: Database.Database = getDb()): SeedSummary {
  rand = mulberry32(RANDOM_SEED);
  const hash = (password: string) => bcrypt.hashSync(password, config.bcryptRounds);

  const insertUser = db.prepare('INSERT INTO users (email, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?)');
  const insertPatient = db.prepare(
    `INSERT INTO patients (user_id, date_of_birth, gender, blood_type, allergies, emergency_contact, emergency_phone, assigned_doctor_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAppointment = db.prepare(
    `INSERT INTO appointments (patient_id, doctor_id, date_time, duration_minutes, status, reason, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMetric = db.prepare(
    `INSERT INTO health_metrics (patient_id, metric_type, value, secondary_value, unit, recorded_at, recorded_by, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAudit = db.prepare(
    `INSERT INTO audit_log (user_id, action, resource, resource_id, details, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  // Hashing fuera de la transacción (es lo más lento)
  const adminHash = hash(SEED_PASSWORDS.admin);
  const doctorHashes = DOCTORS.map(() => hash(SEED_PASSWORDS.doctor));
  const patientHashes = PATIENTS.map(() => hash(SEED_PASSWORDS.patient));
  const accountsCreatedAt = toLocalISO(atDay(-200, '08:00'));

  const summary: SeedSummary = { users: 0, patients: 0, appointments: 0, metrics: 0, notifications: 0, auditEntries: 0 };

  db.transaction(() => {
    clearAllData(db);

    // --- Usuarios ---
    const adminId = Number(insertUser.run(ADMIN.email, adminHash, 'admin', ADMIN.name, accountsCreatedAt).lastInsertRowid);
    const doctorIds = {} as Record<DoctorKey, number>;
    const doctorNames = {} as Record<DoctorKey, string>;
    DOCTORS.forEach((d, idx) => {
      doctorIds[d.key] = Number(insertUser.run(d.email, doctorHashes[idx], 'doctor', d.name, accountsCreatedAt).lastInsertRowid);
      doctorNames[d.key] = d.name;
    });
    summary.users = 1 + DOCTORS.length;

    const patientRefs: { patientId: number; userId: number; doctorKey: DoctorKey; name: string }[] = [];
    const now = Date.now();

    PATIENTS.forEach((p, idx) => {
      const createdAt = toLocalISO(atDay(-190 + idx, '09:00'));
      const userId = Number(insertUser.run(p.email, patientHashes[idx], 'patient', p.name, createdAt).lastInsertRowid);
      const patientId = Number(
        insertPatient.run(
          userId,
          p.dob,
          p.gender,
          p.bloodType,
          JSON.stringify(p.allergies),
          p.emergencyContact,
          p.emergencyPhone,
          doctorIds[p.doctor],
          createdAt,
        ).lastInsertRowid,
      );
      summary.users++;
      summary.patients++;
      patientRefs.push({ patientId, userId, doctorKey: p.doctor, name: p.name });

      // --- Citas ---
      for (const a of p.appointments) {
        const when = atDay(a.day, a.time);
        const dateTime = toLocalISO(when);
        insertAppointment.run(
          patientId,
          doctorIds[p.doctor],
          dateTime,
          a.duration ?? 30,
          a.status,
          a.reason,
          a.notes ?? null,
          toLocalISO(atDay(Math.min(a.day, 0) - 14, '12:00')),
        );
        summary.appointments++;

        // Recordatorio para citas activas de los próximos 3 días
        if (a.day >= 0 && a.day <= 3 && (a.status === 'scheduled' || a.status === 'confirmed') && when.getTime() > now - 3_600_000) {
          createAppointmentReminder(
            { patient_id: patientId, date_time: dateTime, reason: a.reason, doctor_name: doctorNames[p.doctor] },
            { createdAt: hoursAgo(6 + a.day), read: false },
          );
          summary.notifications++;
        }
      }

      // --- Métricas (ordenadas cronológicamente) ---
      const readings: {
        type: MetricType;
        point: MetricPoint;
        recordedAt: Date;
        recordedBy: number;
        notes: string | null;
      }[] = [];

      for (const series of p.series) {
        for (let i = 0; i < series.count; i++) {
          const t = series.count === 1 ? 1 : i / (series.count - 1);
          const daysAgo = clamp(Math.round(179 - t * 178 + noise(2)), 1, 180);
          const recordedAt = startOfToday();
          recordedAt.setDate(recordedAt.getDate() - daysAgo);
          recordedAt.setHours(7 + Math.floor(rand() * 3), Math.floor(rand() * 60), 0, 0);

          const point = series.gen(t, i);
          const atClinic = rand() < 0.3;
          const notes = point.notes ?? (atClinic ? 'Measured at clinic' : rand() < 0.15 ? pick(HOME_NOTES) : null);
          readings.push({
            type: series.type,
            point,
            recordedAt,
            recordedBy: atClinic ? doctorIds[p.doctor] : userId,
            notes,
          });
        }
      }

      readings.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

      for (const r of readings) {
        const recordedAt = toLocalISO(r.recordedAt);
        const secondary = r.type === 'blood_pressure' ? (r.point.secondary ?? null) : null;
        const metricId = Number(
          insertMetric.run(
            patientId,
            r.type,
            r.point.value,
            secondary,
            METRIC_UNITS[r.type],
            recordedAt,
            r.recordedBy,
            r.notes,
            recordedAt,
          ).lastInsertRowid,
        );
        summary.metrics++;

        const classification = classifyMetric(r.type, r.point.value, secondary);
        if (classification.status !== 'normal') {
          const ageDays = (now - r.recordedAt.getTime()) / 86_400_000;
          createMetricAlert(
            {
              id: metricId,
              patient_id: patientId,
              metric_type: r.type,
              value: r.point.value,
              secondary_value: secondary,
              unit: METRIC_UNITS[r.type],
              recorded_at: recordedAt,
            },
            { ...classification, status: classification.status },
            { createdAt: recordedAt, read: ageDays > 10 },
          );
          summary.notifications++;
        }
      }
    });

    // --- Notificaciones generales ---
    const byName = (name: string) => patientRefs.find((r) => r.name === name)!.patientId;
    const general: [string, string, string, number, boolean][] = [
      ['Sofia Rossi', 'Lab results available', 'Annual blood work results are available. All values are within normal limits.', 158, true],
      ["Michael O'Brien", 'Great progress!', "You've reached 85% of your weight-loss goal. Keep up the good work!", 5, false],
      ['Alex Morgan', 'Prescription renewal', 'Your levothyroxine prescription can be renewed at your next visit.', 12, true],
      ['Hiroshi Tanaka', 'Holter monitor', 'Please return the Holter monitor to the clinic before your next appointment.', 2, false],
    ];
    for (const [name, title, message, daysAgo, read] of general) {
      createGeneralNotification(byName(name), title, message, { createdAt: hoursAgo(daysAgo * 24 + 3), read });
      summary.notifications++;
    }

    // --- Audit log: actividad de los últimos 3 días ---
    const ips: Record<string, string> = {
      admin: '10.0.0.2',
      martinez: '10.0.0.11',
      chen: '10.0.0.12',
      okonkwo: '10.0.0.13',
    };
    const audit = (
      userId: number | null,
      action: string,
      resource: string,
      resourceId: number | null,
      method: string,
      path: string,
      status: number,
      ip: string,
      hoursBack: number,
    ) => {
      insertAudit.run(
        userId,
        action,
        resource,
        resourceId,
        JSON.stringify({ method, path, status, duration_ms: 5 + Math.floor(rand() * 40) }),
        ip,
        hoursAgo(hoursBack),
      );
      summary.auditEntries++;
    };

    for (let day = 2; day >= 0; day--) {
      const base = day * 24 + 10;
      audit(adminId, 'login', 'auth', null, 'POST', '/api/auth/login', 200, ips.admin, base + 1.5);
      audit(adminId, 'read', 'patients', patientRefs[day].patientId, 'GET', `/api/patients/${patientRefs[day].patientId}`, 200, ips.admin, base + 1.2);

      for (const doctor of DOCTORS) {
        const doctorId = doctorIds[doctor.key];
        const ip = ips[doctor.key];
        const own = patientRefs.filter((r) => r.doctorKey === doctor.key);
        const target = own[day % own.length];
        audit(doctorId, 'login', 'auth', null, 'POST', '/api/auth/login', 200, ip, base + 1);
        audit(doctorId, 'read', 'patients', target.patientId, 'GET', `/api/patients/${target.patientId}`, 200, ip, base + 0.8);
        audit(doctorId, 'read', 'health-metrics', target.patientId, 'GET', `/api/health-metrics/${target.patientId}`, 200, ip, base + 0.7);
        if (day === 0) {
          audit(doctorId, 'update', 'appointments', null, 'PUT', '/api/appointments', 200, ip, base + 0.5);
        }
      }
    }

    const carlos = patientRefs[0];
    audit(null, 'login_failed', 'auth', null, 'POST', '/api/auth/login', 401, '192.168.1.37', 30);
    audit(carlos.userId, 'login', 'auth', null, 'POST', '/api/auth/login', 200, '192.168.1.37', 29.9);
    audit(carlos.userId, 'create', 'health-metrics', null, 'POST', '/api/health-metrics', 201, '192.168.1.37', 29.8);
    audit(carlos.userId, 'read', 'health-metrics', carlos.patientId, 'GET', `/api/health-metrics/${carlos.patientId}`, 200, '192.168.1.37', 29.7);
  })();

  return summary;
}

// ---------------------------------------------------------------------------
// CLI: npm run db:seed  |  npm run db:reset (--reset borra el archivo de BD)
// ---------------------------------------------------------------------------

const isEntryPoint = typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module;
if (isEntryPoint) {
  if (process.argv.includes('--reset') && config.dbPath !== ':memory:') {
    try {
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${config.dbPath}${suffix}`, { force: true });
      console.log(`[db] removed ${config.dbPath}`);
    } catch (err) {
      console.error(`[db] could not remove ${config.dbPath}. Is the server running? (${(err as Error).message})`);
      process.exit(1);
    }
  }

  const db = getDb();
  runMigrations(db);
  const summary = seedDatabase(db);
  console.log('[db] seed complete:', summary);
  console.log(`[db] passwords -> admin: ${SEED_PASSWORDS.admin} | doctors: ${SEED_PASSWORDS.doctor} | patients: ${SEED_PASSWORDS.patient}`);
  closeDb();
}
