import { Router } from 'express';
import { authenticate } from '../auth/auth.middleware';
import { parseIdParam } from '../utils/validation';
import * as metricsService from './metrics.service';
import { validateCreateMetric, validateMetricFilters } from './metrics.validation';

const router = Router();
router.use(authenticate);

/** GET /api/health-metrics/ranges — rangos clínicos usados para clasificar lecturas */
router.get('/ranges', (_req, res) => {
  res.json({ data: metricsService.getMetricRanges() });
});

/** GET /api/health-metrics/:patientId/summary — últimas lecturas, promedios y tendencias */
router.get('/:patientId/summary', (req, res) => {
  const patientId = parseIdParam(req.params.patientId, 'patientId');
  res.json({ data: metricsService.getPatientSummary(patientId, req.user!) });
});

/** GET /api/health-metrics/:patientId?type=&dateFrom=&dateTo=&limit= */
router.get('/:patientId', (req, res) => {
  const patientId = parseIdParam(req.params.patientId, 'patientId');
  const filters = validateMetricFilters(req.query as Record<string, unknown>);
  const metrics = metricsService.getPatientMetrics(patientId, req.user!, filters);
  res.json({ data: metrics, meta: { total: metrics.length } });
});

/** POST /api/health-metrics — registra una métrica y genera alerta si está fuera de rango */
router.post('/', (req, res) => {
  const dto = validateCreateMetric(req.body);
  const result = metricsService.createMetric(dto, req.user!);
  res.locals.auditResourceId = result.metric.id;
  res.status(201).json({ data: result });
});

export default router;
