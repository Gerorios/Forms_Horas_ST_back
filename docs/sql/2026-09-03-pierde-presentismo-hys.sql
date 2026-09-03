-- Feature: Ausencia justificada puede o no perder presentismo (ADR-022).
-- Aplicar a mano en LAS DOS bases (testing y Horas_Sertec) — NUNCA con
-- prisma migrate/db push (base compartida con otros sistemas). No ejecutar
-- automáticamente: alguien la corre después de revisar.
ALTER TABLE sth_novedades ADD COLUMN pierde_presentismo_hys TINYINT(1) NULL;

-- Backfill: las Ausencias ya justificadas (estado_hys = 'aprobada') antes de
-- este cambio se marcan como "pierde presentismo" (true) — preserva el
-- cálculo ya hecho en liquidaciones cerradas/versionadas, sin recomputar
-- nada retroactivamente. Solo toca Ausencias activas; una anulada nunca
-- afectó el cálculo y no hace falta backfillearla.
UPDATE sth_novedades n
JOIN sth_tipos_novedad t ON t.id = n.tipo_novedad_id
SET n.pierde_presentismo_hys = 1
WHERE t.nombre = 'Ausencia'
  AND n.estado_hys = 'aprobada'
  AND n.estado = 'activa';

-- Excepción puntual (ver ADR-022): los 3 operarios de la última quincena que
-- el usuario ajustó a mano al liquidar sueldos NO se corrigen acá con SQL —
-- se resuelven en la app, reabriendo esas novedades puntuales y volviendo a
-- "Justificar" marcando "no pierde presentismo".
