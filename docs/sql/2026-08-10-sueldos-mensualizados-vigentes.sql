-- ADR-016: sueldos mensualizados pasan de MontoMensualizado (clave exacta por
-- quincena, nunca usada con datos reales) a SueldoMensualizado (vigente, por
-- empleado). Aplicar a mano en la BD compartida.
DROP TABLE IF EXISTS sth_montos_mensualizados;

CREATE TABLE sth_sueldos_mensualizados (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cuil CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  vigente_desde DATE NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  UNIQUE KEY sth_sueldos_mensualizados_cuil_vigente_desde_key (cuil, vigente_desde),
  CONSTRAINT sth_sueldos_mensualizados_cuil_fkey FOREIGN KEY (cuil) REFERENCES snuempleados(cuil)
) DEFAULT CHARSET=utf8mb4;
