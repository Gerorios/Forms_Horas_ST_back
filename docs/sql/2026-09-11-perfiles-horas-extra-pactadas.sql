-- =====================================================================
-- Horas extra pactadas por perfil — unifica `fijo` y `fijo_105`
-- Fecha: 2026-09-11
-- Bases: Horas_Sertec (producción) y testing — aplicar en LAS DOS.
-- ADR-023. Supera al ADR-020 (régimen fijo_105).
--
-- Paso 1 de 2. Este script agrega la columna, migra los perfiles que hoy
-- son `fijo_105` y achica el ENUM. El DROP de `modalidad_pago` va en un
-- script posterior (2026-09-XX-perfiles-drop-modalidad-pago.sql), recién
-- cuando en producción se verifique el código sin ese campo.
--
-- ORDEN OBLIGATORIO: este script ENTERO va ANTES de levantar el código
-- nuevo, y en este orden interno. Los tres motivos:
--   * ADD COLUMN primero: el schema nuevo declara horasExtraPactadas y
--     Prisma la selecciona en TODO findMany. Sin la columna, se cae.
--   * UPDATE antes del MODIFY: el enum nuevo de Prisma no conoce
--     'fijo_105'. Una sola fila con ese valor tira abajo el módulo
--     entero al deserializar — no un endpoint: perfiles, panel, alertas,
--     análisis y cierres.
--   * MODIFY al final y SOLO con 0 filas en 'fijo_105' (ver la guarda).
--
-- ANTES DE APLICAR:
--   1) Backup JSON completo de sth_perfiles_liquidacion. Incluye
--      modalidad_pago: es el ÚNICO respaldo de ese dato para el rollback
--      del paso 2, que lo dropea.
--   2) Guardar la LISTA DE CUILs que están en fijo_105 (la necesita el
--      rollback; ver la nota al final, es importante).
--
-- ⚠ ESTE SERVIDOR NO ESTÁ EN MODO ESTRICTO
--   Verificado el 2026-09-11: sql_mode = IGNORE_SPACE,NO_ENGINE_SUBSTITUTION
--   (MySQL 8.0.40). Sin STRICT_TRANS_TABLES, si al MODIFY quedara alguna
--   fila en 'fijo_105', MySQL la convierte en '' EN SILENCIO y esa persona
--   desaparece del cálculo de liquidación. Por eso la primera línea fuerza
--   el modo estricto en la sesión: si algo quedó mal, queremos el error
--   1265, no un dato corrupto.
-- =====================================================================

SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';

-- ---------------------------------------------------------------------
-- PRECONDICIÓN — correr y ANOTAR los resultados antes de tocar nada
--   SELECT @@sql_mode;
--   -- debe incluir STRICT_TRANS_TABLES por el SET de arriba
--
--   SELECT regimen, COUNT(*) FROM sth_perfiles_liquidacion GROUP BY regimen;
--   -- Al 2026-09-11 en testing: jornalizado 77, administrativo 14,
--   -- mensualizado 12, fijo_105 11, por_tantos 5, fijo 0. Total 119.
--   -- En Horas_Sertec: anotar acá lo observado el día del deploy.
--
--   ENSAYO EN testing — 2026-09-11, aplicado / revertido / re-aplicado:
--     migradas 11 (fijo_105 -> fijo + 17,50); fijo preexistentes 0;
--     total 119 antes y después; enum vacío 0; cierres congelados 11
--     intactos. El ROLLBACK de abajo se corrió de verdad y devolvió los
--     11 a fijo_105 sin pérdida (119 filas, enum vacío 0).
--
--   SELECT cuil FROM sth_perfiles_liquidacion WHERE regimen = 'fijo_105';
--   -- GUARDAR ESTA LISTA. El rollback la necesita.
--
--   SELECT COUNT(*) FROM sth_cierre_liquidacion_detalle WHERE regimen = 'fijo_105';
--   -- Al 2026-09-11 en testing: 11. Son fotos de cierres ya emitidos:
--   -- NO se tocan y deben seguir en 11 al terminar.
-- ---------------------------------------------------------------------

-- 1) La columna nueva. DECIMAL(5,2): admite 17,5 y topea en 999,99 hs —
--    suficiente, y lo bastante chico como para que cargar un MONTO por
--    error no entre (el arreglo con RRHH se divide por la tarifa AFUERA;
--    acá solo viven horas).
ALTER TABLE sth_perfiles_liquidacion
  ADD COLUMN horas_extra_pactadas DECIMAL(5,2) NULL;

