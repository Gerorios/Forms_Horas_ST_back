-- ADR-021: tablas de hechos del cierre de liquidación. Aplicar A MANO en
-- testing y Horas_Sertec (NUNCA prisma migrate).
CREATE TABLE sth_cierres_liquidacion (
  id INT NOT NULL AUTO_INCREMENT,
  anio INT NOT NULL,
  mes INT NOT NULL,
  quincena INT NOT NULL,
  version INT NOT NULL,
  cerrado_por_cuil CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  nota VARCHAR(300) NULL,
  salvedades TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY sth_cierres_liquidacion_periodo_version_key (anio, mes, quincena, version),
  CONSTRAINT sth_cierres_liquidacion_cerrado_por_fkey
    FOREIGN KEY (cerrado_por_cuil) REFERENCES sth_usuarios (cuil)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE sth_cierre_liquidacion_detalle (
  id INT NOT NULL AUTO_INCREMENT,
  cierre_id INT NOT NULL,
  cuil CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  apellido_nombre VARCHAR(70) NOT NULL,
  legajo INT NULL,
  provincia VARCHAR(35) NULL,
  localidad VARCHAR(35) NULL,
  zona ENUM('norte','sur') NULL,
  regimen VARCHAR(20) NOT NULL,
  categoria VARCHAR(30) NULL,
  modalidad_pago VARCHAR(20) NULL,
  tiene_presentismo TINYINT(1) NOT NULL,
  precio_bruto DECIMAL(14,2) NULL,
  horas_total DECIMAL(14,2) NULL,
  horas_cct DECIMAL(14,2) NULL,
  horas_extra DECIMAL(14,2) NULL,
  total_bruto DECIMAL(14,2) NOT NULL,
  monto_horas_extra DECIMAL(14,2) NOT NULL,
  monto_presentismo DECIMAL(14,2) NOT NULL,
  no_remunerativo DECIMAL(14,2) NOT NULL,
  monto_guardias DECIMAL(14,2) NOT NULL,
  monto_productividad DECIMAL(14,2) NOT NULL,
  plus_individual DECIMAL(14,2) NOT NULL,
  km_total DECIMAL(14,2) NULL,
  monto_km_bruto DECIMAL(14,2) NULL,
  monto_a DECIMAL(14,2) NULL,
  monto_b DECIMAL(14,2) NULL,
  novedades_texto VARCHAR(500) NULL,
  salvedad VARCHAR(300) NULL,
  total DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY sth_cierre_detalle_cierre_cuil_key (cierre_id, cuil),
  KEY sth_cierre_detalle_cuil_idx (cuil),
  CONSTRAINT sth_cierre_detalle_cierre_fkey
    FOREIGN KEY (cierre_id) REFERENCES sth_cierres_liquidacion (id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE sth_cierre_dias_trabajados (
  id INT NOT NULL AUTO_INCREMENT,
  cierre_id INT NOT NULL,
  cuil CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  apellido_nombre VARCHAR(70) NOT NULL,
  legajo INT NULL,
  fecha DATE NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY sth_cierre_dias_cierre_cuil_fecha_key (cierre_id, cuil, fecha),
  CONSTRAINT sth_cierre_dias_cierre_fkey
    FOREIGN KEY (cierre_id) REFERENCES sth_cierres_liquidacion (id)
) DEFAULT CHARSET=utf8mb4;
