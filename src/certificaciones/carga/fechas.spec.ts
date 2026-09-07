import { parsearFechaDMA } from './fechas';

describe('parsearFechaDMA (D/M/AAAA -> AAAA-MM-DD)', () => {
  it("'4/9/2026' -> '2026-09-04'", () => {
    expect(parsearFechaDMA('4/9/2026')).toBe('2026-09-04');
  });

  it("'1/8/2026' -> '2026-08-01'", () => {
    expect(parsearFechaDMA('1/8/2026')).toBe('2026-08-01');
  });

  it("'30/8/2026' -> '2026-08-30'", () => {
    expect(parsearFechaDMA('30/8/2026')).toBe('2026-08-30');
  });

  it('día fuera de rango (0 o > 31) -> null', () => {
    expect(parsearFechaDMA('0/8/2026')).toBeNull();
    expect(parsearFechaDMA('32/8/2026')).toBeNull();
  });

  it('mes fuera de rango (0 o > 12) -> null', () => {
    expect(parsearFechaDMA('4/0/2026')).toBeNull();
    expect(parsearFechaDMA('4/13/2026')).toBeNull();
  });

  it('formato no reconocido -> null', () => {
    expect(parsearFechaDMA('2026-08-01')).toBeNull();
    expect(parsearFechaDMA('')).toBeNull();
    expect(parsearFechaDMA('abc')).toBeNull();
  });
});
