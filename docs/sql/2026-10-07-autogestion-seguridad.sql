-- =====================================================================
-- Autogestión de la Seguridad: tablas del módulo
-- Fecha: 2026-10-07
-- Bases: testing primero (prueba con HyS); Horas_Sertec recién en el
-- deploy. ADR-027. Vocabulario: CONTEXT.md, "Autogestión de la Seguridad".
--
-- Qué hace: crea 7 tablas nuevas `sth_seg_*` y carga los dos catálogos
-- iniciales. NO toca ninguna tabla existente (solo las referencia por FK),
-- así que el código actual sigue funcionando con o sin este script. Se
-- puede correr antes de levantar el código nuevo.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + INSERT IGNORE sobre nombre
-- único. Correrlo dos veces no duplica nada.
--
-- Collation EXPLÍCITA utf8mb4_unicode_ci, igual que el resto de sth_*
-- (sin ella las tablas nacen con utf8mb4_0900_ai_ci, la del servidor, y
-- las comparaciones con otras sth_* revientan con error 1267; ver
-- 2026-09-10-novedades-adjuntos-multiples.sql).
--
-- Las columnas CUIL van en utf8mb3_general_ci, como sth_usuarios.cuil y
-- snuempleados.cuil (aunque la tabla sea utf8mb4): con otra collation la FK
-- a sth_usuarios falla (error 3780, visto al aplicar en testing el
-- 2026-10-07) y los cruces con la nómina dan error 1267.
--
-- Sin FK a snuempleados a propósito (ADR-008: se sincroniza desde otro
-- sistema y además es utf8mb3_general_ci). Los CUIL de involucrados y de
-- movimientos se resuelven contra la nómina en el código.
--
-- ⚠ ESTE SERVIDOR NO ESTÁ EN MODO ESTRICTO: se fuerza en la sesión para
--   que un dato inválido dé error y no se guarde en silencio.
--
-- ROLLBACK (ninguna otra tabla depende de estas):
--   DROP TABLE sth_seg_movimientos_puntos, sth_seg_reporte_fotos,
--              sth_seg_reporte_involucrados, sth_seg_reportes,
--              sth_seg_periodos, sth_seg_motivos_paralizacion,
--              sth_seg_naturalezas;
-- =====================================================================

SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';

