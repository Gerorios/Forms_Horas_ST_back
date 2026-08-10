import { quincenasHaciaAtras, parseIds } from './quincena';

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

describe('parseIds', () => {
  it('parsea lista separada por comas', () => expect(parseIds('1,2,30')).toEqual([1, 2, 30]));
  it('undefined y vacío devuelven undefined', () => {
    expect(parseIds(undefined)).toBeUndefined();
    expect(parseIds('')).toBeUndefined();
    expect(parseIds(',,')).toBeUndefined();
  });
  it('ignora tokens no numéricos', () => expect(parseIds('1,x,2')).toEqual([1, 2]));
});
