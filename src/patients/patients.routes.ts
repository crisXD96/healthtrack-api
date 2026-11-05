import { Router } from 'express';
import { authenticate, requireRole } from '../auth/auth.middleware';
import { asyncHandler } from '../middleware/error-handler';
import { parseIdParam } from '../utils/validation';
import * as patientsService from './patients.service';
import { validateCreatePatient, validateUpdatePatient } from './patients.validation';

const router = Router();
router.use(authenticate);

/** GET /api/patients — doctor: sus pacientes · admin: todos · patient: su propia ficha */
router.get('/', (req, res) => {
  const patients = patientsService.listPatients(req.user!);
  res.json({ data: patients, meta: { total: patients.length } });
});

/** GET /api/patients/:id — detalle (doctor asignado, admin o el propio paciente) */
router.get('/:id', (req, res) => {
  const id = parseIdParam(req.params.id);
  res.json({ data: patientsService.getPatientById(id, req.user!) });
});

/** POST /api/patients — crear paciente (admin o doctor) */
router.post(
  '/',
  requireRole('admin', 'doctor'),
  asyncHandler(async (req, res) => {
    const dto = validateCreatePatient(req.body);
    const patient = await patientsService.createPatient(dto, req.user!);
    res.locals.auditResourceId = patient.id;
    res.status(201).json({ data: patient });
  }),
);

/** PUT /api/patients/:id — actualizar (admin o doctor asignado) */
router.put('/:id', requireRole('admin', 'doctor'), (req, res) => {
  const id = parseIdParam(req.params.id);
  const dto = validateUpdatePatient(req.body);
  res.json({ data: patientsService.updatePatient(id, dto, req.user!) });
});

/** DELETE /api/patients/:id — soft delete (solo admin) */
router.delete('/:id', requireRole('admin'), (req, res) => {
  const id = parseIdParam(req.params.id);
  patientsService.deletePatient(id);
  res.json({ data: { id, deleted: true } });
});

export default router;
