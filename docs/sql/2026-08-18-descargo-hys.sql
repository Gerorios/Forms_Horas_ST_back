-- Feature: ausencias justificada/injustificada (descargo de HyS).
-- Aplicar a mano en LAS DOS bases (testing y Horas_Sertec) — NUNCA con
-- prisma migrate/db push (base compartida con otros sistemas). No ejecutar
-- automáticamente: alguien la corre después de revisar.
ALTER TABLE sth_novedades ADD COLUMN descargo_hys TEXT NULL;
