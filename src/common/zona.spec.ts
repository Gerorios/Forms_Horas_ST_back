import { zonaDeProvincia, zonaDePerfil } from './zona';
describe('zonaDeProvincia', () => {
  it.each([['SALTA', 'norte'], ['JUJUY', 'norte'], ['TUCUMAN', 'sur'], ['  salta ', 'norte']])('%s → %s', (p, z) => expect(zonaDeProvincia(p)).toBe(z));
  it.each([[''], ['   '], ['SGO DEL ESTERO'], [null], [undefined]])('sin zona: %s → null', (p) => expect(zonaDeProvincia(p as never)).toBeNull());
});

describe('zonaDePerfil (excepción por persona, 2026-09-11)', () => {
  it('sin excepción, manda la provincia', () => {
    expect(zonaDePerfil('TUCUMAN', null)).toBe('sur');
    expect(zonaDePerfil('SALTA', null)).toBe('norte');
  });

  it('la excepción gana: el caso de Santiago del Estero que se liquida con Tucumán', () => {
    expect(zonaDePerfil('SANTIAGO DEL ESTERO', 'sur')).toBe('sur');
  });

  it('la excepción también gana sobre una provincia que SÍ mapea', () => {
    // Alguien de Salta que por acuerdo se liquida en la hoja del sur.
    expect(zonaDePerfil('SALTA', 'sur')).toBe('sur');
  });

  it('sin excepción y con provincia no mapeada, sigue sin zona (alerta)', () => {
    expect(zonaDePerfil('SANTIAGO DEL ESTERO', null)).toBeNull();
    expect(zonaDePerfil(null, null)).toBeNull();
  });
});
