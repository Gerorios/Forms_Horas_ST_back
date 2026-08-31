import { zonaDeProvincia } from './zona';
describe('zonaDeProvincia', () => {
  it.each([['SALTA', 'norte'], ['JUJUY', 'norte'], ['TUCUMAN', 'sur'], ['  salta ', 'norte']])('%s → %s', (p, z) => expect(zonaDeProvincia(p)).toBe(z));
  it.each([[''], ['   '], ['SGO DEL ESTERO'], [null], [undefined]])('sin zona: %s → null', (p) => expect(zonaDeProvincia(p as never)).toBeNull());
});
