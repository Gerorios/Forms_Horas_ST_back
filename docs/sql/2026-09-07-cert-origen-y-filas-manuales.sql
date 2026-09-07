-- ============================================================================
-- ⚠️  Después de mergear la Etapa B, `main` NO es deployable hasta aplicar
--     este DDL: el historial hace SELECT de `filas_manuales` y la carga
--     inserta `origen`. Sin estas dos columnas, ambas rutas fallan en runtime.
--     Aplicarlo en las DOS bases ANTES de deployar el backend.
-- ============================================================================

-- Carga de certificaciones controlada (2026-09-07), decisiones 8 y 9.
-- NO EJECUTAR automáticamente. Correr a mano, en el deploy, en las DOS bases
-- (`testing` y `Horas_Sertec`). Verificar antes con SHOW CREATE TABLE.
--
-- Origen de cada fila cargada: 'archivo' (leída del documento) o 'manual'
-- (agregada por la persona en el preview porque el parser no la reconoció).
ALTER TABLE sth_cert_certificaciones
  ADD COLUMN origen ENUM('archivo','manual') NOT NULL DEFAULT 'archivo';

-- Cuántas filas manuales entraron en cada carga (se muestra en el historial).
ALTER TABLE sth_cert_cargas_log
  ADD COLUMN filas_manuales INT NOT NULL DEFAULT 0;

-- Verificación:
-- SELECT COUNT(*) FROM sth_cert_certificaciones WHERE origen <> 'archivo';  -- 0
-- SELECT filas_manuales FROM sth_cert_cargas_log ORDER BY id DESC LIMIT 3; -- 0

-- Rollback (solo si hay que volver el backend a la versión anterior a la
-- Etapa B; borra el dato de origen/filas manuales ya cargado):
-- ALTER TABLE sth_cert_certificaciones DROP COLUMN origen;
-- ALTER TABLE sth_cert_cargas_log DROP COLUMN filas_manuales;
