import { Test } from '@nestjs/testing';
import { PanelService } from './panel.service';
import { CalculoService } from './calculo.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PanelService', () => {
  const prismaMock: any = {
    registroHoras: {
      aggregate: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    perfilLiquidacion: { findMany: jest.fn() },
    snuempleados: { findMany: jest.fn() },
    novedad: { findMany: jest.fn() },
  };
  const calculoMock: any = { calcularQuincena: jest.fn() };
  let service: PanelService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        PanelService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CalculoService, useValue: calculoMock },
      ],
    }).compile();
    service = mod.get(PanelService);
  });

  describe('getQuincenas — estados derivados', () => {
    const hoy = new Date(2026, 7, 4); // 4/ago/2026

    it('pendientes>0 devuelve estado con_pendientes', async () => {
      prismaMock.registroHoras.aggregate.mockResolvedValue({ _min: { fecha: new Date(2026, 7, 1) } });
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([]);
      prismaMock.registroHoras.count.mockResolvedValue(3);
      prismaMock.registroHoras.findMany.mockResolvedValue([]);

      const r = await service.getQuincenas(hoy);

      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ anio: 2026, mes: 8, quincena: 1, estado: 'con_pendientes', pendientes: 3 });
    });

    it('sin pendientes pero con alertas (empleado sin perfil) devuelve con_alertas', async () => {
      prismaMock.registroHoras.aggregate.mockResolvedValue({ _min: { fecha: new Date(2026, 7, 1) } });
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([]); // nadie tiene perfil
      prismaMock.registroHoras.count.mockResolvedValue(0);
      prismaMock.registroHoras.findMany.mockResolvedValue([{ operarioCuil: '20-1-1' }]);

      const r = await service.getQuincenas(hoy);

      expect(r[0]).toMatchObject({ estado: 'con_alertas', alertas: 1, pendientes: 0 });
    });

    it('sin pendientes ni alertas devuelve lista', async () => {
      prismaMock.registroHoras.aggregate.mockResolvedValue({ _min: { fecha: new Date(2026, 7, 1) } });
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([
        { cuil: '20-1-1', regimen: 'jornalizado', categoriaUocraId: 1, modalidadPago: 'en_b' },
      ]);
      prismaMock.registroHoras.count.mockResolvedValue(0);
      prismaMock.registroHoras.findMany.mockResolvedValue([{ operarioCuil: '20-1-1' }]);

      const r = await service.getQuincenas(hoy);

      expect(r[0]).toMatchObject({ estado: 'lista', alertas: 0, pendientes: 0 });
    });

    it('quincena sin ningún registro cargado no se lista', async () => {
      prismaMock.registroHoras.aggregate.mockResolvedValue({ _min: { fecha: new Date(2026, 7, 1) } });
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([]);
      prismaMock.registroHoras.count.mockResolvedValue(0);
      prismaMock.registroHoras.findMany.mockResolvedValue([]);

      const r = await service.getQuincenas(hoy);

      expect(r).toHaveLength(0);
    });
  });

  describe('getDetalleQuincena', () => {
    const filaBase = {
      cuil: '20-1-1',
      apellidoNombre: 'Perez, Juan',
      legajo: 1,
      categoria: 'Oficial',
      regimen: 'jornalizado',
      provincia: 'BA',
      precioBruto: 100,
      horasTotal: 80,
      horasCct: 80,
      totalBruto: 8000,
      horasExtra: 0,
      montoHorasExtra: 0,
      tienePresentismo: true,
      montoPresentismo: 1600,
      plus: [],
      noRemunerativo: 0,
      novedadesTexto: '',
      total: 9600,
      datoFaltante: null,
      modalidadPago: 'en_b',
    };

    it('arma la fila con días solo aprobados y su importe estimado (horas x tarifa)', async () => {
      calculoMock.calcularQuincena.mockResolvedValue([filaBase]);
      prismaMock.registroHoras.groupBy
        .mockResolvedValueOnce([{ operarioCuil: '20-1-1', _count: { _all: 1 } }]) // pendientes por cuil
        .mockResolvedValueOnce([]); // horas aprobadas para sinPerfil
      prismaMock.registroHoras.findMany.mockResolvedValue([
        {
          operarioCuil: '20-1-1',
          fecha: new Date(2026, 7, 5),
          horas: 8,
          estado: 'aprobado',
          loteId: 'L1',
          contrato: { codigo: 'CTR1' },
          tareas: [{ tarea: { nombre: 'Tarea A' } }],
          cargadoPor: { cuil: 'U1', email: 'u1@x.com', nombreFueraNomina: null },
        },
        {
          operarioCuil: '20-1-1',
          fecha: new Date(2026, 7, 6),
          horas: 4,
          estado: 'pendiente',
          loteId: 'L1',
          contrato: { codigo: 'CTR1' },
          tareas: [],
          cargadoPor: { cuil: 'U1', email: 'u1@x.com', nombreFueraNomina: null },
        },
      ]);
      prismaMock.snuempleados.findMany.mockResolvedValueOnce([{ cuil: 'U1', apellido_nombre: 'Ana Lopez' }]);
      prismaMock.novedad.findMany.mockResolvedValue([]);
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([{ cuil: '20-1-1' }]);

      const r = await service.getDetalleQuincena(2026, 8, 1);

      expect(r.filas).toHaveLength(1);
      expect(r.filas[0].dias).toHaveLength(1);
      expect(r.filas[0].dias[0]).toMatchObject({
        fecha: '2026-08-05',
        contratoCodigo: 'CTR1',
        tareas: ['Tarea A'],
        horas: '8.00',
        cargadoPor: 'Ana Lopez',
        importeEstimado: '800.00',
      });
      expect(r.filas[0].pendientesAprobacion).toBe(1);
      expect(r.filas[0].duplicadoCruzado).toBe(false);
    });

    it('mensualizado expone horasTotal y horasCct en null (fix centinela)', async () => {
      calculoMock.calcularQuincena.mockResolvedValue([
        { ...filaBase, regimen: 'mensualizado', horasTotal: 1, horasCct: 1 },
      ]);
      prismaMock.registroHoras.groupBy.mockResolvedValue([]);
      prismaMock.registroHoras.findMany.mockResolvedValue([]);
      prismaMock.snuempleados.findMany.mockResolvedValue([]);
      prismaMock.novedad.findMany.mockResolvedValue([]);
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([{ cuil: '20-1-1' }]);

      const r = await service.getDetalleQuincena(2026, 8, 1);

      expect(r.filas[0].horasTotal).toBeNull();
      expect(r.filas[0].horasCct).toBeNull();
    });

    it('detecta empleado con horas aprobadas y sin perfil de liquidación (fila gris)', async () => {
      calculoMock.calcularQuincena.mockResolvedValue([]);
      prismaMock.registroHoras.groupBy
        .mockResolvedValueOnce([]) // pendientes (sin cuils del cálculo)
        .mockResolvedValueOnce([{ operarioCuil: '20-9-9', _sum: { horas: 10 } }]); // sin perfil
      prismaMock.registroHoras.findMany.mockResolvedValue([]);
      prismaMock.snuempleados.findMany.mockResolvedValueOnce([{ cuil: '20-9-9', apellido_nombre: 'Nadie Perfil' }]);
      prismaMock.novedad.findMany.mockResolvedValue([]);
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([]); // nadie tiene perfil

      const r = await service.getDetalleQuincena(2026, 8, 1);

      expect(r.sinPerfil).toHaveLength(1);
      expect(r.sinPerfil[0]).toMatchObject({
        cuil: '20-9-9',
        nombre: 'Nadie Perfil',
        horasAprobadas: '10.00',
        motivo: 'sin_perfil',
      });
    });

    it('novedad de Ausencia desaprobada produce efecto "pierde presentismo"', async () => {
      calculoMock.calcularQuincena.mockResolvedValue([filaBase]);
      prismaMock.registroHoras.groupBy.mockResolvedValue([]);
      prismaMock.registroHoras.findMany.mockResolvedValue([]);
      prismaMock.snuempleados.findMany.mockResolvedValue([]);
      prismaMock.novedad.findMany.mockResolvedValue([
        {
          operarioCuil: '20-1-1',
          tipoNovedadId: 5,
          fechaInicio: new Date(2026, 7, 1),
          fechaFin: new Date(2026, 7, 3),
          estadoHys: 'desaprobada',
          tipoNovedad: { id: 5, nombre: 'Ausencia', generaPlus: false },
        },
      ]);
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([{ cuil: '20-1-1' }]);

      const r = await service.getDetalleQuincena(2026, 8, 1);

      expect(r.filas[0].novedades).toHaveLength(1);
      expect(r.filas[0].novedades[0]).toMatchObject({
        tipo: 'Ausencia',
        desde: '2026-08-01',
        hasta: '2026-08-03',
        efecto: 'pierde presentismo',
      });
    });
  });
});
