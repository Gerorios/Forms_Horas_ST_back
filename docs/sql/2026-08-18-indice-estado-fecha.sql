-- Fix de crecimiento (auditoría 2026-08-18): índice compuesto para los filtros
-- dominantes de liquidación (estado='aprobado' AND fecha BETWEEN ...).
-- Aplicar a mano en LAS DOS bases (testing y Horas_Sertec) con prisma db execute.
CREATE INDEX sth_registros_horas_estado_fecha_idx ON sth_registros_horas (estado, fecha);
