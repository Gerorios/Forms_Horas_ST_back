import { armarInteranual } from './interanual';

describe('armarInteranual', () => {
  it('separa año actual/anterior según los datos presentes (no según el calendario)', () => {
    const r = armarInteranual([
      { anio: 2026, mes: 3, monto_total: '200', pgn_total: '20' },
      { anio: 2025, mes: 3, monto_total: '100', pgn_total: '10' },
    ]);
    expect(r.anio_actual).toBe(2026);
    expect(r.anio_anterior).toBe(2025);
    expect(r.meses).toEqual([
      {
        mes: 3, monto_actual: 200, monto_anterior: 100, pgn_actual: 20, pgn_anterior: 10,
        var_monto: 100, var_pgn: 100,
      },
    ]);
  });

  it('con datos de un solo año, anio_anterior es null y las variaciones null', () => {
    const r = armarInteranual([{ anio: 2025, mes: 1, monto_total: '50', pgn_total: '5' }]);
    expect(r.anio_actual).toBe(2025);
    expect(r.anio_anterior).toBeNull();
    expect(r.meses[0].var_monto).toBeNull();
  });

  it('variación redondeada a 1 decimal y null si el anterior es 0', () => {
    const r = armarInteranual([
      { anio: 2026, mes: 1, monto_total: '3', pgn_total: '1' },
      { anio: 2025, mes: 1, monto_total: '9', pgn_total: '0' },
    ]);
    expect(r.meses[0].var_monto).toBe(-66.7);
    expect(r.meses[0].var_pgn).toBeNull();
  });

  it('meses sin datos no se rellenan; salen ordenados ascendente', () => {
    const r = armarInteranual([
      { anio: 2026, mes: 5, monto_total: '1', pgn_total: '1' },
      { anio: 2026, mes: 2, monto_total: '1', pgn_total: '1' },
    ]);
    expect(r.meses.map((m) => m.mes)).toEqual([2, 5]);
  });

  it('sin filas: todo null y meses vacío', () => {
    expect(armarInteranual([])).toEqual({ anio_actual: null, anio_anterior: null, meses: [] });
  });
});
