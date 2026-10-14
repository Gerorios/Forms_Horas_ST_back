import { BadRequestException } from '@nestjs/common';
import { periodoQuincena, quincenaDeFecha, resolverPeriodo } from './periodo-panel';

describe('resolverPeriodo (ADR-030)', () => {
  it('año + mes + quincena → esa quincena', () => {
    expect(resolverPeriodo({ anio: 2026, mes: 8, quincena: 2 })).toEqual({
      desde: new Date(2026, 7, 16),
      hasta: new Date(2026, 7, 31),
      quincena: { anio: 2026, mes: 8, quincena: 2 },
    });
  });

  it('año + mes sin quincena → el mes completo, sin quincena', () => {
    expect(resolverPeriodo({ anio: 2026, mes: 2 })).toEqual({
      desde: new Date(2026, 1, 1),
      hasta: new Date(2026, 1, 28),
      quincena: null,
    });
  });

  it('desde/hasta manda sobre año/mes', () => {
    expect(resolverPeriodo({ anio: 2026, mes: 8, quincena: 1, desde: '2026-03-05', hasta: '2026-04-20' })).toEqual({
      desde: new Date(2026, 2, 5),
      hasta: new Date(2026, 3, 20),
      quincena: null,
    });
  });

  it('un rango que coincide con una quincena se trata como esa quincena', () => {
    expect(resolverPeriodo({ desde: '2026-09-16', hasta: '2026-09-30' })).toEqual(periodoQuincena(2026, 9, 2));
    expect(resolverPeriodo({ desde: '2026-09-01', hasta: '2026-09-15' })).toEqual(periodoQuincena(2026, 9, 1));
    expect(resolverPeriodo({ desde: '2026-09-01', hasta: '2026-09-14' }).quincena).toBeNull();
  });

  it('acepta un rango de 12 meses justos y rechaza uno más largo', () => {
    expect(resolverPeriodo({ desde: '2025-10-15', hasta: '2026-10-14' }).quincena).toBeNull();
    expect(() => resolverPeriodo({ desde: '2025-10-15', hasta: '2026-10-15' })).toThrow(/12 meses/);
  });

  it.each([
    [{ desde: '2026-08-01' }, /desde y fecha hasta/],
    [{ hasta: '2026-08-01' }, /desde y fecha hasta/],
    [{ desde: '01/08/2026', hasta: '2026-08-15' }, /AAAA-MM-DD/],
    [{ desde: '2026-02-30', hasta: '2026-03-15' }, /AAAA-MM-DD/],
    [{ desde: '2026-08-15', hasta: '2026-08-01' }, /anterior/],
    [{}, /Falta el período/],
    [{ anio: 2026 }, /Falta el período/],
    [{ anio: 2026, mes: 13 }, /Falta el período/],
    [{ anio: 2026, mes: 8, quincena: 3 }, /1 o 2/],
  ])('rechaza %j con 400', (query, mensaje) => {
    expect(() => resolverPeriodo(query)).toThrow(BadRequestException);
    expect(() => resolverPeriodo(query)).toThrow(mensaje);
  });
});

describe('quincenaDeFecha', () => {
  it('ubica el día en su quincena', () => {
    expect(quincenaDeFecha(new Date(2026, 9, 15))).toEqual({ anio: 2026, mes: 10, quincena: 1 });
    expect(quincenaDeFecha(new Date(2026, 9, 16))).toEqual({ anio: 2026, mes: 10, quincena: 2 });
  });
});
