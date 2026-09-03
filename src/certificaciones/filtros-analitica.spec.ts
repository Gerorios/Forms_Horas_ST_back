import { Prisma } from '@prisma/client';
import { aLista, condicionesFiltros, filtrosDesdeQuery } from './filtros-analitica';

const lectura = { nivel: 'lectura', ks: [], inc: true };
const carga = (ks: string[]) => ({ nivel: 'carga', ks, inc: false });

describe('condicionesFiltros', () => {
  it('sin filtros y nivel lectura devuelve Prisma.empty (sin condiciones)', () => {
    expect(condicionesFiltros({}, lectura)).toEqual(Prisma.empty);
  });

  it('desde/hasta/tipo generan condiciones con bind params', () => {
    const sql = condicionesFiltros({ desde: '2026-01', hasta: '2026-06', tipo: 'OPEX' }, lectura)!;
    expect(sql.sql).toContain("DATE_FORMAT(fc.fecha, '%Y-%m') >= ?");
    expect(sql.sql).toContain("DATE_FORMAT(fc.fecha, '%Y-%m') <= ?");
    expect(sql.sql).toContain('fc.tipo = ?');
    expect(sql.values).toEqual(['2026-01', '2026-06', 'OPEX']);
  });

  it('tipo fuera de la lista blanca se ignora', () => {
    expect(condicionesFiltros({ tipo: 'ROBADO' }, lectura)).toEqual(Prisma.empty);
  });

  it('nivel carga sin filtro de contratos restringe a sus Ks', () => {
    const sql = condicionesFiltros({}, carga(['K6', 'K11']))!;
    expect(sql.sql).toContain('dc.codigo_k IN');
    expect(sql.values).toEqual(['K6', 'K11']);
  });

  it('nivel carga que pide contratos ajenos devuelve null (fail-closed, NO todo)', () => {
    expect(condicionesFiltros({ contratos: ['K2'] }, carga(['K6']))).toBeNull();
  });

  it('nivel carga interseca lo pedido con lo propio, case-insensitive', () => {
    const sql = condicionesFiltros({ contratos: ['k6', 'K2'] }, carga(['K6', 'K11']))!;
    expect(sql.values).toEqual(['K6']);
  });

  it('provincias van como IN con bind params', () => {
    const sql = condicionesFiltros({ provincias: ['Salta', 'Jujuy'] }, lectura)!;
    expect(sql.sql).toContain('pv.provincia IN');
    expect(sql.values).toEqual(['Salta', 'Jujuy']);
  });
});

describe('aLista', () => {
  it('undefined → [], string → [string], array → array', () => {
    expect(aLista(undefined)).toEqual([]);
    expect(aLista('K6')).toEqual(['K6']);
    expect(aLista(['K6', 'K2'])).toEqual(['K6', 'K2']);
  });
});

describe('filtrosDesdeQuery', () => {
  // Bug heredado del portal (reporte 2026-09-03): el SQL compara
  // DATE_FORMAT(fecha,'%Y-%m') como TEXTO; con desde='2026-01-01' el mes
  // '2026-01' quedaba afuera ('2026-01' < '2026-01-01' por ser más corto) y
  // enero solo aparecía poniendo desde=2025-12-01. Los filtros son mensuales:
  // se recortan a YYYY-MM antes de llegar al SQL.
  it('recorta desde/hasta con día (YYYY-MM-DD del input date) a YYYY-MM', () => {
    const f = filtrosDesdeQuery({ desde: '2026-01-01', hasta: '2026-03-15' });
    expect(f.desde).toBe('2026-01');
    expect(f.hasta).toBe('2026-03');
  });

  it('desde/hasta ya en YYYY-MM quedan igual; basura no-fecha se descarta', () => {
    expect(filtrosDesdeQuery({ desde: '2026-01', hasta: '2026-02' })).toMatchObject({ desde: '2026-01', hasta: '2026-02' });
    expect(filtrosDesdeQuery({ desde: 'ayer' }).desde).toBeUndefined();
  });

  it('normaliza query params a FiltrosAnalitica', () => {
    expect(filtrosDesdeQuery({ contratos: 'K6', desde: '2026-01' })).toEqual({
      desde: '2026-01',
      hasta: undefined,
      contratos: ['K6'],
      provincias: [],
      tipo: undefined,
    });
  });
});
