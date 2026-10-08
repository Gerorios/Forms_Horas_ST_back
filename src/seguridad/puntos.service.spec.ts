import { Test } from '@nestjs/testing';
import { PuntosService } from './puntos.service';
import { PrismaService } from '../prisma/prisma.service';

/** "Mis puntos" y el ranking salen de sumar movimientos (ADR-027). */
describe('PuntosService', () => {
  const prismaMock: any = {
    segMovimientoPuntos: { findMany: jest.fn() },
    segReporte: { count: jest.fn() },
    usuario: { findMany: jest.fn() },
    snuempleados: { findMany: jest.fn() },
  };
  let service: PuntosService;
  const RANGO = { desde: '2026-07-01', hasta: '2026-12-31' };

  const empleado = (cuil: string, nombre: string) => ({ cuil, apellido_nombre: nombre, legajo: 1 });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Todos los del período: A=+18, B=+10, C=+10, D=-6, HYS=+9 (no compite)
    prismaMock.segMovimientoPuntos.findMany.mockImplementation(async (args: any) => {
      const todos = [
        { cuil: 'A', puntos: 10 }, { cuil: 'A', puntos: 8 },
        { cuil: 'B', puntos: 10 }, { cuil: 'C', puntos: 10 },
        { cuil: 'D', puntos: -6 }, { cuil: 'HYS', puntos: 9 },
      ];
      if (!args.where.cuil) return todos;
      return todos
        .filter((m) => m.cuil === args.where.cuil)
        .map((m) => ({
          ...m,
          fecha: new Date('2026-10-05T00:00:00Z'),
          reporte: {
            id: 9,
            tipo: m.puntos < 0 ? 'inspeccion' : 'aviso_riesgo',
            descripcion: 'Sin casco en la zanja',
            naturaleza: { nombre: 'E.P.P' },
            contrato: { codigo: 'K8' },
          },
        }));
    });
    prismaMock.usuario.findMany.mockResolvedValue([{ cuil: 'HYS' }]);
    prismaMock.snuempleados.findMany.mockResolvedValue([
      empleado('A', 'Pérez'), empleado('B', 'Gómez'), empleado('C', 'Díaz'), empleado('D', 'Ruiz'),
    ]);
    prismaMock.segReporte.count.mockResolvedValue(3);

    const mod = await Test.createTestingModule({
      providers: [PuntosService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(PuntosService);
  });

  it('el ranking deja afuera a HyS y avisa los pendientes del período', async () => {
    const r = await service.ranking(RANGO);
    expect(r.filas.map((f) => [f.nombre, f.total, f.puesto])).toEqual([
      ['Pérez', 18, 1],
      // Empate: comparten puesto; el orden entre ellos es por CUIL (B < C).
      ['Gómez', 10, 2],
      ['Díaz', 10, 2],
      ['Ruiz', -6, 4],
    ]);
    expect(r.pendientes).toBe(3);
  });

  it('mis puntos: posición y quiénes van delante, sin nombres', async () => {
    const m = await service.misPuntos('B', RANGO);
    expect(m.puntos).toEqual({ total: 10, mas: 10, menos: 0 });
    expect(m.posicion).toEqual({ puesto: 2, de: 4 });
    expect(m.delante).toEqual([{ puesto: 1, total: 18 }]);
    expect(JSON.stringify(m.delante)).not.toContain('Pérez');
  });

  it('las inspecciones que me restaron, sin quién de HyS la cargó', async () => {
    const m = await service.misPuntos('D', RANGO);
    expect(m.puntos.total).toBe(-6);
    expect(m.inspecciones).toEqual([
      { fecha: '2026-10-05', naturaleza: 'E.P.P', contrato: 'K8', descripcion: 'Sin casco en la zanja', puntos: -6 },
    ]);
    expect(m.movimientos[0].reporteId).toBeNull();
  });

  it('HyS ve sus puntos pero no tiene posición: no compite', async () => {
    const m = await service.misPuntos('HYS', RANGO);
    expect(m.puntos.total).toBe(9);
    expect(m.posicion).toBeNull();
    expect(m.delante).toEqual([]);
  });
});
