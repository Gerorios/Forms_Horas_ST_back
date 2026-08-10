import { Test } from '@nestjs/testing';
import { RegistrosHorasService } from './registros-horas.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmpleadosService } from '../empleados/empleados.service';

const usuario = { cuil: '20-1-1', rol: 'Admin' };

describe('RegistrosHorasService', () => {
  const prismaMock: any = {
    contrato: { findMany: jest.fn() },
    registroHoras: { findMany: jest.fn() },
    snuempleados: { findMany: jest.fn() },
  };
  let service: RegistrosHorasService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        RegistrosHorasService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EmpleadosService, useValue: {} },
      ],
    }).compile();
    service = mod.get(RegistrosHorasService);
  });

  describe('resumenOperarios — alerta cruzada', () => {
    it('operario con muchas horas (18) en un solo lote/día no dispara la alerta', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.registroHoras.findMany
        .mockResolvedValueOnce([
          { operarioCuil: '20-2-2', horas: 18, estado: 'aprobado' },
        ]) // filas (para totales por operario)
        .mockResolvedValueOnce([
          {
            operarioCuil: '20-2-2',
            fecha: new Date('2026-08-01'),
            horas: 18,
            loteId: 'lote-A',
          },
        ]) // filasQuincenaCompleta
        .mockResolvedValueOnce([]); // filasAnteriores
      prismaMock.snuempleados.findMany.mockResolvedValue([
        { cuil: '20-2-2', apellido_nombre: 'Perez, Juan' },
      ]);

      const r = await service.resumenOperarios(usuario, 2026, 8, 1);

      expect(r).toHaveLength(1);
      expect(r[0].tieneAlertaCruzada).toBe(false);
    });

    it('operario con horas el mismo día repartidas en dos lotes dispara la alerta', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.registroHoras.findMany
        .mockResolvedValueOnce([
          { operarioCuil: '20-2-2', horas: 4, estado: 'aprobado' },
          { operarioCuil: '20-2-2', horas: 4, estado: 'aprobado' },
        ]) // filas
        .mockResolvedValueOnce([
          {
            operarioCuil: '20-2-2',
            fecha: new Date('2026-08-01'),
            horas: 4,
            loteId: 'lote-A',
          },
          {
            operarioCuil: '20-2-2',
            fecha: new Date('2026-08-01'),
            horas: 4,
            loteId: 'lote-B',
          },
        ]) // filasQuincenaCompleta
        .mockResolvedValueOnce([]); // filasAnteriores
      prismaMock.snuempleados.findMany.mockResolvedValue([
        { cuil: '20-2-2', apellido_nombre: 'Perez, Juan' },
      ]);

      const r = await service.resumenOperarios(usuario, 2026, 8, 1);

      expect(r).toHaveLength(1);
      expect(r[0].tieneAlertaCruzada).toBe(true);
    });
  });

  describe('resumenOperarios con filtros', () => {
    it('interseca contratoIds con mis contratos y filtra provincia (pero no en la alerta cruzada)', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      prismaMock.registroHoras.findMany.mockResolvedValue([]);
      prismaMock.snuempleados.findMany.mockResolvedValue([]);
      await service.resumenOperarios({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1, {
        contratoIds: [2, 99],
        provinciaIds: [3],
      });
      const llamadas = prismaMock.registroHoras.findMany.mock.calls.map((c) => c[0].where);
      // agregado principal: contratos intersecados + provincia
      expect(llamadas[0]).toMatchObject({ contratoId: { in: [2] }, provinciaId: { in: [3] } });
      // alerta cruzada: sin filtro de provincia ni contrato
      expect(llamadas[1].provinciaId).toBeUndefined();
      expect(llamadas[1].contratoId).toBeUndefined();
      // quincena anterior: mismos filtros que el principal
      expect(llamadas[2]).toMatchObject({ contratoId: { in: [2] }, provinciaId: { in: [3] } });
    });

    it('sin intersección de contratos devuelve [] sin tocar registros', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }]);
      const r = await service.resumenOperarios({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1, {
        contratoIds: [99],
      });
      expect(r).toEqual([]);
      expect(prismaMock.registroHoras.findMany).not.toHaveBeenCalled();
    });
  });

  describe('historicoQuincenas', () => {
    it('agrupa por quincena calendario, excluye desaprobado en el where y rellena con 0', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.registroHoras.findMany.mockResolvedValue([
        { fecha: new Date(2026, 7, 3), horas: 8 }, // 1ra ago
        { fecha: new Date(2026, 7, 3), horas: 2.5 }, // 1ra ago
        { fecha: new Date(2026, 6, 20), horas: 4 }, // 2da jul
      ]);
      const r = await service.historicoQuincenas({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1);
      expect(r).toHaveLength(24);
      expect(r[23]).toEqual({ anio: 2026, mes: 8, quincena: 1, horas: 10.5 });
      expect(r[22]).toEqual({ anio: 2026, mes: 7, quincena: 2, horas: 4 });
      expect(r[21]).toEqual({ anio: 2026, mes: 7, quincena: 1, horas: 0 });
      const where = prismaMock.registroHoras.findMany.mock.calls[0][0].where;
      expect(where.estado).toEqual({ not: 'desaprobado' });
    });
  });

  describe('detalleDiario', () => {
    it('devuelve filas planas con contrato y nombre, orden fecha desc + nombre', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.registroHoras.findMany.mockResolvedValue([
        {
          id: 10, fecha: new Date(2026, 7, 3), contratoId: 1, operarioCuil: '20-2-2',
          horas: 8, estado: 'pendiente',
          contrato: { codigo: 'K5' }, operario: { apellido_nombre: 'Zeta Juan' },
          tareas: [],
        },
        {
          id: 11, fecha: new Date(2026, 7, 3), contratoId: 1, operarioCuil: '20-3-3',
          horas: 4, estado: 'aprobado',
          contrato: { codigo: 'K5' }, operario: { apellido_nombre: 'Alfa Pedro' },
          tareas: [{ tarea: { nombre: 'Zanjeo' } }, { tarea: { nombre: 'Tendido de cañería' } }],
          observacion: 'Viaje a Metán por fuga',
        },
      ]);
      const r = await service.detalleDiario({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1);
      expect(r[0]).toEqual({
        id: 11, fecha: '2026-08-03', contratoId: 1, contratoCodigo: 'K5',
        operarioCuil: '20-3-3', operarioNombre: 'Alfa Pedro', horas: 4, estado: 'aprobado',
        tareas: ['Zanjeo', 'Tendido de cañería'],
        observacion: 'Viaje a Metán por fuga',
      });
      expect(r[1].operarioNombre).toBe('Zeta Juan');
      expect(r[1].tareas).toEqual([]);
      expect(r[1].observacion).toBeNull();
    });
  });

  describe('misContratos', () => {
    it('JefeContrato ve solo sus contratos; Admin todos los activos', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1, codigo: 'K5', nombre: 'Gasnor K5' }]);
      const r = await service.misContratos({ cuil: '20-1-1', rol: 'JefeContrato' });
      expect(prismaMock.contrato.findMany).toHaveBeenCalledWith({
        where: { activo: true, jefes: { some: { usuarioCuil: '20-1-1' } } },
        select: { id: true, codigo: true, nombre: true },
        orderBy: { codigo: 'asc' },
      });
      expect(r).toEqual([{ id: 1, codigo: 'K5', nombre: 'Gasnor K5' }]);

      await service.misContratos({ cuil: '20-9-9', rol: 'Admin' });
      expect(prismaMock.contrato.findMany).toHaveBeenLastCalledWith({
        where: { activo: true },
        select: { id: true, codigo: true, nombre: true },
        orderBy: { codigo: 'asc' },
      });
    });
  });
});
