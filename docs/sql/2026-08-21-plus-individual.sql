-- Feature: precios por período + plus individual (ver ADR-018). Tabla nueva,
-- sin impacto en tablas existentes. Aplicar a mano en LAS DOS bases (testing
-- y Horas_Sertec) — NUNCA con prisma migrate/db push (base compartida con
-- otros sistemas).
CREATE TABLE sth_plus_individual (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  cuil              CHAR(13) NOT NULL,
  anio              INT NOT NULL,
  mes               INT NOT NULL,
  quincena          INT NOT NULL,
  monto             DECIMAL(12, 2) NOT NULL,
  motivo            VARCHAR(200) NOT NULL,
  cargado_por_cuil  CHAR(13) NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_plus_individual_periodo (cuil, anio, mes, quincena)
);
