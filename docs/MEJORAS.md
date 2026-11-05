# Análisis y mejoras — HealthTrack API

Fecha: 2026-11-05. Las 8 deudas intencionales del curso (`// DEBT:` / `// FIXME:` y los tests solo de camino feliz) **no se tocaron**.

## Cambios aplicados

### Backend (`src/`)

| Cambio | Archivo | Motivo |
|---|---|---|
| Cabeceras de seguridad: `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Permissions-Policy` | `middleware/security-headers.ts`, `index.ts` | Defensa básica (clickjacking, MIME sniffing) sin añadir dependencias. |
| `Cache-Control: no-store` en todas las rutas `/api` | `middleware/security-headers.ts` | Las respuestas contienen datos clínicos; no deben quedar en cachés. |
| Limpieza periódica de ventanas caducadas en el rate limiter | `middleware/rate-limiter.ts` | El `Map` crecía sin límite con cada IP distinta. |
| Apagado ordenado (SIGINT/SIGTERM): cierra el servidor y la conexión SQLite | `index.ts` | Evita cortar peticiones en curso y vuelca el WAL. |
| `assertIsDoctor()` compartido | `auth/auth.service.ts` | La misma validación estaba duplicada en `patients.service.ts` y `appointments.service.ts`. Los mensajes de error no cambian. |

### Dashboard (`public/index.html`)

- **Responsive**: los pacientes se muestran como tarjetas por debajo de 1024 px y como tabla completa a partir de ese ancho. Los modales tienen el pie apilado y botones a ancho completo en móvil. Los filtros con scroll horizontal ya no desbordan, y las etiquetas del gráfico se ocultan cuando es estrecho.
- **Accesibilidad**:
  - foco atrapado dentro de los modales, y vuelve al botón que los abrió;
  - Escape cierra el modal o el menú lateral;
  - filas y tarjetas navegables con teclado (Enter/Espacio) y anillo de foco visible;
  - `aria-current` en la navegación, `aria-pressed` en los filtros, `role="tab"`/`aria-selected` en las pestañas de métricas;
  - `role="alert"` en los errores y `aria-live` en los toasts;
  - respeta `prefers-reduced-motion`.
- **UX**:
  - título de pestaña por vista y scroll al inicio al cambiar de vista;
  - bloqueo del scroll de fondo con un modal o el menú abierto;
  - mensaje claro ante HTTP 429, usando `Retry-After`;
  - toasts con icono y contraste AA, centrados en móvil;
  - el contador de no leídas deja de consultar al servidor con la pestaña en segundo plano.
- **Refactor**: helpers `pillClass`, `setError`, `onActivate` y `syncScrollLock`, que quitan código duplicado. También se simplificó `fmt.num`, que contenía un `replace` que no hacía nada.

## Verificación

- `tsc`, build y `vitest` (8/8) en verde.
- Chrome, en 7 anchos (320, 375, 414, 768, 1024, 1280 y 1536 px), con los roles doctor, admin y paciente: 109 combinaciones de vista y ancho, sin desbordamiento horizontal, sin errores de JS y sin iconos sin renderizar. Hubo una prueba de control para confirmar que el detector de desbordamiento funciona.
- Flujos E2E reales:
  - login con error y login correcto, registro (estado vacío), logout;
  - métrica crítica que crea una alerta y sube el contador, y validación del servidor mostrada en el modal;
  - crear una cita, conflicto de horario, cancelar, y confirmación por parte del paciente;
  - marcar una notificación como leída con teclado, y filtros;
  - crear y borrar un paciente;
  - 403 al abrir la ficha de otro paciente;
  - mensaje ante el 429.
- No se verificó el apagado ordenado con señales reales: en Windows no se pueden enviar SIGINT/SIGTERM a un proceso desde fuera.

## Segunda ronda — backend (aplicado)

