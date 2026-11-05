import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware';
import { parseIdParam } from '../utils/validation';
import * as appointmentsService from './appointments.service';
import {
  validateAppointmentFilters,
  validateCreateAppointment,
  validateUpdateAppointment,
} from './appointments.validation';

const router = Router();
router.use(authenticate);

/** GET /api/appointments?status=&patientId=&dateFrom=&dateTo= — según rol */
router.get('/', (req, res) => {
  const filters = validateAppointmentFilters(req.query as Record<string, unknown>);
  const appointments = appointmentsService.listAppointments(req.user!, filters);
  res.json({ data: appointments, meta: { total: appointments.length } });
});

/** GET /api/appointments/:id */
router.get('/:id', (req, res) => {
  const id = parseIdParam(req.params.id);
  res.json({ data: appointmentsService.getAppointment(id, req.user!) });
});

/** POST /api/appointments — crear cita (doctor o admin) */
router.post('/', requireRole('doctor', 'admin'), (req, res) => {
  const dto = validateCreateAppointment(req.body);
  const appointment = appointmentsService.createAppointment(dto, req.user!);
  res.locals.auditResourceId = appointment.id;
  res.status(201).json({ data: appointment });
});

/** PUT /api/appointments/:id — cambiar estado, reprogramar, añadir notas */
router.put('/:id', (req, res) => {
  const id = parseIdParam(req.params.id);
  const dto = validateUpdateAppointment(req.body);
  res.json({ data: appointmentsService.updateAppointment(id, dto, req.user!) });
});

/** DELETE /api/appointments/:id — cancela la cita (no la borra) */
router.delete('/:id', (req, res) => {
  const id = parseIdParam(req.params.id);
  res.json({ data: appointmentsService.cancelAppointment(id, req.user!) });
});

export default router;
