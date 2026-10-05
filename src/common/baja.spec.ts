import { bajasPorCuil, claveDiaLocal, claveDiaUtc, esPosteriorABaja, formatearClave, TIPO_BAJA } from './baja';
import { rangoQuincena } from './quincena';

describe('baja de operario (helpers)', () => {
  it('claveDiaUtc toma el día UTC de un @db.Date y claveDiaLocal el día local de rangoQuincena', () => {
    expect(claveDiaUtc(new Date('2026-10-15T00:00:00.000Z'))).toBe('2026-10-15');
    const { desde, hasta } = rangoQuincena(2026, 10, 2);
    expect(claveDiaLocal(desde)).toBe('2026-10-16');
    expect(claveDiaLocal(hasta)).toBe('2026-10-31');
  });

  it('formatea la clave para mensajes', () => {
    expect(formatearClave('2026-10-05')).toBe('05/10/2026');
  });

  it('esPosteriorABaja: el último día trabajado todavía cuenta; el siguiente no', () => {
    const baja = { fechaBaja: '2026-10-15', confirmada: true };
    expect(esPosteriorABaja('2026-10-15', baja)).toBe(false);
    expect(esPosteriorABaja('2026-10-16', baja)).toBe(true);
  });

  it('esPosteriorABaja: una baja pendiente no corta nada', () => {
    expect(esPosteriorABaja('2026-12-01', { fechaBaja: '2026-10-15', confirmada: false })).toBe(false);
    expect(esPosteriorABaja('2026-12-01', undefined)).toBe(false);
  });

  it('bajasPorCuil filtra por tipo/activa/pendiente-aprobada y prioriza la confirmada', async () => {
    const prisma = {
      novedad: {
        findMany: jest.fn().mockResolvedValue([
          { operarioCuil: 'A', fechaInicio: new Date('2026-10-20T00:00:00Z'), estadoHys: 'pendiente' },
          { operarioCuil: 'A', fechaInicio: new Date('2026-10-25T00:00:00Z'), estadoHys: 'aprobada' },
          { operarioCuil: 'B', fechaInicio: new Date('2026-10-03T00:00:00Z'), estadoHys: 'pendiente' },
        ]),
      },
    };
    const mapa = await bajasPorCuil(prisma, ['A', 'B']);
    expect(prisma.novedad.findMany.mock.calls[0][0].where).toMatchObject({
      tipoNovedad: { nombre: TIPO_BAJA },
      estado: 'activa',
      estadoHys: { in: ['pendiente', 'aprobada'] },
      operarioCuil: { in: ['A', 'B'] },
    });
    expect(mapa.get('A')).toEqual({ fechaBaja: '2026-10-25', confirmada: true });
    expect(mapa.get('B')).toEqual({ fechaBaja: '2026-10-03', confirmada: false });
  });
});
