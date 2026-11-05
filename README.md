# 💙 HealthTrack API

API REST de seguimiento de salud con dashboard visual. Gestiona pacientes, citas médicas y métricas de salud (presión arterial, glucosa, peso, ritmo cardíaco, temperatura, saturación de O2), detecta lecturas fuera de rango y genera notificaciones automáticas.

> Proyecto troncal del **Módulo 10** del curso de Claude Code: los alumnos crearán subagentes especializados (seguridad, testing, documentación, análisis de base de datos...) para trabajar sobre él.

## Inicio rápido

```bash
npm install
npm run dev
```

Abre **http://localhost:3000**. La primera vez que arranca, el servidor crea `healthtrack.db` y carga datos de ejemplo realistas. En la pantalla de login hay botones de acceso rápido (doctor, paciente y admin).

### Requisitos

- Node.js 20 o superior (probado con Node 24)
- `better-sqlite3` usa binarios precompilados; si tu plataforma no los tiene, necesitarás las build tools de tu sistema (Python + compilador de C++).

## Scripts

| Script | Descripción |
|---|---|
| `npm run dev` | Servidor en modo desarrollo con recarga (`tsx watch`) |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm start` | Ejecuta la versión compilada |
| `npm test` | Ejecuta los tests (Vitest, SQLite en memoria) |
| `npm run test:watch` | Tests en modo watch |
| `npm run test:coverage` | Tests con informe de cobertura |
| `npm run db:seed` | Vacía la base de datos y vuelve a cargar los datos de ejemplo |
| `npm run db:reset` | Borra `healthtrack.db` y la regenera (detén antes el servidor) |

## Configuración

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP |
| `DB_PATH` | `./healthtrack.db` | Archivo SQLite (`:memory:` para tests) |
| `NODE_ENV` | `development` | `development`, `test` o `production` |
| `AUTO_SEED` | `true` | Carga los datos de ejemplo si la BD está vacía al arrancar |
| `JWT_SECRET` | — | Secreto para firmar los JWT |

Otros valores: el JWT expira a las 24 h, el rate limit es de 100 peticiones por minuto por IP y CORS solo admite orígenes `localhost` y `127.0.0.1`.

## Autenticación y seguridad

- **Dos formas de autenticarse**:
  - `Authorization: Bearer <token>`, para clientes de API como curl o los tests;
  - la cookie de sesión `ht_session`, que usa el dashboard.
- **La cookie**: login y registro devuelven el token en el body y además fijan la cookie. Es `HttpOnly`, `SameSite=Strict` y `Path=/api`, y en producción también `Secure`, así que el JavaScript del navegador no puede leerla. `POST /api/auth/logout` la borra.
- **Registro público**: solo crea cuentas de **paciente** (`role` es opcional). Las cuentas de doctor las da de alta un administrador.
- **Doctores**: ven sus propias citas y las de sus pacientes asignados, también cuando las atiende otro doctor.
- **Cabeceras**: todas las respuestas llevan cabeceras de seguridad (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`…), y las de `/api` además `Cache-Control: no-store`.
- **Rate limit**: al superarlo la API responde `429` con `Retry-After`, y el dashboard indica cuántos segundos esperar.

## Usuarios de prueba

| Rol | Email | Password |
|---|---|---|
| Admin | `admin@healthtrack.com` | `Admin123!` |
| Doctor (Dr. Elena Martínez) | `elena.martinez@healthtrack.com` | `Doctor123!` |
| Doctor (Dr. James Chen) | `james.chen@healthtrack.com` | `Doctor123!` |
| Doctor (Dr. Sarah Okonkwo) | `sarah.okonkwo@healthtrack.com` | `Doctor123!` |
| Paciente (Carlos Ruiz) | `carlos.ruiz@email.com` | `Patient123!` |

Los otros 7 pacientes usan el mismo password (`Patient123!`): `aisha.rahman`, `michael.obrien`, `sofia.rossi`, `hiroshi.tanaka`, `maria.gonzalez`, `daniel.kim` y `alex.morgan` (todos `@email.com`).

## API

Todas las rutas, excepto register, login y logout, requieren `Authorization: Bearer <token>` o la cookie de sesión.

```bash
# Login
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"elena.martinez@healthtrack.com","password":"Doctor123!"}'

# Registro (solo pacientes)
curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"jane@example.com","password":"Password123","name":"Jane Doe"}'

# Pacientes del doctor
curl -s http://localhost:3000/api/patients -H "Authorization: Bearer $TOKEN"

# Métricas de presión arterial de un paciente
curl -s "http://localhost:3000/api/health-metrics/1?type=blood_pressure&dateFrom=2026-01-01" -H "Authorization: Bearer $TOKEN"

# Registrar una métrica (genera una alerta si está fuera de rango)
curl -s -X POST http://localhost:3000/api/health-metrics \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"patient_id":1,"metric_type":"blood_pressure","value":150,"secondary_value":95}'
```

| Módulo | Endpoints |
|---|---|
| Auth | `POST /api/auth/register` (solo pacientes), `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/auth/doctors` |
| Patients | `GET /api/patients`, `GET /api/patients/:id`, `POST /api/patients`, `PUT /api/patients/:id`, `DELETE /api/patients/:id` (soft delete) |
| Appointments | `GET /api/appointments`, `GET /api/appointments/:id`, `POST /api/appointments`, `PUT /api/appointments/:id`, `DELETE /api/appointments/:id` (cancela la cita) |
| Health Metrics | `GET /api/health-metrics/ranges`, `GET /api/health-metrics/:patientId`, `GET /api/health-metrics/:patientId/summary`, `POST /api/health-metrics` |
| Notifications | `GET /api/notifications`, `GET /api/notifications/unread-count`, `PATCH /api/notifications/:id/read` |

Formato de respuesta:

```jsonc
// Éxito
{ "data": { ... }, "meta": { "total": 8 } }
// Error
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request data", "details": ["value must be a number"] } }
```

## Estructura

```
src/
├── auth/            # registro, login, JWT, roles
├── patients/        # CRUD de pacientes y control de acceso
├── appointments/    # citas con validación de horario y solapamientos
├── health-metrics/  # métricas, rangos clínicos, resumen y tendencias
├── notifications/   # alertas automáticas y recordatorios
├── middleware/      # errores, audit log, rate limiting, cabeceras de seguridad
├── database/        # conexión, migraciones, seed
└── utils/
public/index.html    # dashboard SPA responsive (Tailwind + Chart.js + Lucide vía CDN)
tests/               # Vitest + Supertest
db-scripts/          # SQL para revisión del DBA (001 esquema, 002 índices: pendiente de aprobación)
docs/                # documentación técnica (MEJORAS.md: análisis y cambios aplicados)
```

Más detalle sobre convenciones, rangos clínicos y arquitectura en [`CLAUDE.md`](CLAUDE.md).
