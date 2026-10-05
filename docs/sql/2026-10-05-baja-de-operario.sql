-- =====================================================================
-- Baja de Operario con efecto en carga de horas y liquidación
-- Fecha: 2026-10-05
-- Bases: Horas_Sertec (producción) y testing — aplicar en LAS DOS.
-- ADR-026.
--
-- Qué hace:
--   1) Agrega al detalle congelado de los cierres la fecha/estado de baja,
--      los días de ausencia por estado HyS (columnas nuevas del Excel) y si
--      la persona seguía activa en sueldos (hoja BAJAS A REGULARIZAR).
--   2) Hace que el tipo "Baja de Operario" requiera aprobación de HyS: solo
--      una baja CONFIRMADA bloquea horas y liquida $0.
--   3) Pasa a 'pendiente' las bajas ya cargadas (hoy en 'no_aplica'), para
--      que HyS las confirme. Hasta entonces NO tienen efecto.
--
-- ORDEN OBLIGATORIO: este script va ANTES de levantar el código nuevo.
--   * Prisma selecciona TODAS las columnas del detalle en cada lectura de
--     un cierre: sin las columnas nuevas, ver/exportar cierres se cae.
--   * El código busca el tipo por NOMBRE EXACTO 'Baja de Operario'
--     (src/common/baja.ts, TIPO_BAJA). Si en la base se llama distinto,
--     corregir el nombre de la base o la constante ANTES de desplegar.
--
-- Las columnas son NULLABLE a propósito: los cierres anteriores no
-- registraron estos datos y el Excel los muestra vacíos (vacío ≠ 0).
--
-- ⚠ ESTE SERVIDOR NO ESTÁ EN MODO ESTRICTO (ver 2026-09-11-perfiles-...):
--   se fuerza en la sesión para que un dato inválido dé error y no se
--   guarde en silencio.
-- =====================================================================

SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';

-- ---------------------------------------------------------------------
-- PRECONDICIÓN — correr y ANOTAR los resultados antes de tocar nada
--
--   SELECT id, nombre, requiere_aprobacion_hys, genera_plus, activo
--     FROM sth_tipos_novedad WHERE nombre LIKE '%aja%';
--   -- Debe existir UNA fila con nombre EXACTO 'Baja de Operario'
--   -- (mayúsculas y espacios incluidos). En testing al 2026-10-05 NO
--   -- existe: se crea en el paso 4.
--
--   SELECT n.estado, n.estado_hys, COUNT(*)
--     FROM sth_novedades n JOIN sth_tipos_novedad t ON t.id = n.tipo_novedad_id
--    WHERE t.nombre = 'Baja de Operario'
--    GROUP BY n.estado, n.estado_hys;
--   -- Anotar. Las activas en 'no_aplica' son las que pasa a pendiente el
--   -- paso 3.
--
--   SELECT n.operario_cuil, COUNT(*)
--     FROM sth_novedades n JOIN sth_tipos_novedad t ON t.id = n.tipo_novedad_id
--    WHERE t.nombre = 'Baja de Operario' AND n.estado = 'activa'
--      AND n.estado_hys <> 'desaprobada'
--    GROUP BY n.operario_cuil HAVING COUNT(*) > 1;
--   -- Debe dar 0 filas. Si alguien tiene dos bajas vigentes, que HyS
--   -- anule la que sobra: el código toma la confirmada (o la de fecha más
--   -- temprana), pero la regla es una sola por persona.
--
--   SELECT COUNT(*) FROM sth_cierre_liquidacion_detalle;
--   -- Anotar: el paso 1 no agrega ni borra filas.
-- ---------------------------------------------------------------------

-- 1) Columnas nuevas del detalle congelado.
ALTER TABLE sth_cierre_liquidacion_detalle
  ADD COLUMN fecha_baja DATE NULL,
  ADD COLUMN estado_baja VARCHAR(20) NULL,
  ADD COLUMN dias_ausencia_injustificada INT NULL,
  ADD COLUMN dias_ausencia_justificada INT NULL,
  ADD COLUMN dias_ausencia_sin_resolver INT NULL,
  -- snuempleados.activo al cerrar: decide si la baja previa va a la hoja
  -- BAJAS A REGULARIZAR del Excel (activo) o no (ya inactivo).
  ADD COLUMN activo_en_sueldos TINYINT(1) NULL;

-- 2) La baja la confirma HyS con el circuito de aprobación de siempre.
UPDATE sth_tipos_novedad
   SET requiere_aprobacion_hys = 1
 WHERE nombre = 'Baja de Operario';

-- 3) Bajas ya cargadas: entran a la bandeja de HyS como pendientes.
UPDATE sth_novedades n
  JOIN sth_tipos_novedad t ON t.id = n.tipo_novedad_id
   SET n.estado_hys = 'pendiente'
 WHERE t.nombre = 'Baja de Operario'
   AND n.estado = 'activa'
   AND n.estado_hys = 'no_aplica';

-- 4) SOLO EN testing (en producción el tipo ya existe y esto no inserta
--    nada): crear el tipo si falta.
INSERT INTO sth_tipos_novedad (nombre, requiere_aprobacion_hys, genera_plus, activo)
SELECT 'Baja de Operario', 1, 0, 1 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM sth_tipos_novedad WHERE nombre = 'Baja de Operario');

-- ---------------------------------------------------------------------
-- VERIFICACIÓN
-- 1) SHOW COLUMNS FROM sth_cierre_liquidacion_detalle LIKE '%baja%';
--    SHOW COLUMNS FROM sth_cierre_liquidacion_detalle LIKE 'dias_ausencia%';
--    SHOW COLUMNS FROM sth_cierre_liquidacion_detalle LIKE 'activo_en_sueldos';
--    -- 2 + 3 + 1 columnas, todas NULL.
--
-- 2) SELECT COUNT(*) FROM sth_cierre_liquidacion_detalle;
--    -- igual que en la precondición.
--
-- 3) SELECT nombre, requiere_aprobacion_hys FROM sth_tipos_novedad
--     WHERE nombre = 'Baja de Operario';   -- 1 fila, requiere = 1
--
-- 4) SELECT COUNT(*) FROM sth_novedades n
--      JOIN sth_tipos_novedad t ON t.id = n.tipo_novedad_id
--     WHERE t.nombre = 'Baja de Operario' AND n.estado_hys = 'no_aplica';
--    -- 0
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- ROLLBACK (solo antes de que HyS haya confirmado bajas y antes de que se
-- emitan cierres con el código nuevo — esas fotos perderían los datos).
--
--   SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';
--
--   ALTER TABLE sth_cierre_liquidacion_detalle
--     DROP COLUMN fecha_baja,
--     DROP COLUMN estado_baja,
--     DROP COLUMN dias_ausencia_injustificada,
--     DROP COLUMN dias_ausencia_justificada,
--     DROP COLUMN dias_ausencia_sin_resolver,
--     DROP COLUMN activo_en_sueldos;
--
--   UPDATE sth_tipos_novedad SET requiere_aprobacion_hys = 0
--    WHERE nombre = 'Baja de Operario';
--
--   UPDATE sth_novedades n
--     JOIN sth_tipos_novedad t ON t.id = n.tipo_novedad_id
--      SET n.estado_hys = 'no_aplica'
--    WHERE t.nombre = 'Baja de Operario' AND n.estado_hys = 'pendiente';
--
--   -- En testing, si se creó en el paso 4 y no tiene novedades:
--   -- DELETE FROM sth_tipos_novedad WHERE nombre = 'Baja de Operario';
-- ---------------------------------------------------------------------