-- ---------------------------------------------------------------------
-- Catálogos (los mantiene solo Admin). Una entrada en desuso se
-- desactiva, nunca se borra: los reportes viejos la siguen apuntando.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sth_seg_naturalezas (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  nombre     VARCHAR(80) NOT NULL,
  activo     TINYINT(1)  NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_seg_naturaleza_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sth_seg_motivos_paralizacion (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  nombre     VARCHAR(80) NOT NULL,
  activo     TINYINT(1)  NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_seg_motivo_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Períodos de medición (los define HyS). Que no se superpongan lo valida
-- el código: MySQL no tiene restricciones de exclusión por rango.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sth_seg_periodos (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  nombre          VARCHAR(80) NOT NULL,
  desde           DATE        NOT NULL,
  hasta           DATE        NOT NULL,
  creado_por_cuil CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_seg_periodo_nombre (nombre),
  INDEX idx_seg_periodo_rango (desde, hasta),
  CONSTRAINT chk_seg_periodo_rango CHECK (hasta >= desde),
  CONSTRAINT fk_seg_periodo_creador FOREIGN KEY (creado_por_cuil) REFERENCES sth_usuarios(cuil)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Reporte de Seguridad. La inspección de HyS es un tipo más (ADR-027).
--
-- Qué campos pide cada tipo lo valida el código (naturaleza para
-- aviso/incidente/inspección, motivo para paralización, control del
-- riesgo para todos salvo la propuesta de mejora).
--
-- created_at ES la fecha de envío: editar un pendiente no la cambia.
-- El punto del mapa NO se guarda acá: se deriva de las fotos de cámara
-- (la de menor error), así no hay dos lugares que mantener.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sth_seg_reportes (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  tipo                   ENUM('aviso_riesgo','incidente','paralizacion','propuesta_mejora','inspeccion') NOT NULL,
  autor_cuil             CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  fecha_reporte          DATE         NOT NULL,
  provincia_id           INT          NOT NULL,
  contrato_id            INT          NOT NULL,
  tarea_id               INT          NOT NULL,
  ubicacion              VARCHAR(200) NULL,
  descripcion            TEXT         NOT NULL,
  naturaleza_id          INT          NULL,
  motivo_paralizacion_id INT          NULL,
  control_riesgo         TEXT         NULL,
  estado                 ENUM('pendiente','aprobado','desaprobado','anulado') NOT NULL DEFAULT 'pendiente',
  puntaje                TINYINT UNSIGNED NULL,
  comentario_hys         TEXT         NULL,
  calificado_por_cuil    CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL,
  calificado_en          DATETIME(3)  NULL,
  motivo_anulacion       TEXT         NULL,
  anulado_en             DATETIME(3)  NULL,
  created_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_seg_reporte_estado (estado, tipo),
  INDEX idx_seg_reporte_fecha (fecha_reporte),
  INDEX idx_seg_reporte_autor (autor_cuil, fecha_reporte),
  CONSTRAINT chk_seg_reporte_puntaje CHECK (puntaje IS NULL OR puntaje <= 10),
  -- Solo un aprobado lleva puntaje; desaprobado vale 0 sin guardar nada.
  CONSTRAINT chk_seg_reporte_puntaje_estado CHECK ((estado = 'aprobado') = (puntaje IS NOT NULL)),
  CONSTRAINT fk_seg_reporte_autor      FOREIGN KEY (autor_cuil)             REFERENCES sth_usuarios(cuil),
  CONSTRAINT fk_seg_reporte_calificador FOREIGN KEY (calificado_por_cuil)   REFERENCES sth_usuarios(cuil),
  CONSTRAINT fk_seg_reporte_provincia  FOREIGN KEY (provincia_id)           REFERENCES sth_provincias(id),
  CONSTRAINT fk_seg_reporte_contrato   FOREIGN KEY (contrato_id)            REFERENCES sth_contratos(id),
  CONSTRAINT fk_seg_reporte_tarea      FOREIGN KEY (tarea_id)               REFERENCES sth_tareas_catalogo(id),
  CONSTRAINT fk_seg_reporte_naturaleza FOREIGN KEY (naturaleza_id)          REFERENCES sth_seg_naturalezas(id),
  CONSTRAINT fk_seg_reporte_motivo     FOREIGN KEY (motivo_paralizacion_id) REFERENCES sth_seg_motivos_paralizacion(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Involucrados: personas de la nómina en la situación. En la inspección
-- son las que pierden los puntos.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sth_seg_reporte_involucrados (
  reporte_id INT      NOT NULL,
  cuil       CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  PRIMARY KEY (reporte_id, cuil),
  INDEX idx_seg_involucrado_cuil (cuil),
  CONSTRAINT fk_seg_involucrado_reporte FOREIGN KEY (reporte_id) REFERENCES sth_seg_reportes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Fotos del riesgo / del control, hasta 3 activas por grupo (lo valida el
-- código). Baja lógica como sth_novedades_adjuntos: el archivo queda en
-- disco. Solo una foto de cámara lleva ubicación; error_metros es la
-- precisión que informa el celular.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sth_seg_reporte_fotos (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  reporte_id         INT           NOT NULL,
  grupo              ENUM('riesgo','control') NOT NULL,
  origen             ENUM('camara','galeria') NOT NULL,
  path               VARCHAR(255)  NOT NULL,
  mimetype           VARCHAR(64)   NOT NULL,
  latitud            DECIMAL(9,6)  NULL,
  longitud           DECIMAL(9,6)  NULL,
  error_metros       INT UNSIGNED  NULL,
  subido_por_cuil    CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  subido_en          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  eliminado_en       DATETIME(3)   NULL,
  eliminado_por_cuil CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL,
  INDEX idx_seg_foto_vigente (reporte_id, eliminado_en),
  CONSTRAINT chk_seg_foto_punto CHECK (
    (latitud IS NULL AND longitud IS NULL AND error_metros IS NULL)
    OR (origen = 'camara' AND latitud IS NOT NULL AND longitud IS NOT NULL
        AND latitud BETWEEN -90 AND 90 AND longitud BETWEEN -180 AND 180)
  ),
  CONSTRAINT fk_seg_foto_reporte FOREIGN KEY (reporte_id) REFERENCES sth_seg_reportes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Movimientos de puntos (ADR-027): una fila por persona y reporte, con
-- signo. Los escribe SOLO el servicio que aprueba/recalifica/reabre/
-- desaprueba, en la misma transacción. Un UPDATE a mano sobre
-- sth_seg_reportes deja el ranking desfasado.
--
-- `fecha` es copia de sth_seg_reportes.fecha_reporte (decide el período).
-- Es segura: un reporte con movimientos está aprobado y ya no se edita;
-- para corregirlo hay que reabrirlo, y reabrir borra sus movimientos.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sth_seg_movimientos_puntos (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  reporte_id INT         NOT NULL,
  cuil       CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  fecha      DATE        NOT NULL,
  puntos     SMALLINT    NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_seg_movimiento (reporte_id, cuil),
  INDEX idx_seg_movimiento_ranking (fecha, cuil),
  INDEX idx_seg_movimiento_persona (cuil, fecha),
  CONSTRAINT chk_seg_movimiento_rango CHECK (puntos BETWEEN -10 AND 10),
  CONSTRAINT fk_seg_movimiento_reporte FOREIGN KEY (reporte_id) REFERENCES sth_seg_reportes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Carga inicial de catálogos (planilla de HyS y PDF de capacitación).
-- ---------------------------------------------------------------------
INSERT IGNORE INTO sth_seg_naturalezas (nombre) VALUES
  ('Acto inseguro'),
  ('Caída de objetos'),
  ('Comunicación'),
  ('Condición peligrosa'),
  ('E.P.P'),
  ('Herramientas y Maquinaria'),
  ('Orden y limpieza'),
  ('Señalización'),
  ('Siniestro vial'),
  ('Tropiezos');

INSERT IGNORE INTO sth_seg_motivos_paralizacion (nombre) VALUES
  ('Viento / clima'),
  ('Condición del área'),
  ('Interferencia con equipos'),
  ('Falta de personal'),
  ('Falta o falla de herramientas'),
  ('Procedimiento insuficiente'),
  ('Condición eléctrica'),
  ('Aparición de un riesgo no previsto'),
  ('Falta de comunicación'),
  ('Cambio en las condiciones de trabajo');

-- ---------------------------------------------------------------------
-- VERIFICACIÓN
--   SELECT table_name, table_collation FROM information_schema.tables
--    WHERE table_schema = DATABASE() AND table_name LIKE 'sth_seg%';
--   -- 7 filas, todas utf8mb4_unicode_ci
--   SELECT COUNT(*) FROM sth_seg_naturalezas;          -- 10
--   SELECT COUNT(*) FROM sth_seg_motivos_paralizacion; -- 10
-- =====================================================================
