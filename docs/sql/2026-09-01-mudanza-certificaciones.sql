-- Mudanza de las tablas del portal de certificaciones (spec 2026-09-01, §3).
-- SECCIÓN A: correr en `testing` DURANTE EL DESARROLLO (snapshot para dev).
--            Es aditiva: no toca las tablas viejas (producción del portal).
-- SECCIÓN B: correr en `Horas_Sertec` EN EL DEPLOY (copia cross-schema fresca
--            + vistas de compatibilidad). Requiere un usuario MySQL con
--            grants de lectura sobre `testing` y DDL sobre `Horas_Sertec`.
-- NUNCA correr con prisma migrate (sin baseline, ver prisma/migrations/README.md).

-- ============ SECCIÓN A (base: testing) ============
CREATE TABLE sth_cert_certificaciones LIKE fact_certificaciones;
INSERT INTO sth_cert_certificaciones SELECT * FROM fact_certificaciones;

CREATE TABLE sth_cert_items LIKE dim_item;
INSERT INTO sth_cert_items SELECT * FROM dim_item;

CREATE TABLE sth_cert_contratos LIKE dim_contrato;
INSERT INTO sth_cert_contratos SELECT * FROM dim_contrato;

CREATE TABLE sth_cert_provincias LIKE ma_provincias;
INSERT INTO sth_cert_provincias SELECT * FROM ma_provincias;

CREATE TABLE sth_cert_cargas_log LIKE carga_log;
INSERT INTO sth_cert_cargas_log SELECT * FROM carga_log;

CREATE TABLE sth_cert_presupuestos LIKE dim_presupuesto_contrato;
INSERT INTO sth_cert_presupuestos SELECT * FROM dim_presupuesto_contrato;

-- ============ SECCIÓN B (base: Horas_Sertec, en el deploy) ============
-- B.1 Copias frescas desde testing (el portal siguió escribiendo ahí):
-- CREATE TABLE sth_cert_certificaciones LIKE testing.fact_certificaciones;
-- INSERT INTO sth_cert_certificaciones SELECT * FROM testing.fact_certificaciones;
--   ... (idéntico para las otras 5 tablas renombradas)
-- CREATE TABLE usuarios LIKE testing.usuarios;
-- INSERT INTO usuarios SELECT * FROM testing.usuarios;
--
-- B.2 Vistas de compatibilidad (SOLO Horas_Sertec — el portal las consume
--     con sus nombres viejos; son de tabla única => actualizables, los
--     INSERT de la carga del portal siguen funcionando):
-- CREATE VIEW fact_certificaciones      AS SELECT * FROM sth_cert_certificaciones;
-- CREATE VIEW dim_item                  AS SELECT * FROM sth_cert_items;
-- CREATE VIEW dim_contrato              AS SELECT * FROM sth_cert_contratos;
-- CREATE VIEW ma_provincias             AS SELECT * FROM sth_cert_provincias;
-- CREATE VIEW carga_log                 AS SELECT * FROM sth_cert_cargas_log;
-- CREATE VIEW dim_presupuesto_contrato  AS SELECT * FROM sth_cert_presupuestos;
