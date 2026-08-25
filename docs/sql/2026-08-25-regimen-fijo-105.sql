-- Feature: nuevo régimen de liquidación "fijo_105" (ADR-020). Amplía el
-- ENUM existente de sth_perfiles_liquidacion.regimen — no crea tablas ni
-- borra datos. Aplicar a mano en LAS DOS bases (testing y Horas_Sertec) —
-- NUNCA con prisma migrate/db push (base compartida con otros sistemas).
ALTER TABLE sth_perfiles_liquidacion
  MODIFY COLUMN regimen ENUM('jornalizado','fijo','fijo_105','mensualizado','por_tantos','administrativo') NOT NULL;
