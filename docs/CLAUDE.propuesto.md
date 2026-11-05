# HealthTrack API

> **Este proyecto es el proyecto troncal del Módulo 10 del curso de Claude Code. Los alumnos crearán subagentes especializados para trabajar con él.**

API REST de seguimiento de salud (pacientes, citas médicas, métricas de salud con detección de anomalías y notificaciones automáticas) con un dashboard visual SPA servido desde `public/index.html`.

## Stack

- **Runtime**: Node.js (>= 20) + TypeScript (CommonJS)
- **Framework**: Express 4
- **Base de datos**: SQLite con `better-sqlite3` — **sin ORM**, queries SQL directas
- **Auth**: JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`)
- **Tests**: Vitest + Supertest (BD SQLite en memoria)
- **Frontend**: un único HTML con vanilla JS, Tailwind CSS (CDN) y Chart.js (CDN). Sin build step.

## Cómo levantar el entorno

```bash
npm install          # instala dependencias
npm run dev          # servidor con recarga en http://localhost:3000 (crea y siembra la BD si está vacía)
npm test             # tests (Vitest, BD en memoria)
npm run build        # compila TypeScript a dist/
npm run db:seed      # vacía y vuelve a cargar los datos de ejemplo
npm run db:reset     # borra healthtrack.db y la regenera desde cero (detén el servidor antes)
```

Variables de entorno (todas opcionales): `PORT` (3000), `DB_PATH` (`./healthtrack.db`), `NODE_ENV` (`development`), `AUTO_SEED` (`true`), `JWT_SECRET`.

## Estructura de carpetas

```
src/
├── index.ts              # createApp() + start(): middlewares, rutas, estáticos, migraciones y auto-seed
├── config.ts             # Configuración centralizada (puerto, BD, JWT, rate limit, CORS)
├── auth/                 # Registro, login, JWT, middleware authenticate/requireRole, GET /me, GET /doctors
├── patients/             # CRUD de pacientes + assertCanAccessPatient() (control de acceso reutilizado)
├── appointments/         # Citas: horario de consulta 08:00-18:00, solapamientos, transiciones de estado
├── health-metrics/       # Métricas, rangos clínicos (METRIC_RANGES), clasificación, resumen y tendencias
├── notifications/        # Alertas automáticas por métricas, recordatorios de citas, lectura
├── middleware/           # error-handler (AppError y subclases), audit-logger, rate-limiter
├── database/             # connection (singleton), migrations (schema_migrations), seed (datos realistas)
└── utils/                # dates (ISO local), validation (helpers compartidos)
public/index.html         # Dashboard SPA (hash routing: #/dashboard, #/patients/:id, #/metrics?patient=&type=, ...)
tests/                    # setup.ts (BD en memoria + helpers), auth.test.ts, patients.test.ts
db-scripts/               # SQL generado para revisión del DBA (nunca se ejecuta automáticamente)
docs/                     # Documentación técnica
```

Cada módulo de dominio sigue el mismo patrón y es independiente:

| Archivo | Responsabilidad |
|---|---|
| `*.routes.ts` | Router de Express: parsea params, llama a validación y servicio, responde |
| `*.service.ts` | Lógica de negocio y queries SQL (`getDb().prepare(...)`) |
| `*.validation.ts` | Valida y normaliza el body/query; lanza `ValidationError` con la lista de errores |
| `*.types.ts` | Tipos, DTOs y constantes del dominio |

## Convenciones de código

- **Nombres de archivo**: `kebab-case` con sufijo de capa: `metrics.service.ts`, `auth.middleware.ts`.
- **SQL**: siempre con parámetros (`?` o `@nombre`), nunca concatenando input del usuario. Las columnas dinámicas en `UPDATE` salen de listas blancas.
- **Fechas**: los timestamps de negocio se guardan como ISO local sin zona: `YYYY-MM-DDTHH:MM:SS` (ver `src/utils/dates.ts`).
- **Control de acceso**: usa `assertCanAccessPatient(patientId, req.user)` antes de leer o escribir datos clínicos.
- **Formato de respuesta de la API**:
  - Éxito: `{ "data": <objeto|array>, "meta"?: { "total": n } }`
  - Error: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details"?: ["..."] } }`
- **Manejo de errores**: lanza subclases de `AppError` desde servicios/validaciones (`ValidationError` 400, `UnauthorizedError` 401, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409). El `errorHandler` global las traduce. Los handlers `async` se envuelven con `asyncHandler`.
- **Roles**: `admin`, `doctor`, `patient`. Usa `requireRole(...)` en las rutas.
- **Autenticación**: `authenticate` acepta `Authorization: Bearer <jwt>` (clientes de API, tests) o la cookie `ht_session` (HttpOnly, SameSite=Strict, Path=/api) que fijan login/register. Ver `src/auth/session-cookie.ts`.
- **Visibilidad de citas para doctores**: las suyas y las de sus pacientes asignados, igual en el listado y en el detalle.
- **Tests**: un archivo por módulo en `tests/`, con `supertest` contra `createApp()`; usa los helpers de `tests/setup.ts` (`createTestUser`, `createTestPatientRecord`).

