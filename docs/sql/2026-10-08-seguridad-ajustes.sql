-- =====================================================================
-- Autogestión de la Seguridad: ajustes tras la primera prueba con HyS
-- Fecha: 2026-10-08
-- Bases: testing primero; Horas_Sertec en el deploy, DESPUÉS de
-- 2026-10-07-autogestion-seguridad.sql (en producción se pueden correr los
-- dos juntos en ese orden). ADR-027, "Revisión 2026-10-08".
--
-- Qué hace:
--   1) Punto GPS propio del reporte (obligatorio en la paralización).
--   2) Tabla de inspectores habilitados por HyS (además de HyS).
--   3) Borra los períodos guardados: se reemplazan por filtros de fechas.
--
-- ⚠ El paso 3 es un DROP: los períodos que hubiera se pierden (en testing,
--   el 2026-10-08, había 1 creado en la prueba con HyS). En producción nunca existió.
--
-- ⚠ ESTE SERVIDOR NO ESTÁ EN MODO ESTRICTO: se fuerza en la sesión.
-- =====================================================================

SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';

-- ---------------------------------------------------------------------
-- 1) Punto GPS del reporte, tomado con el botón "Tomar mi ubicación". Manda
-- sobre el de las fotos de cámara. Las tres columnas van juntas o vacías.
-- ---------------------------------------------------------------------
ALTER TABLE sth_seg_reportes
  ADD COLUMN latitud      DECIMAL(9,6) NULL AFTER ubicacion,
  ADD COLUMN longitud     DECIMAL(9,6) NULL AFTER latitud,
  ADD COLUMN error_metros INT UNSIGNED NULL AFTER longitud,
  ADD CONSTRAINT chk_seg_reporte_punto CHECK (
    (latitud IS NULL AND longitud IS NULL AND error_metros IS NULL)
    OR (latitud IS NOT NULL AND longitud IS NOT NULL
        AND latitud BETWEEN -90 AND 90 AND longitud BETWEEN -180 AND 180)
  );

-- ---------------------------------------------------------------------
-- 2) Inspectores: usuarios que, sin ser HyS, pueden cargar inspecciones.
-- Por persona, no por rol. CUIL en utf8mb3_general_ci como sth_usuarios.cuil
-- (ver 2026-10-07-autogestion-seguridad.sql).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sth_seg_inspectores (
  cuil                CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL PRIMARY KEY,
  habilitado_por_cuil CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_seg_inspector_usuario    FOREIGN KEY (cuil)                REFERENCES sth_usuarios(cuil),
  CONSTRAINT fk_seg_inspector_habilitador FOREIGN KEY (habilitado_por_cuil) REFERENCES sth_usuarios(cuil)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3) Sin períodos guardados.
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS sth_seg_periodos;

-- ---------------------------------------------------------------------
-- VERIFICACIÓN
--   SHOW COLUMNS FROM sth_seg_reportes LIKE '%itud';      -- latitud, longitud
--   SELECT COUNT(*) FROM sth_seg_inspectores;              -- 0
--   SHOW TABLES LIKE 'sth_seg_periodos';                   -- vacío
--
-- ROLLBACK
--   ALTER TABLE sth_seg_reportes DROP CHECK chk_seg_reporte_punto,
--     DROP COLUMN latitud, DROP COLUMN longitud, DROP COLUMN error_metros;
--   DROP TABLE sth_seg_inspectores;
--   (los períodos se recrean con el CREATE de 2026-10-07-autogestion-seguridad.sql)
-- =====================================================================
