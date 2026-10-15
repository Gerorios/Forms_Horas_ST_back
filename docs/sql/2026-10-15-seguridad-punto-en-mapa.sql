-- =====================================================================
-- Autogestión de la Seguridad: punto del reporte marcado en el mapa
-- Fecha: 2026-10-15
-- Bases: testing cuando entra a dev; Horas_Sertec en el release a main,
-- ANTES del deploy del backend. Va después de 2026-10-08-seguridad-ajustes.sql.
-- ADR-027, "Revisión 2026-10-15".
--
-- Qué hace:
--   Agrega a sth_seg_reportes de dónde salió el punto propio del reporte:
--   'gps' (botón "Tomar mi ubicación", en el lugar) o 'mapa' (marcado a mano,
--   p. ej. al cargar el reporte más tarde). Los puntos que ya existen son
--   todos de GPS. Un punto del mapa no tiene error en metros.
--
-- ⚠ ESTE SERVIDOR NO ESTÁ EN MODO ESTRICTO: se fuerza en la sesión.
-- =====================================================================

SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';

ALTER TABLE sth_seg_reportes
  ADD COLUMN origen_punto ENUM('gps','mapa') NULL AFTER error_metros;

UPDATE sth_seg_reportes SET origen_punto = 'gps' WHERE latitud IS NOT NULL;

ALTER TABLE sth_seg_reportes
  ADD CONSTRAINT chk_seg_reporte_origen_punto CHECK (
    (latitud IS NULL AND origen_punto IS NULL)
    OR (latitud IS NOT NULL AND origen_punto IS NOT NULL
        AND (origen_punto = 'gps' OR error_metros IS NULL))
  );

-- ---------------------------------------------------------------------
-- VERIFICACIÓN
--   SHOW COLUMNS FROM sth_seg_reportes LIKE 'origen_punto';
--   SELECT origen_punto, COUNT(*) FROM sth_seg_reportes GROUP BY origen_punto;
--     -- 'gps' = los que tienen latitud; NULL = sin punto propio
--
-- ROLLBACK
--   ALTER TABLE sth_seg_reportes DROP CHECK chk_seg_reporte_origen_punto,
--     DROP COLUMN origen_punto;
--   (los puntos del mapa quedan como si fueran de GPS: sin error_metros)
-- =====================================================================
