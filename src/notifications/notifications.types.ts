import type { HealthMetricRow, MetricClassification, MetricType } from '../health-metrics/metrics.types';

export const NOTIFICATION_TYPES = ['metric_warning', 'metric_critical', 'appointment_reminder', 'general'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const SEVERITIES = ['info', 'warning', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface NotificationRow {
  id: number;
  patient_id: number;
  type: NotificationType;
  title: string;
  message: string;
  severity: Severity;
  read: number;
  related_metric_id: number | null;
  created_at: string;
}

export interface Notification extends Omit<NotificationRow, 'read'> {
  read: boolean;
  patient_name: string;
  metric_type: MetricType | null;
  metric_value: number | null;
  metric_secondary_value: number | null;
  metric_unit: string | null;
}

export interface NotificationFilters {
  unread?: boolean;
  severity?: Severity;
  limit?: number;
}

export interface MetricAlertClassification extends MetricClassification {
  status: 'warning' | 'critical';
}

export interface AlertOptions {
  /** Fecha de creación explícita (seed); por defecto, ahora */
  createdAt?: string;
  read?: boolean;
}

export type MetricForAlert = Pick<
  HealthMetricRow,
  'id' | 'patient_id' | 'metric_type' | 'value' | 'secondary_value' | 'unit' | 'recorded_at'
>;
