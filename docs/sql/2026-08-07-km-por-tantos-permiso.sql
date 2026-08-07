-- ADR-014: permiso por usuario para cargar km "por tantos". Aplicar a mano en la BD compartida.
ALTER TABLE sth_usuarios ADD COLUMN puede_cargar_km_por_tantos TINYINT(1) NOT NULL DEFAULT 0;
