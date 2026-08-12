-- Addendum plan 2026-08-12 (análisis de quincena): contratos de imputación
-- por perfil de liquidación (M:N). Solo regímenes mensualizado/fijo/por_tantos
-- los usan en el corte por contrato del Análisis (partes iguales, ignora horas).
-- Aplicar a mano en la BD (testing primero; producción recién en el deploy).
-- OJO: el charset/collation de `cuil` debe calzar con el de
-- sth_perfiles_liquidacion.cuil (utf8mb3_general_ci, heredado de snuempleados)
-- o el FK falla con "incompatible".
CREATE TABLE sth_perfil_contratos_imputacion (
  cuil CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  contrato_id INT NOT NULL,
  PRIMARY KEY (cuil, contrato_id),
  CONSTRAINT fk_pci_perfil FOREIGN KEY (cuil) REFERENCES sth_perfiles_liquidacion(cuil),
  CONSTRAINT fk_pci_contrato FOREIGN KEY (contrato_id) REFERENCES sth_contratos(id)
) DEFAULT CHARSET=utf8mb4;
