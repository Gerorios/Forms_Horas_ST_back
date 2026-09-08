import { claveProvincia, canonizarProvincia } from './provincias';

describe('claveProvincia', () => {
  it('quita acentos y pasa a mayúsculas', () => {
    expect(claveProvincia('Tucumán')).toBe('TUCUMAN');
  });

  it('recorta y colapsa espacios internos múltiples', () => {
    expect(claveProvincia(' santiago  del Estero ')).toBe('SANTIAGO DEL ESTERO');
  });

  it('Jujuy -> JUJUY', () => {
    expect(claveProvincia('Jujuy')).toBe('JUJUY');
  });

  it('null/undefined -> string vacío', () => {
    expect(claveProvincia(null)).toBe('');
    expect(claveProvincia(undefined)).toBe('');
  });

  it('string vacío -> string vacío', () => {
    expect(claveProvincia('')).toBe('');
  });
});

describe('canonizarProvincia', () => {
  it("'Tucumán' contra ['SALTA', 'TUCUMAN'] -> 'TUCUMAN' (grafía exacta del maestro)", () => {
    expect(canonizarProvincia('Tucumán', ['SALTA', 'TUCUMAN'])).toBe('TUCUMAN');
  });

  it("'CÓRDOBA' con validas ['SALTA'] -> null (no crea variante nueva)", () => {
    expect(canonizarProvincia('CÓRDOBA', ['SALTA'])).toBeNull();
  });

  it('valor vacío o null -> null', () => {
    expect(canonizarProvincia('', ['SALTA'])).toBeNull();
    expect(canonizarProvincia(null, ['SALTA'])).toBeNull();
  });

  it('match exacto sin diferencias -> devuelve la misma grafía', () => {
    expect(canonizarProvincia('SALTA', ['SALTA', 'JUJUY'])).toBe('SALTA');
  });
});
