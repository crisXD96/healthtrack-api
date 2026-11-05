import type { TokenPayload } from '../auth/auth.types';
import { getDb } from '../database/connection';
import { METRIC_LABELS } from '../health-metrics/metrics.types';
import { ForbiddenError, NotFoundError } from '../middleware/error-handler';
import { nowLocalISO, parseLocal } from '../utils/dates';
import type {
  AlertOptions,
  MetricAlertClassification,
  MetricForAlert,
  Notification,
  NotificationFilters,
  NotificationRow,
  NotificationType,
  Severity,
} from './notifications.types';

type NotificationQueryRow = NotificationRow & {
  patient_name: string;
  patient_user_id: number;
  assigned_doctor_id: number | null;
  metric_type: Notification['metric_type'];
  metric_value: number | null;
  metric_secondary_value: number | null;
  metric_unit: string | null;
};

const BASE_SELECT = `
  SELECT
    n.*,
    u.name AS patient_name,
    p.user_id AS patient_user_id,
    p.assigned_doctor_id,
    m.metric_type,
    m.value AS metric_value,
    m.secondary_value AS metric_secondary_value,
    m.unit AS metric_unit
  FROM notifications n
  JOIN patients p ON p.id = n.patient_id
  JOIN users u ON u.id = p.user_id
  LEFT JOIN health_metrics m ON m.id = n.related_metric_id
`;

function mapNotification(row: NotificationQueryRow): Notification {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { patient_user_id, assigned_doctor_id, ...rest } = row;
  return { ...rest, read: row.read === 1 };
}

/** Restringe las notificaciones visibles según el rol del usuario. */
function scopeFor(user: TokenPayload): { clause: string | null; params: Record<string, unknown> } {
  if (user.role === 'patient') return { clause: 'p.user_id = @userId', params: { userId: user.userId } };
  if (user.role === 'doctor') return { clause: 'p.assigned_doctor_id = @userId', params: { userId: user.userId } };
  return { clause: null, params: {} };
}

function formatReading(metric: MetricForAlert): string {
  const value = metric.secondary_value !== null ? `${metric.value}/${metric.secondary_value}` : `${metric.value}`;
  return `${value} ${metric.unit}`;
}

function getPatientName(patientId: number): string {
  const row = getDb()
    .prepare('SELECT u.name FROM patients p JOIN users u ON u.id = p.user_id WHERE p.id = ?')
    .get(patientId) as { name: string } | undefined;
  return row?.name ?? `Patient #${patientId}`;
}

function insertNotification(input: {
  patientId: number;
  type: NotificationType;
  title: string;
  message: string;
  severity: Severity;
  relatedMetricId?: number | null;
  createdAt?: string;
  read?: boolean;
}): number {
  const info = getDb()
    .prepare(
      `INSERT INTO notifications (patient_id, type, title, message, severity, read, related_metric_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.patientId,
      input.type,
      input.title,
      input.message,
      input.severity,
      input.read ? 1 : 0,
      input.relatedMetricId ?? null,
      input.createdAt ?? nowLocalISO(),
    );
  return Number(info.lastInsertRowid);
}

export function getNotificationById(id: number): Notification {
  const row = getDb().prepare(`${BASE_SELECT} WHERE n.id = ?`).get(id) as NotificationQueryRow | undefined;
  if (!row) throw new NotFoundError('Notification');
  return mapNotification(row);
}

/**
 * Crea automáticamente una alerta para una métrica fuera de rango.
 */
export function createMetricAlert(
  metric: MetricForAlert,
  classification: MetricAlertClassification,
  options: AlertOptions = {},
): Notification {
  const label = METRIC_LABELS[metric.metric_type];
  const patientName = getPatientName(metric.patient_id);
  const isCritical = classification.status === 'critical';

  const title = isCritical ? `Critical ${label.toLowerCase()} reading` : `${label} outside normal range`;

  // DEBT: critical message omits the triggering reading
  const message = isCritical
    ? `${patientName} has a critical ${label.toLowerCase()} reading. Immediate clinical review is recommended.`
    : `${patientName}'s ${label.toLowerCase()} reading of ${formatReading(metric)} is outside the normal range` +
      `${classification.normalRange ? ` (${classification.normalRange})` : ''}. Please review at the next visit.`;

  const id = insertNotification({
    patientId: metric.patient_id,
    type: isCritical ? 'metric_critical' : 'metric_warning',
    title,
    message,
    severity: isCritical ? 'critical' : 'warning',
    relatedMetricId: metric.id,
    createdAt: options.createdAt,
    read: options.read,
  });

  return getNotificationById(id);
}

export function createAppointmentReminder(
  appointment: { patient_id: number; date_time: string; reason: string | null; doctor_name: string },
  options: AlertOptions = {},
): Notification {
  const when = parseLocal(appointment.date_time);
  const date = when.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const time = appointment.date_time.slice(11, 16);
  const id = insertNotification({
    patientId: appointment.patient_id,
    type: 'appointment_reminder',
    title: 'Upcoming appointment',
    message: `Reminder: appointment with ${appointment.doctor_name} on ${date} at ${time}${
      appointment.reason ? ` — ${appointment.reason}` : ''
    }.`,
    severity: 'info',
    createdAt: options.createdAt,
    read: options.read,
  });
  return getNotificationById(id);
}

export function createGeneralNotification(
  patientId: number,
  title: string,
  message: string,
  options: AlertOptions = {},
): Notification {
  const id = insertNotification({ patientId, type: 'general', title, message, severity: 'info', ...options });
  return getNotificationById(id);
}

export function listNotifications(user: TokenPayload, filters: NotificationFilters): Notification[] {
  const scope = scopeFor(user);
  const where: string[] = scope.clause ? [scope.clause] : [];
  const params: Record<string, unknown> = { ...scope.params, limit: filters.limit ?? 100 };

  if (filters.unread) where.push('n.read = 0');
  if (filters.severity) {
    where.push('n.severity = @severity');
    params.severity = filters.severity;
  }

  const rows = getDb()
    .prepare(
      `${BASE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT @limit`,
    )
    .all(params) as NotificationQueryRow[];
  return rows.map(mapNotification);
}

export function getUnreadCount(user: TokenPayload): { count: number; critical: number } {
  const scope = scopeFor(user);
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN n.severity = 'critical' THEN 1 ELSE 0 END), 0) AS critical
       FROM notifications n
       JOIN patients p ON p.id = n.patient_id
       WHERE n.read = 0 ${scope.clause ? `AND ${scope.clause}` : ''}`,
    )
    .get(scope.params) as { count: number; critical: number };
  return row;
}

export function markAsRead(id: number, user: TokenPayload): Notification {
  const row = getDb().prepare(`${BASE_SELECT} WHERE n.id = ?`).get(id) as NotificationQueryRow | undefined;
  if (!row) throw new NotFoundError('Notification');

  const allowed =
    user.role === 'admin' ||
    (user.role === 'doctor' && row.assigned_doctor_id === user.userId) ||
    (user.role === 'patient' && row.patient_user_id === user.userId);
  if (!allowed) throw new ForbiddenError('You do not have access to this notification');

  getDb().prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
  return getNotificationById(id);
}
