-- ADR-021 §6: bono no remunerativo por QUINCENA. Backfill: la fila mensual
-- existente queda como 1Q y se duplica en 2Q (el motor pagaba el bono
-- completo en ambas quincenas — esto es fiel a lo ya liquidado).
--
-- OJO orden (ajustado respecto al brief original tras probar en testing):
-- el INSERT de la fila 2Q duplica (categoria_uocra_id, vigente_desde), así
-- que el unique VIEJO (que no incluye quincena) lo rechaza con P2002 si se
-- corre antes de reemplazar el índice. Por eso el swap de índice va ANTES
-- del INSERT.
ALTER TABLE sth_bonos_no_remunerativos ADD COLUMN quincena TINYINT NOT NULL DEFAULT 1;
ALTER TABLE sth_bonos_no_remunerativos
  DROP INDEX sth_bonos_no_remunerativos_categoria_uocra_id_vigente_desde_key,
  ADD UNIQUE KEY sth_bonos_categoria_vigente_quincena_key (categoria_uocra_id, vigente_desde, quincena);
INSERT INTO sth_bonos_no_remunerativos (categoria_uocra_id, vigente_desde, tipo, valor, quincena)
  SELECT categoria_uocra_id, vigente_desde, tipo, valor, 2
  FROM sth_bonos_no_remunerativos WHERE quincena = 1;
ALTER TABLE sth_bonos_no_remunerativos ALTER COLUMN quincena DROP DEFAULT;