| Propuesta | Estado | Detalle |
|---|---|---|
| 1. Índices | SQL generado, **sin ejecutar** | `db-scripts/002_add_indexes.sql` (con rollback). Falta la revisión del DBA y la aprobación del manager. Después hay que añadir la migración v2 en `migrations.ts`. |
| 2. Autorregistro como doctor | Aplicado | `SELF_REGISTER_ROLES = ['patient']`; `role` pasa a ser opcional (por defecto `patient`) y `doctor` o `admin` devuelven 403. |
| 3. Citas del doctor | Aplicado | `listAppointments` usa la misma regla que `canAccess`: sus citas más las de sus pacientes asignados. |
| 4. JWT en `localStorage` | Backend aplicado | Cookie `ht_session` HttpOnly + SameSite=Strict + Path=/api (+ Secure en producción), `POST /api/auth/logout`, y `authenticate` acepta Bearer o cookie. El token sigue en el body para no romper clientes de API. **Pendiente:** el frontend todavía lo guarda en `localStorage`. |
| 7. Código muerto | Aplicado | Eliminado `getPatientIdForUser()`. |
| 5 y 6. Tailwind compilado / vitest 4 | No aplicado | Instalan dependencias, y eso requiere revisión del equipo. |

## Tercera ronda — frontend (aplicado)

- **Sesión por cookie**: el dashboard ya no guarda el JWT. En `localStorage` solo queda `ht_session=1`, una marca no sensible que evita llamar a `/auth/me` sin sesión. Al arrancar se borran `ht_token` y `ht_user` que hubieran quedado de versiones anteriores. El logout llama a `POST /api/auth/logout`, y un 401 (por ejemplo, logout desde otra pestaña) devuelve al login.
- **Registro**: se quitó el selector de rol y se añadió una nota que explica que las cuentas de doctor las crea un administrador.
- **Diseño**:
  - botón para mostrar u ocultar la contraseña (login, registro y alta de paciente), que se vuelve a ocultar al enviar;
  - filas de filtros y pestañas sin barra de scroll visible en móvil;
  - título de pestaña con el nombre del paciente, "My Profile" solo en la ficha propia y "Sign in" en el login.
- **Verificación en Chrome**:
  - ciclo completo de sesión: registro, recarga, logout, recarga, y logout desde otra pestaña;
  - 97 combinaciones de vista × ancho × rol sin desbordamiento ni errores;
  - regresión E2E de métricas, citas (con conflicto) y alta y baja de paciente;
  - 8/8 tests.

Limitación: el logout borra la cookie, pero el JWT sigue siendo válido hasta que caduca (24 h), porque es stateless. Para revocarlo haría falta una lista de tokens revocados, que es un cambio de esquema y requiere al DBA.

## Propuestas no aplicadas (requieren revisión)

1. **Índices de base de datos.** Es un cambio de esquema, así que necesita aprobación del DBA y del manager. El SQL propuesto, para `db-scripts/002_indexes.sql` y como migración v2:
   ```sql
   CREATE INDEX idx_metrics_patient_type_date ON health_metrics (patient_id, metric_type, recorded_at);
   CREATE INDEX idx_appointments_doctor_date ON appointments (doctor_id, date_time);
   CREATE INDEX idx_appointments_patient ON appointments (patient_id);
   CREATE INDEX idx_notifications_patient_read ON notifications (patient_id, read);
   CREATE INDEX idx_patients_doctor ON patients (assigned_doctor_id);
   ```
2. **Autorregistro como doctor.** `POST /api/auth/register` permite `role: "doctor"` sin aprobación. Conviene limitarlo a `patient` o añadir un flujo de verificación.
3. **Listado de citas del doctor.** Solo muestra las citas en las que él es el doctor. Sin embargo, `GET /appointments/:id` también le deja ver citas de sus pacientes con otros doctores. Hay que decidir qué regla vale y unificarla.
4. **JWT en `localStorage`.** Cualquier XSS podría leerlo. La alternativa es una cookie `HttpOnly` + `SameSite`.
5. **Tailwind por CDN.** Muestra un aviso en consola y no está pensado para producción. Lo adecuado es compilar el CSS (requiere una dependencia nueva y revisión del equipo).
6. **Dependencias de desarrollo.** `npm audit` reporta vulnerabilidades en la cadena de vitest 3, solo en desarrollo. Actualizar a vitest 4 es una versión mayor y requiere revisión.
7. **Código muerto.** `getPatientIdForUser()` en `patients.service.ts` no se usa.
