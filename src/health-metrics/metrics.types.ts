export const METRIC_TYPES = [
  'blood_pressure',
  'glucose',
  'weight',
  'heart_rate',
  'temperature',
  'oxygen_saturation',
] as const;
export type MetricType = (typeof METRIC_TYPES)[number];

export const METRIC_UNITS: Record<MetricType, string> = {
  blood_pressure: 'mmHg',
  glucose: 'mg/dL',
  weight: 'kg',
  heart_rate: 'bpm',
  temperature: '°C',
  oxygen_saturation: '%',
};

export const METRIC_LABELS: Record<MetricType, string> = {
  blood_pressure: 'Blood pressure',
  glucose: 'Glucose',
  weight: 'Weight',
  heart_rate: 'Heart rate',
  temperature: 'Temperature',
  oxygen_saturation: 'Oxygen saturation',
};

export type MetricStatus = 'normal' | 'warning' | 'critical';
export type Trend = 'up' | 'down' | 'stable';

/**
 * Definición de rango: `normal` es el intervalo sano; fuera de él es warning,
 * y por debajo de `critical.below` o por encima de `critical.above` es critical.
 */
export interface RangeDefinition {
  normal: [number, number];
  critical: { below: number | null; above: number | null };
}

export interface HealthMetricRow {
  id: number;
  patient_id: number;
  metric_type: MetricType;
  value: number;
  secondary_value: number | null;
  unit: string;
  recorded_at: string;
  recorded_by: number | null;
  notes: string | null;
  created_at: string;
}

export interface HealthMetric extends HealthMetricRow {
  status: MetricStatus;
  recorded_by_name: string | null;
}

export interface MetricClassification {
  status: MetricStatus;
  /** Rango normal legible, p. ej. "90-120/60-80 mmHg" */
  normalRange: string | null;
}

export interface CreateMetricDTO {
  patient_id: number;
  metric_type: MetricType;
  value: number;
  secondary_value?: number | null;
  recorded_at?: string;
  notes?: string | null;
}

export interface MetricFilters {
  type?: MetricType;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface MetricTypeSummary {
  metric_type: MetricType;
  label: string;
  unit: string;
  count: number;
  count_last_7_days: number;
  latest: {
    id: number;
    value: number;
    secondary_value: number | null;
    recorded_at: string;
    status: MetricStatus;
  } | null;
  average: number | null;
  min: number | null;
  max: number | null;
  secondary_average: number | null;
  secondary_min: number | null;
  secondary_max: number | null;
  trend: Trend;
}

export interface PatientMetricsSummary {
  patient_id: number;
  generated_at: string;
  metrics: MetricTypeSummary[];
}
