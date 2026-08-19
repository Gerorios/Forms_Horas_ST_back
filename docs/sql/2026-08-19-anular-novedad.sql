-- Feature: editar/anular novedades (HyS restringido a tipo Ausencia, Admin sin
-- restricción). Aplicar a mano en LAS DOS bases (testing y Horas_Sertec) —
-- NUNCA con prisma migrate/db push (base compartida con otros sistemas). No
-- ejecutar automáticamente: alguien la corre después de revisar.
ALTER TABLE sth_novedades
  ADD COLUMN estado ENUM('activa','anulada') NOT NULL DEFAULT 'activa',
  ADD COLUMN motivo_anulacion TEXT NULL,
  ADD COLUMN anulada_por_cuil CHAR(13) NULL,
  ADD COLUMN anulada_en DATETIME NULL;
