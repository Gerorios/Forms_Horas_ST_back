export interface InteranualMes {
  mes: number;
  monto_actual: number | null;
  monto_anterior: number | null;
  pgn_actual: number | null;
  pgn_anterior: number | null;
  var_monto: number | null;
  var_pgn: number | null;
}

export interface InteranualResponse {
  anio_actual: number | null;
  anio_anterior: number | null;
  meses: InteranualMes[];
}

const num = (x: unknown) => (x == null ? 0 : Number(x));
const var1dec = (actual: number | null, anterior: number | null): number | null =>
  actual !== null && anterior !== null && anterior > 0
    ? Math.round(((actual - anterior) / anterior) * 1000) / 10
    : null;

/** Post-procesamiento calcado del portal: años según datos presentes,
 * meses solo los que tienen filas, variación a 1 decimal. */
export function armarInteranual(
  rows: { anio: number; mes: number; monto_total: unknown; pgn_total: unknown }[],
): InteranualResponse {
  const anios = [...new Set(rows.map((r) => r.anio))].sort((a, b) => b - a);
  const anioActual = anios[0] ?? null;
  const anioAnterior = anios[1] ?? null;

  const porMes = new Map<number, InteranualMes>();
  for (const r of rows) {
    let d = porMes.get(r.mes);
    if (!d) {
      d = { mes: r.mes, monto_actual: null, monto_anterior: null, pgn_actual: null, pgn_anterior: null, var_monto: null, var_pgn: null };
      porMes.set(r.mes, d);
    }
    if (r.anio === anioActual) {
      d.monto_actual = num(r.monto_total);
      d.pgn_actual = num(r.pgn_total);
    } else if (r.anio === anioAnterior) {
      d.monto_anterior = num(r.monto_total);
      d.pgn_anterior = num(r.pgn_total);
    }
  }
  for (const d of porMes.values()) {
    d.var_monto = var1dec(d.monto_actual, d.monto_anterior);
    d.var_pgn = var1dec(d.pgn_actual, d.pgn_anterior);
  }
  return {
    anio_actual: anioActual,
    anio_anterior: anioAnterior,
    meses: [...porMes.keys()].sort((a, b) => a - b).map((m) => porMes.get(m)!),
  };
}
