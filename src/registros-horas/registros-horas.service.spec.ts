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
});
