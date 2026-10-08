-- =====================================================================
-- Lanzamiento de módulos (interno / para todos), lo maneja solo Admin
-- Fecha: 2026-10-08
-- Bases: testing primero; Horas_Sertec en el release, ANTES del deploy del
-- backend y DESPUÉS de los dos SQL de Autogestión de la Seguridad
-- (2026-10-07-autogestion-seguridad.sql, 2026-10-08-seguridad-ajustes.sql).
-- ADR-028.
--
-- Qué hace: crea 3 tablas `sth_modulos_*` y registra Seguridad en estado
-- INTERNO con el rol HyS habilitado. No toca ninguna tabla existente.
-- Los módulos que no figuran en sth_modulos_lanzamiento se ven como siempre.
--
-- Idempotente (IF NOT EXISTS + INSERT IGNORE). ⚠ Orden: si el backend nuevo
-- arranca sin estas tablas, el perfil y el módulo de Seguridad fallan.
--
-- Collation: tablas utf8mb4_unicode_ci como el resto de sth_*; CUIL en
-- utf8mb3_general_ci como sth_usuarios.cuil (si no, la FK falla: error 3780).
--
-- ROLLBACK:
--   DROP TABLE sth_modulos_piloto_usuarios, sth_modulos_piloto_roles,
--              sth_modulos_lanzamiento;
-- =====================================================================

SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';

-- Un renglón por módulo con lanzamiento. `modulo` es la clave que usa el
-- código (@Modulo('seguridad') en el backend, `modulo` en NAV_ITEMS).
CREATE TABLE IF NOT EXISTS sth_modulos_lanzamiento (
  modulo               VARCHAR(40) NOT NULL PRIMARY KEY,
  nombre               VARCHAR(80) NOT NULL,
  estado               ENUM('interno','todos') NOT NULL DEFAULT 'interno',
  actualizado_por_cuil CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NULL,
  created_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_modulo_actualizado_por FOREIGN KEY (actualizado_por_cuil) REFERENCES sth_usuarios(cuil)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Roles que lo ven mientras está interno.
CREATE TABLE IF NOT EXISTS sth_modulos_piloto_roles (
  modulo VARCHAR(40) NOT NULL,
  rol_id INT         NOT NULL,
  PRIMARY KEY (modulo, rol_id),
  CONSTRAINT fk_piloto_rol_modulo FOREIGN KEY (modulo) REFERENCES sth_modulos_lanzamiento(modulo),
  CONSTRAINT fk_piloto_rol_rol    FOREIGN KEY (rol_id) REFERENCES sth_roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Personas sueltas que lo ven mientras está interno.
CREATE TABLE IF NOT EXISTS sth_modulos_piloto_usuarios (
  modulo VARCHAR(40) NOT NULL,
  cuil   CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  PRIMARY KEY (modulo, cuil),
  CONSTRAINT fk_piloto_usuario_modulo FOREIGN KEY (modulo) REFERENCES sth_modulos_lanzamiento(modulo),
  CONSTRAINT fk_piloto_usuario_cuil   FOREIGN KEY (cuil)   REFERENCES sth_usuarios(cuil)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Autogestión de la Seguridad: interno, con HyS (Admin lo ve siempre).
INSERT IGNORE INTO sth_modulos_lanzamiento (modulo, nombre, estado)
VALUES ('seguridad', 'Autogestión de la Seguridad', 'interno');

INSERT IGNORE INTO sth_modulos_piloto_roles (modulo, rol_id)
SELECT 'seguridad', id FROM sth_roles WHERE nombre = 'HyS';

-- ---------------------------------------------------------------------
-- VERIFICACIÓN
--   SELECT * FROM sth_modulos_lanzamiento;            -- seguridad | interno
--   SELECT r.nombre FROM sth_modulos_piloto_roles p
--     JOIN sth_roles r ON r.id = p.rol_id WHERE p.modulo = 'seguridad';  -- HyS
-- =====================================================================
