-- Alias de estaciones de servicio (plan 2026-08-18, extracción de alta confianza):
-- cómo aparece impreso el nombre en los tickets vs. el nombre del catálogo.
-- Aprobados automáticamente cuando el CUIT del ticket confirma la estación;
-- sugeridos (aprobado = 0) cuando no hay esa prueba.
-- Aplicar a mano en LAS DOS bases (testing y Horas_Sertec).
CREATE TABLE sth_estacion_servicio_alias (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  estacion_id INT          NOT NULL,
  alias       VARCHAR(191) NOT NULL,
  aprobado    TINYINT(1)   NOT NULL DEFAULT 0,
  creado_por  CHAR(13)     NULL,
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY sth_estacion_servicio_alias_alias_key (alias),
  CONSTRAINT sth_estacion_servicio_alias_estacion_fk
    FOREIGN KEY (estacion_id) REFERENCES sth_estaciones_servicio (id)
);
