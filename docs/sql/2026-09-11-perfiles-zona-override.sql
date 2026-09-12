-- =====================================================================
-- Excepción de zona por persona (`zona_override`)
-- Fecha: 2026-09-11
-- Bases: Horas_Sertec (producción) y testing — aplicar en LAS DOS.
-- ADR-023 (sección "Excepción de zona").
--
-- Por qué: la zona del Excel se deriva de la provincia (NORTE = Salta +
-- Jujuy, SUR = Tucumán). Apareció un empleado con provincia SANTIAGO DEL
-- ESTERO, que no mapea a ninguna: no salía en ninguna de las dos hojas. Por
-- acuerdo tiene que salir en la de Tucumán, pero eso NO vale para toda la
-- provincia, así que es una excepción por persona y no un mapeo nuevo.
--
-- Va junto con 2026-09-11-perfiles-horas-extra-pactadas.sql, en el mismo
-- deploy (los dos ANTES de levantar el código nuevo). Este es el más simple
-- de los dos: agrega una columna nullable y no toca ni una fila existente.
--
-- ANTES DE APLICAR: el backup de sth_perfiles_liquidacion del otro script ya
-- cubre esta tabla; no hace falta uno nuevo si se corren juntos.
-- =====================================================================

-- PRECONDICIÓN:
--   SHOW COLUMNS FROM sth_perfiles_liquidacion LIKE 'zona_override';  -- 0 filas
--   SELECT COUNT(*) FROM sth_perfiles_liquidacion;                    -- anotar

-- El ENUM iguala a ZonaLiquidacion de Prisma y a la columna `zona` del
-- detalle congelado. NULL (el default) = manda la provincia, que es el caso
-- de todos los perfiles de hoy: esta columna nace sin usarse.
ALTER TABLE sth_perfiles_liquidacion
  ADD COLUMN zona_override ENUM('norte','sur') NULL;

-- VERIFICACIÓN:
--   SHOW COLUMNS FROM sth_perfiles_liquidacion LIKE 'zona_override';  -- 1 fila, Null=YES
--   SELECT COUNT(*) FROM sth_perfiles_liquidacion WHERE zona_override IS NOT NULL;  -- 0
--   SELECT COUNT(*) FROM sth_perfiles_liquidacion;  -- igual que en la precondición
--
-- Después del deploy, el Liquidador carga la excepción desde Perfiles de
-- empleados. Para hacerlo a mano (si hiciera falta antes de la UI):
--   UPDATE sth_perfiles_liquidacion SET zona_override='sur' WHERE cuil='<cuil>';

-- ---------------------------------------------------------------------
-- ROLLBACK (gratis: la columna nace vacía y el código viejo la ignora)
--   ALTER TABLE sth_perfiles_liquidacion DROP COLUMN zona_override;
-- Si ya se cargó alguna excepción, anotar cuáles antes de dropear:
--   SELECT cuil, zona_override FROM sth_perfiles_liquidacion
--    WHERE zona_override IS NOT NULL;
-- ---------------------------------------------------------------------
