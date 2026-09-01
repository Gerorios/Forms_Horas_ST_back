import { construirEstadoCargas } from './estado-cargas';

const HOY = new Date(2025, 2, 15); // 2025-03-15 (día >= 10: incluye el mes en curso)

describe('construirEstadoCargas', () => {
  it('arma la grilla 2025-01..mes actual (más reciente primero) por contrato visible', () => {
    const r = construirEstadoCargas(['K5'], [], HOY);
    expect(r.map((f) => f.periodo)).toEqual(['2025-03', '2025-02', '2025-01']);
    expect(r.every((f) => f.contrato === 'K5' && f.cargado === false && f.usuario === null)).toBe(true);
  });

  it('un log con contrato CSV "K5, K6" marca cargados a los dos', () => {
    const r = construirEstadoCargas(['K5', 'K6'], [{
      contrato: 'K5, K6', periodo: '2025-01', usuario_nombre: 'Ana',
      cargado_en: new Date(2025, 1, 3, 10, 30), filas_cargadas: 12, estado: 'ok',
    }], HOY);
    const enero = r.filter((f) => f.periodo === '2025-01');
    expect(enero).toEqual([
      { contrato: 'K5', periodo: '2025-01', cargado: true, usuario: 'Ana', cargado_en: '2025-02-03', filas_cargadas: 12, estado: 'ok' },
      { contrato: 'K6', periodo: '2025-01', cargado: true, usuario: 'Ana', cargado_en: '2025-02-03', filas_cargadas: 12, estado: 'ok' },
    ]);
  });

  it('deduplica quedándose con la primera fila por contrato+periodo (orden de entrada)', () => {
    const base = { contrato: 'K5', periodo: '2025-01', filas_cargadas: 1, estado: 'ok', cargado_en: null };
    const r = construirEstadoCargas(['K5'], [
      { ...base, usuario_nombre: 'Primera' },
      { ...base, usuario_nombre: 'Segunda' },
    ], HOY);
    expect(r.find((f) => f.periodo === '2025-01')!.usuario).toBe('Primera');
  });

  it('contratos fuera de la lista visible se ignoran', () => {
    const r = construirEstadoCargas(['K5'], [{
      contrato: 'K6', periodo: '2025-01', usuario_nombre: 'Ana', cargado_en: null, filas_cargadas: 1, estado: 'ok',
    }], HOY);
    expect(r.find((f) => f.periodo === '2025-01')!.cargado).toBe(false);
  });

  it('antes del día 10 el mes en curso se omite entero', () => {
    const r = construirEstadoCargas(['K5'], [], new Date(2025, 2, 9)); // 2025-03-09
    expect(r.map((f) => f.periodo)).toEqual(['2025-02', '2025-01']);
  });
});
