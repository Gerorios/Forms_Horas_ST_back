import { Test } from '@nestjs/testing';
import { NovedadesService } from './novedades.service';
import { PrismaService } from '../prisma/prisma.service';

describe('NovedadesService#findAll', () => {
  const prismaMock: any = {
    novedad: { findMany: jest.fn() },
  };
  let service: NovedadesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.novedad.findMany.mockResolvedValue([]);

    const mod = await Test.createTestingModule({
      providers: [NovedadesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(NovedadesService);
  });

  function whereUsado() {
    return prismaMock.novedad.findMany.mock.calls[0][0].where;
  }

  it('sin período: no agrega condición de fecha (todas)', async () => {
    await service.findAll({}, { cuil: '20111111111', rol: 'JefeContrato' });
    const where = whereUsado();
    expect(where.fechaInicio).toBeUndefined();
    expect(where.OR).toBeUndefined();
  });

  it('con período: filtra por superposición con la quincena (fechaInicio <= hasta, y fechaFin >= desde o sin fechaFin con fechaInicio >= desde)', async () => {
    await service.findAll(
      { periodo: { anio: 2026, mes: 8, quincena: 1 } },
      { cuil: '20111111111', rol: 'JefeContrato' },
    );
    const where = whereUsado();
    expect(where.fechaInicio).toEqual({ lte: new Date(2026, 7, 15) });
    expect(where.OR).toEqual([
      { fechaFin: { gte: new Date(2026, 7, 1) } },
      { fechaFin: null, fechaInicio: { gte: new Date(2026, 7, 1) } },
    ]);
  });

  it('la 2da quincena usa el rango correcto (16 a fin de mes)', async () => {
    await service.findAll(
      { periodo: { anio: 2026, mes: 2, quincena: 2 } },
      { cuil: '20111111111', rol: 'JefeContrato' },
    );
    const where = whereUsado();
    expect(where.fechaInicio).toEqual({ lte: new Date(2026, 1, 28) }); // 2026 no es bisiesto
    expect(where.OR[0]).toEqual({ fechaFin: { gte: new Date(2026, 1, 16) } });
  });

  it('JefeCuadrilla solo ve lo que él mismo cargó (cargadoPorCuil)', async () => {
    await service.findAll({}, { cuil: '20222222222', rol: 'JefeCuadrilla' });
    const where = whereUsado();
    expect(where.cargadoPorCuil).toBe('20222222222');
  });

  it('JefeContrato, Supervisor, HyS, Liquidador y Admin ven todo (sin cargadoPorCuil)', async () => {
    for (const rol of ['JefeContrato', 'Supervisor', 'HyS', 'Liquidador', 'Admin']) {
      await service.findAll({}, { cuil: '20111111111', rol });
      expect(whereUsado().cargadoPorCuil).toBeUndefined();
    }
  });

  it('combina operarioCuil + estadoHys + período sin pisarse (un solo OR, el del período)', async () => {
    await service.findAll(
      { operarioCuil: '20333333333', estadoHys: 'pendiente', periodo: { anio: 2026, mes: 8, quincena: 1 } },
      { cuil: '20111111111', rol: 'JefeContrato' },
    );
    const where = whereUsado();
    expect(where.operarioCuil).toBe('20333333333');
    expect(where.estadoHys).toBe('pendiente');
    expect(where.OR).toBeDefined();
  });
});
