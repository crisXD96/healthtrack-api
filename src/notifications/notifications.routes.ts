import { Router } from 'express';
import { authenticate } from '../auth/auth.middleware';
import { ValidationError } from '../middleware/error-handler';
import { parseIdParam } from '../utils/validation';
import * as notificationsService from './notifications.service';
import { SEVERITIES, type NotificationFilters, type Severity } from './notifications.types';

const router = Router();
router.use(authenticate);

function parseFilters(query: Record<string, unknown>): NotificationFilters {
  const errors: string[] = [];
  const filters: NotificationFilters = {};

  if (query.unread !== undefined) filters.unread = query.unread === 'true' || query.unread === '1';
  if (query.severity !== undefined) {
    if (!SEVERITIES.includes(query.severity as Severity)) errors.push(`severity must be one of: ${SEVERITIES.join(', ')}`);
    else filters.severity = query.severity as Severity;
  }
  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) errors.push('limit must be an integer between 1 and 500');
    else filters.limit = limit;
  }

  if (errors.length) throw new ValidationError(errors);
  return filters;
}

/** GET /api/notifications?unread=true&severity=critical&limit=50 — del usuario actual */
router.get('/', (req, res) => {
  const notifications = notificationsService.listNotifications(req.user!, parseFilters(req.query as Record<string, unknown>));
  res.json({ data: notifications, meta: { total: notifications.length } });
});

/** GET /api/notifications/unread-count */
router.get('/unread-count', (req, res) => {
  res.json({ data: notificationsService.getUnreadCount(req.user!) });
});

/** PATCH /api/notifications/:id/read */
router.patch('/:id/read', (req, res) => {
  const id = parseIdParam(req.params.id);
  res.json({ data: notificationsService.markAsRead(id, req.user!) });
});

export default router;