## Endpoints

| Método | Ruta | Acceso |
|---|---|---|
| POST | `/api/auth/register` | público (solo `patient`; `role` es opcional) |
| POST | `/api/auth/login` | público (token en el body + cookie `ht_session` HttpOnly) |
| POST | `/api/auth/logout` | público (borra la cookie de sesión) |
| GET | `/api/auth/me` · `/api/auth/doctors` | autenticado |
| GET | `/api/patients` | doctor (sus pacientes), admin (todos), patient (su ficha) |
| GET | `/api/patients/:id` | doctor asignado, admin o el propio paciente |
| POST | `/api/patients` | admin, doctor |
| PUT | `/api/patients/:id` | admin, doctor asignado |
| DELETE | `/api/patients/:id` | admin (soft delete) |
| GET | `/api/appointments` (`status`, `patientId`, `dateFrom`, `dateTo`) | según rol |
| GET/PUT/DELETE | `/api/appointments/:id` | participantes; DELETE = cancelar |
| POST | `/api/appointments` | doctor, admin |
| GET | `/api/health-metrics/ranges` | autenticado |
| GET | `/api/health-metrics/:patientId` (`type`, `dateFrom`, `dateTo`, `limit`) | con acceso al paciente |
| GET | `/api/health-metrics/:patientId/summary` | con acceso al paciente |
| POST | `/api/health-metrics` | con acceso al paciente (genera notificación si está fuera de rango) |
| GET | `/api/notifications` (`unread`, `severity`, `limit`) | del usuario actual |
| GET | `/api/notifications/unread-count` | del usuario actual |
| PATCH | `/api/notifications/:id/read` | del usuario actual |

## Rangos normales de métricas de salud

Definidos en `METRIC_RANGES` (`src/health-metrics/metrics.service.ts`). Fuera del rango normal = **warning**; más allá del umbral crítico = **critical**.

| Métrica | Unidad | Normal | Warning | Critical |
|---|---|---|---|---|
| Presión sistólica | mmHg | 90-120 | 121-140 / <90 | >140 / <80 |
| Presión diastólica | mmHg | 60-80 | 81-90 / <60 | >90 / <50 |
| Glucosa (ayunas) | mg/dL | 70-100 | 101-125 / <70 | >125 / <54 |
| Peso | kg | — | — | — (no genera alertas) |
| Ritmo cardíaco | bpm | 60-100 | 101-120 / 50-59 | >120 / <50 |
| Temperatura | °C | 36.1-37.2 | 37.3-38.0 / <36.0 | >38.0 / <35.5 |
| Saturación O2 | % | 95-100 | 90-94 | <90 |

## Usuarios seed para testing

| Rol | Nombre | Email | Password |
|---|---|---|---|
| admin | Laura Bennett | `admin@healthtrack.com` | `Admin123!` |
| doctor | Dr. Elena Martínez (Cardiología) | `elena.martinez@healthtrack.com` | `Doctor123!` |
| doctor | Dr. James Chen (Medicina general) | `james.chen@healthtrack.com` | `Doctor123!` |
| doctor | Dr. Sarah Okonkwo (Endocrinología) | `sarah.okonkwo@healthtrack.com` | `Doctor123!` |
| patient | Carlos Ruiz — presión arterial en ascenso | `carlos.ruiz@email.com` | `Patient123!` |
| patient | Aisha Rahman — glucosa con picos esporádicos | `aisha.rahman@email.com` | `Patient123!` |
| patient | Michael O'Brien — pérdida de peso constante | `michael.obrien@email.com` | `Patient123!` |
| patient | Sofia Rossi — todo normal y estable | `sofia.rossi@email.com` | `Patient123!` |
| patient | Hiroshi Tanaka — PA en warning, SpO2 limítrofe | `hiroshi.tanaka@email.com` | `Patient123!` |
| patient | Maria González — diabetes tipo 2 mejorando | `maria.gonzalez@email.com` | `Patient123!` |
| patient | Daniel Kim — episodio febril puntual | `daniel.kim@email.com` | `Patient123!` |
| patient | Alex Morgan — control tiroideo | `alex.morgan@email.com` | `Patient123!` |

Asignación: Martínez → Carlos, Hiroshi · Chen → Michael, Sofia, Daniel · Okonkwo → Aisha, Maria, Alex.

Los datos son deterministas y relativos a la fecha en que se ejecuta el seed (siempre hay citas hoy y métricas de los últimos 6 meses).

## Reglas de trabajo

- Cambios de esquema: añade una migración nueva en `src/database/migrations.ts` y genera el SQL equivalente en `db-scripts/` para revisión del DBA. Nunca ejecutes SQL contra bases de datos compartidas.
- No añadas dependencias sin revisión del equipo.
- No hardcodees secretos: usa variables de entorno a través de `src/config.ts`.
