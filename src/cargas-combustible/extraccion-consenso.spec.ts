import { consensuar, mismoValor, verificarAritmetica } from './extraccion-consenso';

describe('mismoValor', () => {
  it('números iguales sí, distintos no', () => {
    expect(mismoValor(12.5, 12.5)).toBe(true);
    expect(mismoValor(12.5, 12.6)).toBe(false);
  });

  it('textos se comparan normalizados (mayúsculas, acentos, espacios)', () => {
    expect(mismoValor('Estación  SUR', 'estacion sur')).toBe(true);
    expect(mismoValor('Estación Sur', 'Estación Norte')).toBe(false);
  });

  it('ambos null es coincidencia; uno solo null no', () => {
    expect(mismoValor(null, null)).toBe(true);
    expect(mismoValor(null, 'algo')).toBe(false);
    expect(mismoValor('algo', null)).toBe(false);
  });
});

describe('consensuar', () => {
  const CAMPOS = ['nroComprobante', 'litros', 'estacionId'] as const;

  it('campos coincidentes se aceptan y no quedan marcados', () => {
    const r = consensuar(
      { nroComprobante: 'R 0021-00059874', litros: 45.5, estacionId: 7 },
      { nroComprobante: 'R 0021-00059874', litros: 45.5, estacionId: 7 },
      CAMPOS,
    );
    expect(r.valores).toEqual({ nroComprobante: 'R 0021-00059874', litros: 45.5, estacionId: 7 });
    expect(r.camposInseguros).toEqual([]);
  });

  it('un dígito distinto en el remito lo anula y lo marca', () => {
    const r = consensuar(
      { nroComprobante: 'R 0021-00059874', litros: 45.5, estacionId: 7 },
      { nroComprobante: 'R 0021-00059674', litros: 45.5, estacionId: 7 },
      CAMPOS,
    );
    expect(r.valores.nroComprobante).toBeNull();
    expect(r.camposInseguros).toEqual(['nroComprobante']);
    expect(r.valores.litros).toBe(45.5); // los demás sobreviven
  });

  it('estaciones distintas entre lecturas → null (nunca elige una)', () => {
    const r = consensuar(
      { nroComprobante: null, litros: null, estacionId: 7 },
      { nroComprobante: null, litros: null, estacionId: 12 },
      CAMPOS,
    );
    expect(r.valores.estacionId).toBeNull();
    expect(r.camposInseguros).toEqual(['estacionId']);
  });

  it('ambas lecturas en null es consenso, no inseguridad', () => {
    const r = consensuar(
      { nroComprobante: null, litros: null, estacionId: null },
      { nroComprobante: null, litros: null, estacionId: null },
      CAMPOS,
    );
    expect(r.camposInseguros).toEqual([]);
  });
});

describe('verificarAritmetica', () => {
  it('cierra dentro de la tolerancia de $1', () => {
    expect(verificarAritmetica(45.5, 1000, 45500).cierra).toBe(true);
    expect(verificarAritmetica(45.5, 1000, 45500.5).cierra).toBe(true);
  });

  it('no cierra si la diferencia supera $1 y explica el desvío', () => {
    const r = verificarAritmetica(45.5, 1000, 40000);
    expect(r.cierra).toBe(false);
    expect(r.mensaje).toContain('45500.00');
    expect(r.mensaje).toContain('40000.00');
  });

  it('con algún campo en null no se pronuncia', () => {
    expect(verificarAritmetica(null, 1000, 45500).cierra).toBe(true);
    expect(verificarAritmetica(45.5, null, 45500).mensaje).toBeNull();
  });
});
