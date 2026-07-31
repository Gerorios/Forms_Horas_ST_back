-- ADR-013: módulo carga de combustible. Aplicar a mano en la BD compartida (como ADR-012).
ALTER TABLE sth_auditoria MODIFY accion ENUM('crear','editar','aprobar','desaprobar','reabrir','anular') NOT NULL;

CREATE TABLE sth_estaciones_servicio (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(191) NOT NULL UNIQUE,
  localidad VARCHAR(191) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE sth_tipos_combustible (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(191) NOT NULL UNIQUE,
  activo TINYINT(1) NOT NULL DEFAULT 1
) DEFAULT CHARSET=utf8mb4;

INSERT INTO sth_tipos_combustible (nombre) VALUES
  ('Gasoil'), ('Gasoil premium'), ('Súper'), ('Premium'), ('GNC');

CREATE TABLE sth_cargas_combustible (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fecha_carga DATE NOT NULL,
  cargado_por_cuil CHAR(13) NOT NULL,
  movil_id INT NOT NULL,
  litros DECIMAL(8,2) NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  km INT NOT NULL,
  medio_pago ENUM('cuenta_corriente','caja') NOT NULL,
  nro_comprobante VARCHAR(50) NOT NULL,
  estacion_id INT NOT NULL,
  tipo_combustible_id INT NOT NULL,
  provincia_id INT NOT NULL,
  observaciones TEXT NULL,
  foto_path VARCHAR(255) NOT NULL,
  estado ENUM('activa','anulada') NOT NULL DEFAULT 'activa',
  motivo_anulacion TEXT NULL,
  anulada_por_cuil CHAR(13) NULL,
  anulada_en DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_carga_comb_cargador (cargado_por_cuil, fecha_carga),
  INDEX idx_carga_comb_movil (movil_id, fecha_carga),
  CONSTRAINT fk_carga_comb_movil FOREIGN KEY (movil_id) REFERENCES sth_moviles(id),
  CONSTRAINT fk_carga_comb_estacion FOREIGN KEY (estacion_id) REFERENCES sth_estaciones_servicio(id),
  CONSTRAINT fk_carga_comb_tipo FOREIGN KEY (tipo_combustible_id) REFERENCES sth_tipos_combustible(id),
  CONSTRAINT fk_carga_comb_provincia FOREIGN KEY (provincia_id) REFERENCES sth_provincias(id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE sth_carga_combustible_tareas (
  carga_id INT NOT NULL,
  tarea_id INT NOT NULL,
  PRIMARY KEY (carga_id, tarea_id),
  CONSTRAINT fk_cct_carga FOREIGN KEY (carga_id) REFERENCES sth_cargas_combustible(id),
  CONSTRAINT fk_cct_tarea FOREIGN KEY (tarea_id) REFERENCES sth_tareas_catalogo(id)
) DEFAULT CHARSET=utf8mb4;
