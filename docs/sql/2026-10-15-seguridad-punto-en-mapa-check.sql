-- =====================================================================
-- Autogestión de la Seguridad: punto del reporte marcado en el mapa (CHECK)
-- Fecha: 2026-10-15
-- Paso 2 de 2. Va DESPUÉS de 2026-10-15-seguridad-punto-en-mapa.sql y de
-- reiniciar el back nuevo (el que guarda origen_punto). Antes de eso, el back
-- viejo deja origen_punto en NULL y este CHECK rompería la carga de reportes
-- con punto, incluida la paralización con GPS.
-- Bases: testing al mergear a dev; Horas_Sertec en el release, después del
-- pm2 restart del back.
--
-- Antes de correrlo, tiene que dar 0:
--   SELECT COUNT(*) FROM sth_seg_reportes
--    WHERE latitud IS NOT NULL AND origen_punto IS NULL;
-- Si no da 0 (reportes cargados en la ventana del deploy), rellenar primero:
--   UPDATE sth_seg_reportes SET origen_punto = 'gps'
--    WHERE latitud IS NOT NULL AND origen_punto IS NULL;
-- =====================================================================

ALTER TABLE sth_seg_reportes
  ADD CONSTRAINT chk_seg_reporte_origen_punto CHECK (
    (latitud IS NULL AND origen_punto IS NULL)
    OR (latitud IS NOT NULL AND origen_punto IS NOT NULL
        AND (origen_punto = 'gps' OR error_metros IS NULL))
  );

-- ---------------------------------------------------------------------
-- VERIFICACIÓN
--   SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS
--    WHERE CONSTRAINT_NAME = 'chk_seg_reporte_origen_punto';
--
-- ROLLBACK
--   ALTER TABLE sth_seg_reportes DROP CHECK chk_seg_reporte_origen_punto;
-- =====================================================================
