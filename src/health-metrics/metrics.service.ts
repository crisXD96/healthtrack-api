import type { TokenPayload } from '../auth/auth.types';
import { getDb } from '../database/connection';
import { NotFoundError } from '../middleware/error-handler';
import * as notificationsService from '../notifications/notifications.service';
import type { Notification } from '../notifications/notifications.types';
import { assertCanAccessPatient } from '../patients/patients.service';
import { daysAgoLocalISO, nowLocalISO } from '../utils/dates';
import {
  METRIC_LABELS,
  METRIC_TYPES,
  METRIC_UNITS,
  type CreateMetricDTO,
  type HealthMetric,
  type HealthMetricRow,
  type MetricClassification,
  type MetricFilters,
  type MetricStatus,
  type MetricType,
  type MetricTypeSummary,
  type PatientMetricsSummary,
  type RangeDefinition,
  type Trend,
} from './metrics.types';

/**
 * Rangos clínicos para la detección de anomalías.
 *
 * | Métrica             | Normal     | Warning             | Critical        |
 * |---------------------|------------|---------------------|-----------------|
 * | Presión sistólica   | 90-120     | 121-140 / <90       | >140 / <80      |
 * | Presión diastólica  | 60-80      | 81-90 / <60         | >90 / <50       |
 * | Glucosa (ayunas)    | 70-100     | 101-125 / <70       | >125 / <54      |
 * | Peso                | —          | —                   | — (sin alertas) |
 * | Ritmo cardíaco      | 60-100     | 101-120 / 50-59     | >120 / <50      |
 * | Temperatura         | 36.1-37.2  | 37.3-38.0 / <36.0   | >38.0 / <35.5   |
 * | Saturación O2       | 95-100     | 90-94               | <90             |
 *
 * Cualquier valor fuera del rango normal que no sea critical se considera warning.
 */
export const METRIC_RANGES: Record<Exclude<MetricType, 'weight'> | 'blood_pressure_diastolic', RangeDefinition> = {
  blood_pressure: { normal: [90, 120], critical: { below: 80, above: 140 } },
  blood_pressure_diastolic: { normal: [60, 80], critical: { below: 50, above: 90 } },
  glucose: { normal: [70, 100], critical: { below: 54, above: 125 } },
  heart_rate: { normal: [60, 100], critical: { below: 50, above: 120 } },
  temperature: { normal: [36.1, 37.2], critical: { below: 35.5, above: 38.0 } },
  oxygen_saturation: { normal: [95, 100], critical: { below: 90, above: null } },
};

const SEVERITY_ORDER: Record<MetricStatus, number> = { normal: 0, warning: 1, critical: 2 };

export function classifyValue(value: number, range: RangeDefinition): MetricStatus {
  const { normal, critical } = range;
  if ((critical.above !== null && value > critical.above) || (critical.below !== null && value < critical.below)) {
    return 'critical';
  }
  if (value < normal[0] || value > normal[1]) return 'warning';
  return 'normal';
}

export function classifyMetric(type: MetricType, value: number, secondaryValue: number | null): MetricClassification {
  if (type === 'weight') return { status: 'normal', normalRange: null };

  if (type === 'blood_pressure') {
    const sys = METRIC_RANGES.blood_pressure;
    const dia = METRIC_RANGES.blood_pressure_diastolic;
    let status = classifyValue(value, sys);
    if (secondaryValue !== null && secondaryValue !== undefined) {
      const diaStatus = classifyValue(secondaryValue, dia);
      if (SEVERITY_ORDER[diaStatus] > SEVERITY_ORDER[status]) status = diaStatus;
    }
    return {
      status,
      normalRange: `${sys.normal[0]}-${sys.normal[1]}/${dia.normal[0]}-${dia.normal[1]} ${METRIC_UNITS.blood_pressure}`,
    };
  }

  const range = METRIC_RANGES[type];
  return {
    status: classifyValue(value, range),
    normalRange: `${range.normal[0]}-${range.normal[1]} ${METRIC_UNITS[type]}`,
  };
}

function withStatus(row: HealthMetricRow & { recorded_by_name?: string | null }): HealthMetric {
  return {
    ...row,
    recorded_by_name: row.recorded_by_name ?? null,
    status: classifyMetric(row.metric_type, row.value, row.secondary_value).status,
  };
}

const round1 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);

/** Tendencia: compara la media de la primera y la segunda mitad de las lecturas recientes. */
export function computeTrend(valuesChronological: number[]): Trend {
  if (valuesChronological.length < 4) return 'stable';
  const half = Math.floor(valuesChronological.length / 2);
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const first = avg(valuesChronological.slice(0, half));
  const second = avg(valuesChronological.slice(-half));
  const change = (second - first) / first;
  if (change > 0.02) return 'up';
  if (change < -0.02) return 'down';
  return 'stable';
}

export function getMetricRanges() {
  return { ranges: METRIC_RANGES, units: METRIC_UNITS, labels: METRIC_LABELS };
}

