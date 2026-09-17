import { quincenasHaciaAtras, parseIds, nombreMes, rangoVentanaDiasTrabajados } from './quincena';

describe('quincenasHaciaAtras', () => {
  it('devuelve la cantidad pedida terminando en la quincena dada, ascendente', () => {
    const qs = quincenasHaciaAtras(2026, 8, 1, 4);
    expect(qs).toEqual([
      { anio: 2026, mes: 6, quincena: 2 },
      { anio: 2026, mes: 7, quincena: 1 },
      { anio: 2026, mes: 7, quincena: 2 },
      { anio: 2026, mes: 8, quincena: 1 },
    ]);
  });
  it('cruza el año hacia atrás', () => {
    expect(quincenasHaciaAtras(2026, 1, 1, 2)).toEqual([
      { anio: 2025, mes: 12, quincena: 2 },
      { anio: 2026, mes: 1, quincena: 1 },
    ]);
  });
});

describe('rangoVentanaDiasTrabajados', () => {
  it('sep 1q: 3 quincenas corridas, del 1/8 al 15/9', () => {
    expect(rangoVentanaDiasTrabajados(2026, 9, 1)).toEqual({ desde: new Date(2026, 7, 1), hasta: new Date(2026, 8, 15) });
  });
  it('sep 2q: del 16/8 al 30/9', () => {
    expect(rangoVentanaDiasTrabajados(2026, 9, 2)).toEqual({ desde: new Date(2026, 7, 16), hasta: new Date(2026, 8, 30) });
  });
  it('ene 1q cruza el año: del 1/12 al 15/1', () => {
    expect(rangoVentanaDiasTrabajados(2026, 1, 1)).toEqual({ desde: new Date(2025, 11, 1), hasta: new Date(2026, 0, 15) });
  });
});

describe('parseIds', () => {
  it('parsea lista separada por comas', () => expect(parseIds('1,2,30')).toEqual([1, 2, 30]));
  it('undefined y vacío devuelven undefined', () => {
    expect(parseIds(undefined)).toBeUndefined();
    expect(parseIds('')).toBeUndefined();
    expect(parseIds(',,')).toBeUndefined();
  });
  it('ignora tokens no numéricos', () => expect(parseIds('1,x,2')).toEqual([1, 2]));
});

describe('nombreMes', () => {
  it('devuelve el nombre del mes con inicial mayúscula', () => {
    expect(nombreMes(8)).toBe('Agosto');
    expect(nombreMes(1)).toBe('Enero');
  });
  it('el último mes es diciembre', () => expect(nombreMes(12)).toBe('Diciembre'));
});
