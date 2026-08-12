import { Test } from '@nestjs/testing';
import { AnalisisService } from './analisis.service';
import { CalculoService } from './calculo.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AnalisisService — análisis de la quincena', () => {
  const prismaMock: any = {
    registroHoras: { findMany: jest.fn(), groupBy: jest.fn() },
    contrato: { findMany: jest.fn() },
  };
  const calculoMock: any = { calcularQuincena: jest.fn() };
  let service: AnalisisService;

  // Fila mínima con el shape real del motor (calculo.service.ts:257-279).
  const fila = (cuil: string, nombre: string, total: number, extras: Record<string, unknown> = {}) => ({
    cuil,
    apellidoNombre: nombre,
    regimen: 'jornalizado',
    total,
    totalBruto: total,
    montoHorasExtra: 0,
    montoPresentismo: 0,
    plus: [],
    noRemunerativo: 0,
    horasCct: 88,
    horasExtra: 0,
    ...extras,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        AnalisisService,
        { provide: CalculoService, useValue: calculoMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = mod.get(AnalisisService);
  });

  it('totales, composición y variaciones contra la quincena anterior', async () => {
    calculoMock.calcularQuincena.mockImplementation((a: number, m: number, q: number) => {
      if (m === 8 && q === 1)
        return Promise.resolve([
          fila('20-1', 'PEREZ', 1100, { totalBruto: 800, montoHorasExtra: 200, montoPresentismo: 100 }),
          fila('20-2', 'GOMEZ', 500), // nuevo: no está en la anterior
        ]);
      if (m === 7 && q === 2) return Promise.resolve([fila('20-1', 'PEREZ', 1000)]);
      return Promise.resolve([]); // resto del histórico vacío
    });
    prismaMock.registroHoras.findMany.mockResolvedValue([]); // días trabajados
    prismaMock.registroHoras.groupBy.mockResolvedValue([]); // prorrateo
    prismaMock.contrato.findMany.mockResolvedValue([]);

    const r = await service.getAnalisis(2026, 8, 1);
    expect(r.periodo).toEqual({ anio: 2026, mes: 8, quincena: 1 });
    expect(r.totales).toMatchObject({ total: 1600, empleados: 2, empleadosNuevos: 1, costoPromedio: 800 });
    expect(r.anterior).toMatchObject({ total: 1000, empleados: 1, costoPromedio: 1000 });
    expect(r.composicion).toEqual({ basico: 1300, extras: 200, presentismo: 100, plus: 0, bono: 0 });
    // PEREZ subió 10% → primero; GOMEZ es nuevo (delta null) → al final
    expect(r.variaciones[0]).toMatchObject({ cuil: '20-1', deltaPct: 10, deltaMonto: 100, totalAnterior: 1000 });
    expect(r.variaciones[1]).toMatchObject({ cuil: '20-2', deltaPct: null, deltaMonto: null, totalAnterior: null });
    // top: por total desc
    expect(r.topCobradores.map((t) => t.cuil)).toEqual(['20-1', '20-2']);
    expect(r.historico).toHaveLength(8);
    expect(r.historico[7]).toMatchObject({ anio: 2026, mes: 8, quincena: 1, total: 1600 });
    expect(r.historico[6]).toMatchObject({ anio: 2026, mes: 7, quincena: 2, total: 1000 });
  });

  it('anterior es null si el motor devuelve 0 filas para la quincena anterior', async () => {
    calculoMock.calcularQuincena.mockImplementation((a: number, m: number, q: number) =>
      Promise.resolve(m === 8 && q === 1 ? [fila('20-1', 'PEREZ', 100)] : []),
    );
    prismaMock.registroHoras.findMany.mockResolvedValue([]);
    prismaMock.registroHoras.groupBy.mockResolvedValue([]);
    prismaMock.contrato.findMany.mockResolvedValue([]);

    const r = await service.getAnalisis(2026, 8, 1);
    expect(r.anterior).toBeNull();
    expect(r.totales.empleadosNuevos).toBe(1);
  });

  it('suma horasCct y horasExtra en los totales', async () => {
    calculoMock.calcularQuincena.mockImplementation((a: number, m: number, q: number) =>
      Promise.resolve(
        m === 8 && q === 1
          ? [fila('20-1', 'PEREZ', 100, { horasCct: 88, horasExtra: 10 }), fila('20-2', 'GOMEZ', 100, { horasCct: 40 })]
          : [],
      ),
    );
    prismaMock.registroHoras.findMany.mockResolvedValue([]);
    prismaMock.registroHoras.groupBy.mockResolvedValue([]);
    prismaMock.contrato.findMany.mockResolvedValue([]);

    const r = await service.getAnalisis(2026, 8, 1);
    expect(r.totales.horasCct).toBe(128);
    expect(r.totales.horasExtra).toBe(10);
  });

  it('prorrateo por horas: reparte el total del empleado entre sus contratos y manda a los sin horas al bucket', async () => {
    calculoMock.calcularQuincena.mockImplementation((a: number, m: number, q: number) =>
      Promise.resolve(m === 8 && q === 1 ? [fila('20-1', 'PEREZ', 900), fila('20-3', 'MENSU', 300)] : []),
    );
    prismaMock.registroHoras.findMany.mockResolvedValue([]);
    // PEREZ: 60hs en contrato 1 y 30hs en contrato 2; MENSU sin horas
    prismaMock.registroHoras.groupBy.mockResolvedValue([
      { operarioCuil: '20-1', contratoId: 1, _sum: { horas: 60 } },
      { operarioCuil: '20-1', contratoId: 2, _sum: { horas: 30 } },
    ]);
    prismaMock.contrato.findMany.mockResolvedValue([
      { id: 1, codigo: 'K5', nombre: 'Gasnor K5' },
      { id: 2, codigo: 'K9', nombre: 'Gasnor K9' },
    ]);

    const r = await service.getAnalisis(2026, 8, 1);
    expect(r.contratos[0]).toMatchObject({ contratoId: 1, codigo: 'K5', nombre: 'Gasnor K5', monto: 600, horas: 60, pctDelTotal: 50 });
    expect(r.contratos[1]).toMatchObject({ contratoId: 2, codigo: 'K9', monto: 300, horas: 30, pctDelTotal: 25 });
    expect(r.contratos[2]).toMatchObject({ contratoId: null, codigo: 'Sin contrato asignable', monto: 300, horas: 0, pctDelTotal: 25 });
    // el prorrateo cierra contra el total
    expect(r.contratos.reduce((s, c) => s + c.monto, 0)).toBe(1200);
  });

  it('días trabajados = días distintos con horas aprobadas', async () => {
    calculoMock.calcularQuincena.mockImplementation((a: number, m: number, q: number) =>
      Promise.resolve(m === 8 && q === 1 ? [fila('20-1', 'PEREZ', 100)] : []),
    );
    prismaMock.registroHoras.findMany.mockResolvedValue([
      { operarioCuil: '20-1', fecha: new Date(2026, 7, 3) },
      { operarioCuil: '20-1', fecha: new Date(2026, 7, 4) },
    ]);
    prismaMock.registroHoras.groupBy.mockResolvedValue([]);
    prismaMock.contrato.findMany.mockResolvedValue([]);
    const r = await service.getAnalisis(2026, 8, 1);
    expect(r.variaciones[0].diasTrabajados).toBe(2);
    expect(r.topCobradores[0].diasTrabajados).toBe(2);
  });

  it('composición: plus y bono salen de plus[].monto y noRemunerativo', async () => {
    calculoMock.calcularQuincena.mockImplementation((a: number, m: number, q: number) =>
      Promise.resolve(
        m === 8 && q === 1
          ? [
              fila('20-1', 'PEREZ', 1000, {
                totalBruto: 700,
                plus: [{ tipoNovedadId: 1, nombre: 'Guardia', dias: 2, monto: 200 }],
                noRemunerativo: 100,
              }),
            ]
          : [],
      ),
    );
    prismaMock.registroHoras.findMany.mockResolvedValue([]);
    prismaMock.registroHoras.groupBy.mockResolvedValue([]);
    prismaMock.contrato.findMany.mockResolvedValue([]);

    const r = await service.getAnalisis(2026, 8, 1);
    expect(r.composicion).toEqual({ basico: 700, extras: 0, presentismo: 0, plus: 200, bono: 100 });
  });
});