export function getMetricById(id: number): HealthMetric {
  const row = getDb()
    .prepare(
      `SELECT m.*, u.name AS recorded_by_name
       FROM health_metrics m LEFT JOIN users u ON u.id = m.recorded_by
       WHERE m.id = ?`,
    )
    .get(id) as (HealthMetricRow & { recorded_by_name: string | null }) | undefined;
  if (!row) throw new NotFoundError('Health metric');
  return withStatus(row);
}

export function getPatientMetrics(patientId: number, user: TokenPayload, filters: MetricFilters): HealthMetric[] {
  assertCanAccessPatient(patientId, user);

  const where = ['m.patient_id = @patientId'];
  const params: Record<string, unknown> = { patientId, limit: filters.limit ?? 1000 };

  if (filters.type) {
    where.push('m.metric_type = @type');
    params.type = filters.type;
  }
  if (filters.dateFrom) {
    where.push('m.recorded_at >= @dateFrom');
    params.dateFrom = filters.dateFrom;
  }
  if (filters.dateTo) {
    where.push('m.recorded_at <= @dateTo');
    params.dateTo = filters.dateTo;
  }

  const rows = getDb()
    .prepare(
      `SELECT m.*, u.name AS recorded_by_name
       FROM health_metrics m
       LEFT JOIN users u ON u.id = m.recorded_by
       WHERE ${where.join(' AND ')}
       ORDER BY m.recorded_at ASC
       LIMIT @limit`,
    )
    .all(params) as (HealthMetricRow & { recorded_by_name: string | null })[];

  return rows.map(withStatus);
}

export function getPatientSummary(patientId: number, user: TokenPayload): PatientMetricsSummary {
  assertCanAccessPatient(patientId, user);
  const db = getDb();
  const weekAgo = daysAgoLocalISO(7);
  const metrics: MetricTypeSummary[] = [];

  // FIXME: several queries per metric type
  for (const type of METRIC_TYPES) {
    const stats = db
      .prepare(
        `SELECT COUNT(*) AS count, AVG(value) AS average, MIN(value) AS min, MAX(value) AS max,
                AVG(secondary_value) AS secondary_average,
                MIN(secondary_value) AS secondary_min,
                MAX(secondary_value) AS secondary_max
         FROM health_metrics WHERE patient_id = ? AND metric_type = ?`,
      )
      .get(patientId, type) as {
      count: number;
      average: number | null;
      min: number | null;
      max: number | null;
      secondary_average: number | null;
      secondary_min: number | null;
      secondary_max: number | null;
    };

    const latest = db
      .prepare(
        `SELECT * FROM health_metrics WHERE patient_id = ? AND metric_type = ?
         ORDER BY recorded_at DESC LIMIT 1`,
      )
      .get(patientId, type) as HealthMetricRow | undefined;

    const recent = db
      .prepare(
        `SELECT value FROM health_metrics WHERE patient_id = ? AND metric_type = ?
         ORDER BY recorded_at DESC LIMIT 10`,
      )
      .all(patientId, type) as { value: number }[];

    const lastWeek = db
      .prepare(
        `SELECT COUNT(*) AS count FROM health_metrics
         WHERE patient_id = ? AND metric_type = ? AND recorded_at >= ?`,
      )
      .get(patientId, type, weekAgo) as { count: number };

    metrics.push({
      metric_type: type,
      label: METRIC_LABELS[type],
      unit: METRIC_UNITS[type],
      count: stats.count,
      count_last_7_days: lastWeek.count,
      latest: latest
        ? {
            id: latest.id,
            value: latest.value,
            secondary_value: latest.secondary_value,
            recorded_at: latest.recorded_at,
            status: classifyMetric(type, latest.value, latest.secondary_value).status,
          }
        : null,
      average: round1(stats.average),
      min: stats.min,
      max: stats.max,
      secondary_average: round1(stats.secondary_average),
      secondary_min: stats.secondary_min,
      secondary_max: stats.secondary_max,
      trend: computeTrend(recent.map((r) => r.value).reverse()),
    });
  }

  return { patient_id: patientId, generated_at: nowLocalISO(), metrics };
}

export function createMetric(
  dto: CreateMetricDTO,
  user: TokenPayload,
): { metric: HealthMetric; alert: Notification | null } {
  assertCanAccessPatient(dto.patient_id, user);

  const info = getDb()
    .prepare(
      `INSERT INTO health_metrics
         (patient_id, metric_type, value, secondary_value, unit, recorded_at, recorded_by, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      dto.patient_id,
      dto.metric_type,
      dto.value,
      dto.secondary_value ?? null,
      METRIC_UNITS[dto.metric_type],
      dto.recorded_at ?? nowLocalISO(),
      user.userId,
      dto.notes ?? null,
      nowLocalISO(),
    );

  const metric = getMetricById(Number(info.lastInsertRowid));
  const classification = classifyMetric(metric.metric_type, metric.value, metric.secondary_value);

  const alert =
    classification.status === 'normal'
      ? null
      : notificationsService.createMetricAlert(metric, { ...classification, status: classification.status });

  return { metric, alert };
}
