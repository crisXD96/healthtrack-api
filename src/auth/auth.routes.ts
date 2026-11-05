import { Router } from 'express';
import { asyncHandler } from '../middleware/error-handler';
import { authenticate } from './auth.middleware';
import * as authService from './auth.service';
import { clearSessionCookie, readSessionToken, setSessionCookie } from './session-cookie';

const router = Router();

/**
 * POST /api/auth/register — body: { email, password, name, role? } (solo role=patient).
 * Devuelve el token en el body (clientes de API) y además fija la cookie de sesión HttpOnly.
 */
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    res.locals.auditUserId = result.user.id;
    setSessionCookie(res, result.token);
    res.status(201).json({ data: result });
  }),
);

/** POST /api/auth/login — body: { email, password }. Token en el body + cookie de sesión. */
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const result = await authService.login(req.body);
    res.locals.auditUserId = result.user.id;
    setSessionCookie(res, result.token);
    res.json({ data: result });
  }),
);

/** POST /api/auth/logout — borra la cookie de sesión (no requiere sesión válida). */
router.post('/logout', (req, res) => {
  const token = readSessionToken(req);
  if (token) {
    try {
      res.locals.auditUserId = authService.verifyToken(token).userId;
    } catch {
      /* cookie caducada o inválida: se borra igualmente */
    }
  }
  clearSessionCookie(res);
  res.json({ data: { loggedOut: true } });
});

/** GET /api/auth/me — usuario autenticado actual */
router.get('/me', authenticate, (req, res) => {
  res.json({ data: authService.getUserById(req.user!.userId) });
});

/** GET /api/auth/doctors — lista de doctores (para selects del dashboard) */
router.get('/doctors', authenticate, (_req, res) => {
  res.json({ data: authService.listDoctors() });
});

export default router;
