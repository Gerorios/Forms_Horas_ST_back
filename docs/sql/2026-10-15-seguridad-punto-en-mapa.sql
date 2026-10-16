-- =====================================================================
-- Autogestión de la Seguridad: punto del reporte marcado en el mapa
-- Fecha: 2026-10-15
-- Bases: testing cuando entra a dev; Horas_Sertec en el release a main,
-- ANTES del deploy del backend. Va después de 2026-10-08-seguridad-ajustes.sql.
-- ADR-027, "Revisión 2026-10-15".
--
-- Paso 1 de 2. El CHECK va aparte, en 2026-10-15-seguridad-punto-en-mapa-check.sql,
-- DESPUÉS de reiniciar el back nuevo: hasta el reinicio el back viejo guarda los
-- puntos sin origen (la columna no tiene default) y el CHECK los rechazaría.
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

-- ---------------------------------------------------------------------
-- VERIFICACIÓN
--   SHOW COLUMNS FROM sth_seg_reportes LIKE 'origen_punto';
--   SELECT origen_punto, COUNT(*) FROM sth_seg_reportes GROUP BY origen_punto;
--     -- 'gps' = los que tienen latitud; NULL = sin punto propio
--
-- ROLLBACK (si el paso 2 ya se aplicó, primero su rollback)
--   ALTER TABLE sth_seg_reportes DROP COLUMN origen_punto;
--   (los puntos del mapa quedan como si fueran de GPS: sin error_metros)
-- =====================================================================
