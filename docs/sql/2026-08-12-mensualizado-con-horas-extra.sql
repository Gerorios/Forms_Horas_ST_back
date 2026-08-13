-- ADR-017: régimen "mensualizado" gana un flag opcional permiteHorasExtra
-- (default false). Aplicar a mano en la BD compartida (nunca prisma
-- migrate/db push).
ALTER TABLE sth_perfiles_liquidacion
  ADD COLUMN permite_horas_extra TINYINT(1) NOT NULL DEFAULT 0;
