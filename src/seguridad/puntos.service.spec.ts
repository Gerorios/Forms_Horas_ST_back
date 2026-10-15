import { Test } from '@nestjs/testing';
import { PuntosService } from './puntos.service';
import { PrismaService } from '../prisma/prisma.service';

/** "Mis puntos" y el ranking salen de sumar movimientos (ADR-027). */
describe('PuntosService', () => {
  const prismaMock: any = {
    segMovimientoPuntos: { findMany: jest.fn() },
    segReporte: { count: jest.fn(), findMany: jest.fn() },
    usuario: { findMany: jest.fn() },
    snuempleados: { findMany: jest.fn(), count: jest.fn() },
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

  describe('mapa', () => {
    const base = {
      estado: 'aprobado',
      fechaReporte: new Date('2026-10-05T00:00:00Z'),
      puntaje: 7,
      latitud: null,
      longitud: null,
      errorMetros: null,
      origenPunto: null,
      provincia: { nombre: 'Salta' },
      contrato: { codigo: 'K2' },
      tarea: { nombre: 'Conexión' },
      naturaleza: { nombre: 'E.P.P' },
      motivoParalizacion: null,
      fotos: [],
    };

    it('un punto por reporte con ubicación, con su origen; sin anulados ni reportes sin punto', async () => {
      prismaMock.segReporte.findMany.mockResolvedValue([
        { ...base, id: 1, tipo: 'paralizacion', latitud: '-24.780000', longitud: '-65.410000', origenPunto: 'mapa' },
        { ...base, id: 2, tipo: 'aviso_riesgo', fotos: [{ origen: 'camara', latitud: '-26.2', longitud: '-65.1', errorMetros: 9 }] },
        { ...base, id: 3, tipo: 'incidente' },
      ]);
      const r = await service.mapa(RANGO);
      expect(prismaMock.segReporte.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ estado: { not: 'anulado' } }) }),
      );
      expect(r.map((p) => [p.id, p.punto.origen])).toEqual([
        [1, 'mapa'],
        [2, 'foto'],
      ]);
      expect(r[0]).toMatchObject({
        tipo: 'paralizacion',
        fechaReporte: '2026-10-05',
        contrato: 'K2',
        punto: { latitud: -24.78, longitud: -65.41, errorMetros: null },
      });
      // La ficha no lleva texto libre.
      expect(r[0]).not.toHaveProperty('descripcion');
    });
  });

  describe('tableros', () => {
    const rep = (autorCuil: string, tipo: string, estado: string, puntaje: number | null = null) => ({
      tipo,
      estado,
      autorCuil,
      puntaje,
      fechaReporte: new Date('2026-10-05T00:00:00Z'),
      createdAt: new Date('2026-10-05T12:00:00Z'),
      calificadoEn: null,
      provincia: { nombre: 'Salta' },
      contrato: { codigo: 'K2' },
      tarea: { nombre: 'Conexión' },
      naturaleza: null,
      motivoParalizacion: null,
      involucrados: tipo === 'inspeccion' ? [{ cuil: 'D' }] : [],
      latitud: null,
      longitud: null,
      errorMetros: null,
      fotos: [],
    });

    beforeEach(() => {
      prismaMock.snuempleados.count.mockResolvedValue(120);
      prismaMock.segReporte.findMany.mockResolvedValue([
        rep('A', 'aviso_riesgo', 'aprobado', 8),
        rep('A', 'incidente', 'pendiente'),
        rep('A', 'aviso_riesgo', 'desaprobado'),
        rep('B', 'aviso_riesgo', 'aprobado', 10),
        // Inspecciones: una de HyS y dos de un supervisor inspector.
        rep('HYS', 'inspeccion', 'aprobado', 6),
        rep('SUP', 'inspeccion', 'aprobado', 4),
        rep('SUP', 'inspeccion', 'pendiente'),
      ]);
    });

    it('quiénes más reportan: cuenta envíos (sin inspecciones), no puntos', async () => {
      const t = await service.tableros(RANGO);
      expect(t.masReportan.map((r) => [r.nombre, r.enviados, r.aprobados, r.puntos])).toEqual([
        ['Pérez', 3, 1, 8],
        ['Gómez', 1, 1, 10],
      ]);
    });

    it('inspecciones de HyS contra las de los inspectores habilitados', async () => {
      const t = await service.tableros(RANGO);
      expect(t.inspeccionesPorOrigen).toEqual({ hys: 1, inspectores: 2 });
    });
  });

  it('HyS ve sus puntos pero no tiene posición: no compite', async () => {
    const m = await service.misPuntos('HYS', RANGO);
    expect(m.puntos.total).toBe(9);
    expect(m.posicion).toBeNull();
    expect(m.delante).toEqual([]);
  });
});
