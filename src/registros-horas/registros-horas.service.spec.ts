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
