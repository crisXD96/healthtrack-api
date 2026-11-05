-- =============================================================================
-- HealthTrack API — 002_add_indexes.sql
-- Índices para las consultas más frecuentes. Solo añade índices: no cambia tablas ni datos.
--
-- GENERADO PARA REVISIÓN. NO EJECUTAR AUTOMÁTICAMENTE.
-- Flujo: lo revisa el DBA → lo autoriza el manager → se ejecuta en un entorno controlado.
-- Tras aprobarse, añadir la migración v2 equivalente en src/database/migrations.ts.
-- Motor: SQLite 3. Requiere 001_initial_schema.sql aplicado.
-- =============================================================================

-- Métricas por paciente y tipo, ordenadas por fecha:
--   GET /api/health-metrics/:patientId?type=...  ·  resumen (latest / últimas 10 / últimos 7 días)
CREATE INDEX IF NOT EXISTS idx_health_metrics_patient_type_recorded
    ON health_metrics (patient_id, metric_type, recorded_at);

-- Agenda del doctor y detección de solapamientos (assertSlotAvailable)
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_datetime
    ON appointments (doctor_id, date_time);

-- Citas de un paciente (ficha, last/next appointment en el listado de pacientes)
CREATE INDEX IF NOT EXISTS idx_appointments_patient_datetime
    ON appointments (patient_id, date_time);

-- Notificaciones por paciente y estado de lectura (listado y unread-count)
CREATE INDEX IF NOT EXISTS idx_notifications_patient_read
    ON notifications (patient_id, read);

-- Pacientes asignados a un doctor (listado del doctor, scope de notificaciones)
CREATE INDEX IF NOT EXISTS idx_patients_assigned_doctor
    ON patients (assigned_doctor_id);

-- Búsqueda de la ficha clínica de un usuario (login, /auth/me, control de acceso)
CREATE INDEX IF NOT EXISTS idx_patients_user
    ON patients (user_id);

INSERT INTO schema_migrations (version, name) VALUES (2, 'add_indexes');

-- Rollback (si fuera necesario):
-- DROP INDEX IF EXISTS idx_health_metrics_patient_type_recorded;
-- DROP INDEX IF EXISTS idx_appointments_doctor_datetime;
-- DROP INDEX IF EXISTS idx_appointments_patient_datetime;
-- DROP INDEX IF EXISTS idx_notifications_patient_read;
-- DROP INDEX IF EXISTS idx_patients_assigned_doctor;
-- DROP INDEX IF EXISTS idx_patients_user;
-- DELETE FROM schema_migrations WHERE version = 2;