-- 2) Los `fijo` que ya existan conservan su regla actual: 88 puro, sin
--    extra. Un 0 explícito, no NULL — NULL significa "falta cargarlo" y
--    los pondría en alerta sin motivo (ya estaban bien).
--    Al 2026-09-11 en testing esto afecta a 0 filas.
UPDATE sth_perfiles_liquidacion
   SET horas_extra_pactadas = 0
 WHERE regimen = 'fijo'
   AND horas_extra_pactadas IS NULL;

-- 3) Los fijo_105 pasan a ser `fijo` con sus 17,5 hs explícitas. Cobran
--    exactamente lo mismo que antes: 88 de básico + 17,5 extra × 1,5.
UPDATE sth_perfiles_liquidacion
   SET regimen = 'fijo',
       horas_extra_pactadas = 17.50
 WHERE regimen = 'fijo_105';

-- ---------------------------------------------------------------------
-- GUARDA — DEBE DAR 0. Si da cualquier otra cosa, PARAR ACÁ y no correr
-- el ALTER de abajo. Con el SET estricto el ALTER fallaría con error 1265
-- en vez de corromper, pero igual no hay que llegar a eso.
--   SELECT COUNT(*) FROM sth_perfiles_liquidacion WHERE regimen = 'fijo_105';
-- ---------------------------------------------------------------------

-- 4) Achicar el ENUM. Ojo: esto NO es como ampliarlo (ver el script del
--    2026-08-25, que agregó fijo_105 al final sin reescribir filas).
--    Achicar reescribe la tabla y convierte por valor de texto; con ~119
--    filas es instantáneo.
ALTER TABLE sth_perfiles_liquidacion
  MODIFY COLUMN regimen ENUM(
    'jornalizado','fijo','mensualizado','por_tantos','administrativo'
  ) NOT NULL;

-- ---------------------------------------------------------------------
-- VERIFICACIÓN
-- 1) Los ex fijo_105 quedaron como fijo con 17,5:
--    SELECT COUNT(*) FROM sth_perfiles_liquidacion
--     WHERE regimen = 'fijo' AND horas_extra_pactadas = 17.5;
--    -- debe dar exactamente la cantidad de fijo_105 de la precondición
--    -- (11 en testing al 2026-09-11)
--
-- 2) No se perdió ni se duplicó ninguna fila:
--    SELECT COUNT(*) FROM sth_perfiles_liquidacion;   -- 119 en testing
--
-- 3) El enum ya no tiene fijo_105:
--    SHOW COLUMNS FROM sth_perfiles_liquidacion LIKE 'regimen';
--
-- 4) Ningún `fijo` quedó sin horas (serían alertas nuevas no deseadas):
--    SELECT COUNT(*) FROM sth_perfiles_liquidacion
--     WHERE regimen = 'fijo' AND horas_extra_pactadas IS NULL;   -- 0
--
-- 5) NINGUNA fila quedó con el enum vacío (el daño silencioso del modo
--    no estricto; con el SET de arriba no debería poder pasar):
--    SELECT COUNT(*) FROM sth_perfiles_liquidacion WHERE regimen = '';   -- 0
--
-- 6) Los cierres congelados NO se tocaron:
--    SELECT COUNT(*) FROM sth_cierre_liquidacion_detalle
--     WHERE regimen = 'fijo_105';   -- sigue igual que en la precondición
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- ROLLBACK (gratis mientras no se haya asignado a nadie NUEVO como fijo)
--
--   SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';
--
--   ALTER TABLE sth_perfiles_liquidacion
--     MODIFY COLUMN regimen ENUM(
--       'jornalizado','fijo','fijo_105','mensualizado','por_tantos','administrativo'
--     ) NOT NULL;
--
--   UPDATE sth_perfiles_liquidacion
--      SET regimen = 'fijo_105'
--    WHERE cuil IN ( <LA LISTA GUARDADA EN LA PRECONDICIÓN> );
--
--   -- horas_extra_pactadas puede quedarse: el código viejo la ignora.
--   -- Solo si se quiere limpiar del todo:
--   -- ALTER TABLE sth_perfiles_liquidacion DROP COLUMN horas_extra_pactadas;
--
-- ⚠ USAR LA LISTA DE CUILs, NUNCA "WHERE horas_extra_pactadas = 17.5".
--   Después del deploy, un `fijo` con 17,5 puede ser una asignación nueva
--   hecha por el Liquidador, no un ex fijo_105: revertirla lo mandaría a
--   un régimen que esa persona nunca tuvo.
-- ---------------------------------------------------------------------
