-- Alias de tipos de combustible + CUIT de estaciones (grilling 2026-08-11).
-- Aplicar en testing AHORA; Horas_Sertec recién cuando el usuario apruebe el pase a prod.
ALTER TABLE sth_estaciones_servicio
  ADD COLUMN cuit CHAR(11) NULL,
  ADD UNIQUE INDEX ux_estaciones_servicio_cuit (cuit);

CREATE TABLE sth_tipo_combustible_alias (
  id INT NOT NULL AUTO_INCREMENT,
  tipo_combustible_id INT NOT NULL,
  alias VARCHAR(191) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY ux_tipo_combustible_alias_alias (alias),
  KEY ix_alias_tipo (tipo_combustible_id),
  CONSTRAINT fk_alias_tipo_combustible FOREIGN KEY (tipo_combustible_id) REFERENCES sth_tipos_combustible (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
