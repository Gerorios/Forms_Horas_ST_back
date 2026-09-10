-- =====================================================================
-- Certificados múltiples por novedad (hasta 3)
-- Fecha: 2026-09-10
-- Bases: Horas_Sertec (producción) y testing — aplicar en LAS DOS.
--
-- Paso 1 de 2. Este script crea la tabla y COPIA los adjuntos existentes.
-- NO dropea `sth_novedades.adjunto_url`: queda poblada y sin uso para que
-- el rollback del deploy sea volver el código y nada más. El DROP va en un
-- script posterior, recién cuando en producción se verifique que todos los
-- certificados viejos se abren por el camino nuevo.
--
-- ANTES DE APLICAR: backup de sth_novedades (la migración lee de ahí).
-- =====================================================================

CREATE TABLE IF NOT EXISTS sth_novedades_adjuntos (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  novedad_id         INT          NOT NULL,
  path               VARCHAR(255) NOT NULL,
  mimetype           VARCHAR(64)  NOT NULL,
  subido_por_cuil    CHAR(13)     NOT NULL,
  subido_en          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  eliminado_en       DATETIME(3)  NULL,
  eliminado_por_cuil CHAR(13)     NULL,
  INDEX idx_novedad_vigente (novedad_id, eliminado_en),
  CONSTRAINT fk_novedades_adjuntos_novedad
    FOREIGN KEY (novedad_id) REFERENCES sth_novedades(id)
)
-- La collation se declara EXPLÍCITA para igualar a sth_novedades
-- (utf8mb4_unicode_ci). Sin esto la tabla nace con la del servidor
-- (utf8mb4_0900_ai_ci) y el NOT EXISTS de la migración, que compara
-- `a.path = n.adjunto_url`, revienta con "Illegal mix of collations"
-- (error 1267, visto al ensayar el script en testing el 2026-09-10).
ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Auditoría: tres acciones nuevas para los certificados.
--   adjuntar       -> se sumó un certificado
--   quitar_adjunto -> baja lógica (el archivo sigue en disco)
--   borrar_adjunto -> destrucción real del archivo (solo Admin)
--
-- Ampliar un ENUM agregando valores AL FINAL no reescribe la tabla ni
-- toca las filas existentes. Correr ANTES de levantar el código nuevo:
-- sin esto, el primer INSERT de auditoría con 'adjuntar' falla.
-- ---------------------------------------------------------------------
ALTER TABLE sth_auditoria
  MODIFY COLUMN accion ENUM(
    'crear','editar','aprobar','desaprobar','reabrir','anular',
    'adjuntar','quitar_adjunto','borrar_adjunto'
  ) NOT NULL;

-- ---------------------------------------------------------------------
-- Migración de los adjuntos ya cargados.
--
-- Dos datos que la columna vieja nunca guardó y hay que aproximar:
--   * subido_por_cuil <- cargado_por_cuil. El adjunto viejo solo podía
--     entrar al crear la novedad (POST /novedades), así que quien la cargó
--     ES quien subió el archivo. La aproximación es exacta, no un default.
--   * subido_en <- created_at, por el mismo motivo.
--
-- El mimetype se deriva de la extensión del path, que la escribió
-- FsNovedadAdjuntoStorage a partir del mimetype validado en su momento
-- (jpg/png/pdf son los únicos tres valores posibles).
--
-- Idempotente: el NOT EXISTS evita duplicar si el script se corre dos veces.
-- ---------------------------------------------------------------------
INSERT INTO sth_novedades_adjuntos
  (novedad_id, path, mimetype, subido_por_cuil, subido_en)
SELECT
  n.id,
  n.adjunto_url,
  CASE LOWER(SUBSTRING_INDEX(n.adjunto_url, '.', -1))
    WHEN 'jpg' THEN 'image/jpeg'
    WHEN 'png' THEN 'image/png'
    WHEN 'pdf' THEN 'application/pdf'
    ELSE 'application/octet-stream'
  END,
  n.cargado_por_cuil,
  n.created_at
FROM sth_novedades n
WHERE n.adjunto_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sth_novedades_adjuntos a
     WHERE a.novedad_id = n.id AND a.path = n.adjunto_url
  );

-- ---------------------------------------------------------------------
-- VERIFICACIÓN (correr después; las tres deben dar 0 filas / coincidir)
-- ---------------------------------------------------------------------
-- 1) Cada adjunto viejo tiene su fila nueva:
--    SELECT COUNT(*) FROM sth_novedades WHERE adjunto_url IS NOT NULL;
--    SELECT COUNT(*) FROM sth_novedades_adjuntos;
--    -- Al 2026-09-10: 5 y 5 en Horas_Sertec, 1 y 1 en testing.
--
-- 2) Ningún mimetype cayó al fallback:
--    SELECT * FROM sth_novedades_adjuntos WHERE mimetype = 'application/octet-stream';
--
-- 3) Ninguna novedad supera el tope de 3 activos:
--    SELECT novedad_id, COUNT(*) c FROM sth_novedades_adjuntos
--     WHERE eliminado_en IS NULL GROUP BY novedad_id HAVING c > 3;

-- ---------------------------------------------------------------------
-- ROLLBACK
--   DROP TABLE sth_novedades_adjuntos;
--   -- El ENUM ampliado puede quedarse como está: los valores nuevos no
--   -- molestan al código viejo. Solo si se quiere revertir del todo, y
--   -- SIEMPRE después de confirmar que no quedaron filas usándolos
--   -- (SELECT COUNT(*) FROM sth_auditoria
--   --   WHERE accion IN ('adjuntar','quitar_adjunto','borrar_adjunto');):
--   ALTER TABLE sth_auditoria MODIFY COLUMN accion ENUM(
--     'crear','editar','aprobar','desaprobar','reabrir','anular') NOT NULL;
-- `sth_novedades.adjunto_url` queda intacta, así que el código anterior
-- sigue funcionando sin restaurar nada.
-- ---------------------------------------------------------------------
