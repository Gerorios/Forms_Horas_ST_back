-- Verificación post-mudanza: los pares viejo/nuevo deben dar conteos iguales
-- (y suma de montos igual en la fact). Correr en la base recién mudada.
SELECT 'fact' t, (SELECT COUNT(*) FROM fact_certificaciones) viejo,
       (SELECT COUNT(*) FROM sth_cert_certificaciones) nuevo
UNION ALL SELECT 'item', (SELECT COUNT(*) FROM dim_item), (SELECT COUNT(*) FROM sth_cert_items)
UNION ALL SELECT 'contrato', (SELECT COUNT(*) FROM dim_contrato), (SELECT COUNT(*) FROM sth_cert_contratos)
UNION ALL SELECT 'provincia', (SELECT COUNT(*) FROM ma_provincias), (SELECT COUNT(*) FROM sth_cert_provincias)
UNION ALL SELECT 'carga_log', (SELECT COUNT(*) FROM carga_log), (SELECT COUNT(*) FROM sth_cert_cargas_log)
UNION ALL SELECT 'presupuesto', (SELECT COUNT(*) FROM dim_presupuesto_contrato), (SELECT COUNT(*) FROM sth_cert_presupuestos);

SELECT 'fact suma total_mes' t, (SELECT SUM(total_mes) FROM fact_certificaciones) viejo,
       (SELECT SUM(total_mes) FROM sth_cert_certificaciones) nuevo;
