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
    // Default: sin empleados en snuempleados — los tests de auditoría
    // (cargadoPor/aprobadoPor) que necesiten un nombre real lo sobreescriben.
    prismaMock.snuempleados.findMany.mockResolvedValue([]);
    const mod = await Test.createTestingModule({
      providers: [
        RegistrosHorasService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EmpleadosService, useValue: {} },
      ],
    }).compile();
    service = mod.get(RegistrosHorasService);
  });

  describe('fixes de crecimiento (auditoría 2026-08-18)', () => {
    it('porAprobar con desde/hasta acota los lotes por rango de fechas en el servidor', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.registroHoras.findMany.mockResolvedValue([]); // sin lotes → corta temprano
      await service.porAprobar({ cuil: '20-1-1', rol: 'Admin' }, 'aprobado', {
        desde: '2026-08-01',
        hasta: '2026-08-15',
      });
      const where = prismaMock.registroHoras.findMany.mock.calls[0][0].where;
      expect(where.fecha).toEqual({ gte: new Date('2026-08-01'), lte: new Date('2026-08-15') });
    });

    it('findAll con desde/hasta filtra por rango en el servidor', async () => {
      prismaMock.registroHoras.findMany.mockResolvedValue([]);
      await service.findAll(
        { desde: '2026-08-01', hasta: '2026-08-15' },
        { cuil: '20-2-2', rol: 'Supervisor' },
      );
      const where = prismaMock.registroHoras.findMany.mock.calls[0][0].where;
      expect(where.fecha).toEqual({ gte: new Date('2026-08-01'), lte: new Date('2026-08-15') });
      expect(where.operarioCuil).toBe('20-2-2'); // el alcance propio se mantiene
    });

    it('createBatch consulta las horas previas con UN groupBy (no un aggregate por operario)', async () => {
      prismaMock.contratoHabilitado = { findMany: jest.fn().mockResolvedValue([{ contratoId: 1 }]) };
      prismaMock.registroHoras.groupBy = jest.fn().mockResolvedValue([
        { operarioCuil: '20-1-1', _sum: { horas: 10 } },
      ]);
      prismaMock.registroHoras.aggregate = jest.fn();
      const txMock = {
        registroHoras: {
          create: jest.fn().mockResolvedValue({ id: 1 }),
        },
      };
      prismaMock.$transaction = jest.fn((cb: any) => cb(txMock));

      const r = await service.createBatch(
        {
          fecha: '2026-08-18',
          operarioCuils: ['20-1-1', '20-2-2'],
          provinciaId: 1,
          lineas: [{ contratoId: 1, horas: 4, tareaIds: [1] }],
        } as any,
        '20-9-9',
      );

      expect(prismaMock.registroHoras.groupBy).toHaveBeenCalledTimes(1);
      expect(prismaMock.registroHoras.aggregate).not.toHaveBeenCalled();
      expect(r.creados).toBe(2);
      // 20-1-1 tenía 10hs previas + 4 del batch = 14 → sin alerta; 20-2-2: 0+4
      const creadas = txMock.registroHoras.create.mock.calls.map((c: any) => c[0].data);
      expect(creadas.find((d: any) => d.operarioCuil === '20-1-1').alertaHoras).toBe(false);
    });
  });

  describe('findAll — alcance por usuario (auditoría 2026-08-18)', () => {
    beforeEach(() => prismaMock.registroHoras.findMany.mockResolvedValue([]));

    it('Admin consulta libre: los filtros pasan tal cual', async () => {
      await service.findAll({ operarioCuil: '20-9-9' }, { cuil: '20-1-1', rol: 'Admin' });
      expect(prismaMock.registroHoras.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ operarioCuil: '20-9-9' }) }),
      );
    });

    it('no-Admin sin params queda scopeado a sus propios registros como operario', async () => {
      await service.findAll({}, { cuil: '20-2-2', rol: 'Supervisor' });
      expect(prismaMock.registroHoras.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ operarioCuil: '20-2-2' }) }),
      );
    });

    it('no-Admin pidiendo el operarioCuil de OTRO recibe Forbidden', () => {
      expect(() =>
        service.findAll({ operarioCuil: '20-9-9' }, { cuil: '20-2-2', rol: 'JefeCuadrilla' }),
      ).toThrow('Solo podés consultar tus propios registros');
      expect(prismaMock.registroHoras.findMany).not.toHaveBeenCalled();
    });

    it('no-Admin pidiendo cargadoPorCuil de OTRO recibe Forbidden', () => {
      expect(() =>
        service.findAll({ cargadoPorCuil: '20-9-9' }, { cuil: '20-2-2', rol: 'JefeCuadrilla' }),
      ).toThrow('Solo podés consultar tus propios registros');
    });

    it('no-Admin puede pedir lo que él mismo cargó (cargadoPorCuil propio, sin forzar operario)', async () => {
      await service.findAll({ cargadoPorCuil: '20-2-2' }, { cuil: '20-2-2', rol: 'JefeCuadrilla' });
      const where = prismaMock.registroHoras.findMany.mock.calls[0][0].where;
      expect(where.cargadoPorCuil).toBe('20-2-2');
      expect(where.operarioCuil).toBeUndefined();
    });
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

    it('dos registros idénticos en todo (duplicado exacto) disparan la alerta', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.registroHoras.findMany
        .mockResolvedValueOnce([
          { operarioCuil: '20-2-2', horas: 4, estado: 'aprobado' },
          { operarioCuil: '20-2-2', horas: 4, estado: 'aprobado' },
        ]) // filas
        .mockResolvedValueOnce([
          {
            id: 1,
            operarioCuil: '20-2-2',
            fecha: new Date('2026-08-01'),
            horas: 4,
            contratoId: 1,
            tareas: [{ tareaId: 10 }],
            moviles: [{ movilId: 5 }],
          },
          {
            id: 2,
            operarioCuil: '20-2-2',
            fecha: new Date('2026-08-01'),
            horas: 4,
            contratoId: 1,
            tareas: [{ tareaId: 10 }],
            moviles: [{ movilId: 5 }],
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

    it('mismo día repartido en dos lotes con horas distintas NO dispara la alerta (regla vieja sí)', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.registroHoras.findMany
        .mockResolvedValueOnce([
          { operarioCuil: '20-2-2', horas: 8, estado: 'aprobado' },
          { operarioCuil: '20-2-2', horas: 4, estado: 'aprobado' },
        ]) // filas
        .mockResolvedValueOnce([
          {
            id: 1,
            operarioCuil: '20-2-2',
            fecha: new Date('2026-08-01'),
            horas: 8,
            contratoId: 1,
            tareas: [],
            moviles: [],
          },
          {
            id: 2,
            operarioCuil: '20-2-2',
            fecha: new Date('2026-08-01'),
            horas: 4,
            contratoId: 2,
            tareas: [],
            moviles: [],
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

    it('filtra por operarioCuils cuando se pide', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.registroHoras.findMany.mockResolvedValue([]);
      await service.historicoQuincenas({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1, {
        operarioCuils: ['20-2-2', '20-3-3'],
      });
      const where = prismaMock.registroHoras.findMany.mock.calls[0][0].where;
      expect(where.operarioCuil).toEqual({ in: ['20-2-2', '20-3-3'] });
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
          createdAt: new Date(2026, 7, 3, 18, 0), aprobadoEn: null,
          cargadoPor: { cuil: '20-9-9', nombreFueraNomina: 'Super Visor' },
          aprobadoPor: null,
        },
        {
          id: 11, fecha: new Date(2026, 7, 3), contratoId: 1, operarioCuil: '20-3-3',
          horas: 4, estado: 'aprobado',
          contrato: { codigo: 'K5' }, operario: { apellido_nombre: 'Alfa Pedro' },
          tareas: [{ tarea: { nombre: 'Zanjeo' } }, { tarea: { nombre: 'Tendido de cañería' } }],
          observacion: 'Viaje a Metán por fuga',
          createdAt: new Date(2026, 7, 3, 20, 5), aprobadoEn: new Date(2026, 7, 4, 9, 0),
          cargadoPor: { cuil: '20-9-9', nombreFueraNomina: 'Super Visor' },
          aprobadoPor: { cuil: '20-8-8', nombreFueraNomina: 'Jefe Higiene' },
        },
      ]);
      const r = await service.detalleDiario({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1);
      // Un renglón por operario-día, con el detalle adentro (formato
      // desplegable, decisión 2026-08-19).
      expect(r[0]).toMatchObject({
        fecha: '2026-08-03',
        operarioCuil: '20-3-3',
        operarioNombre: 'Alfa Pedro',
        totalHoras: 4,
        contratos: ['K5'],
      });
      expect(r[0].registros[0]).toEqual({
        id: 11, contratoId: 1, contratoCodigo: 'K5', horas: 4, estado: 'aprobado',
        tareas: ['Zanjeo', 'Tendido de cañería'],
        observacion: 'Viaje a Metán por fuga',
        esMiContrato: true,
        cargadoPorNombre: 'Super Visor',
        cargadoEn: new Date(2026, 7, 3, 20, 5).toISOString(),
        aprobadoPorNombre: 'Jefe Higiene',
        aprobadoEn: new Date(2026, 7, 4, 9, 0).toISOString(),
      });
      expect(r[1].operarioNombre).toBe('Zeta Juan');
      expect(r[1].registros[0].tareas).toEqual([]);
      expect(r[1].registros[0].observacion).toBeNull();
    });

    it('filtra por operarioCuils cuando se pide', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.registroHoras.findMany.mockResolvedValue([]);
      await service.detalleDiario({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1, {
        operarioCuils: ['20-2-2'],
      });
      const where = prismaMock.registroHoras.findMany.mock.calls[0][0].where;
      expect(where.operarioCuil).toEqual({ in: ['20-2-2'] });
    });

    /** Jornada completa (decisión 2026-08-19): mis contratos deciden qué
     * OPERARIOS entran, y de cada uno se muestra toda su quincena — incluidos
     * los días que cargó entero en otro contrato ("registros sueltos"). Si no,
     * un jefe ve "8 hs" cuando la persona trabajó 12 repartidas con otro
     * contrato, y no ve nada de los días que no lo tocaron a él. */
    const filaDe = (id: number, contratoId: number, codigo: string, fecha: Date, cuil = '20-2-2') => ({
      id, fecha, contratoId, operarioCuil: cuil, horas: 4, estado: 'aprobado',
      contrato: { codigo }, operario: { apellido_nombre: 'Perez Juan' }, tareas: [],
      observacion: null, provinciaId: 1,
      createdAt: new Date(2026, 7, 3, 20, 0), aprobadoEn: null,
      cargadoPor: { cuil: '20-9-9', nombreFueraNomina: null },
      aprobadoPor: null,
    });

    /** Ayuda: todos los ids de registros de todos los días devueltos. */
    const idsDe = (r: any[]) => r.flatMap((d) => d.registros.map((x: any) => x.id)).sort();

    it('el día agrupa las horas de TODOS los contratos y marca las ajenas', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }]); // jefe solo de K5
      prismaMock.registroHoras.findMany.mockResolvedValue([
        filaDe(10, 1, 'K5', new Date(2026, 7, 3)),
        filaDe(11, 9, 'K9', new Date(2026, 7, 3)), // ajena, mismo día
      ]);
      const r = await service.detalleDiario({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1);
      expect(r).toHaveLength(1); // un solo renglón para el día
      expect(r[0].totalHoras).toBe(8); // 4 + 4: la jornada completa
      expect(r[0].contratos).toEqual(['K5', 'K9']);
      expect(r[0].registros.find((x) => x.id === 10)?.esMiContrato).toBe(true);
      expect(r[0].registros.find((x) => x.id === 11)?.esMiContrato).toBe(false);
    });

    /** El pedido de los jefes (2026-08-19): los "registros sueltos". Un día que
     * el operario cargó entero en un contrato ajeno igual tiene que verse, si
     * no el jefe no se entera de que la persona estuvo trabajando en otro lado
     * (y por qué llega al tope de horas o no aparece donde él la esperaba). */
    it('un día suelto en contrato ajeno igual entra si el operario es mío', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.registroHoras.findMany.mockResolvedValue([
        filaDe(10, 1, 'K5', new Date(2026, 7, 3)),
        filaDe(20, 9, 'K9', new Date(2026, 7, 4)), // otro día, solo contrato ajeno
      ]);
      const r = await service.detalleDiario({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1);
      expect(idsDe(r)).toEqual([10, 20]);
      const suelto = r.find((d) => d.fecha === '2026-08-04');
      expect(suelto?.registros[0].esMiContrato).toBe(false);
    });

    it('el filtro de contrato decide qué operarios entran, pero igual muestra la quincena completa', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]); // jefe de K5 y K8
      prismaMock.registroHoras.findMany.mockResolvedValue([
        filaDe(10, 1, 'K5', new Date(2026, 7, 3)),
        filaDe(11, 2, 'K8', new Date(2026, 7, 3)),
        filaDe(12, 9, 'K9', new Date(2026, 7, 3)),
        filaDe(20, 2, 'K8', new Date(2026, 7, 5)), // día sin K5: entra igual, el operario es mío
      ]);
      const r = await service.detalleDiario({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1, {
        contratoIds: [1],
      });
      expect(idsDe(r)).toEqual([10, 11, 12, 20]);
      const k8 = r.flatMap((d) => d.registros).find((x) => x.id === 11);
      expect(k8?.esMiContrato).toBe(true); // K8 sigue siendo mío aunque filtré K5
    });

    it('un operario que NUNCA aparece en mis contratos no entra', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.registroHoras.findMany.mockResolvedValue([
        filaDe(10, 1, 'K5', new Date(2026, 7, 3), '20-2-2'),
        filaDe(30, 9, 'K9', new Date(2026, 7, 3), '20-9-9'), // otro operario, mismo día
      ]);
      const r = await service.detalleDiario({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1);
      expect(idsDe(r)).toEqual([10]);
    });

    it('las desaprobadas aparecen en el detalle pero no suman al total (igual que +13hs)', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.registroHoras.findMany.mockResolvedValue([
        filaDe(10, 1, 'K5', new Date(2026, 7, 3)),
        { ...filaDe(11, 1, 'K5', new Date(2026, 7, 3)), estado: 'desaprobado' },
      ]);
      const r = await service.detalleDiario({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1);
      expect(r[0].totalHoras).toBe(4);
      expect(r[0].registros).toHaveLength(2);
    });
  });

  describe('controlDiario', () => {
    it('7+7 en dos contratos supera el umbral (>13 cruzando todo); 13 exactos no entra; ordena por total desc', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }]);
      prismaMock.registroHoras.findMany
        .mockResolvedValueOnce([
          // Zeta: 7 en mi contrato + 7 en contrato ajeno el mismo día = 14 → entra
          { operarioCuil: '20-2-2', fecha: new Date(2026, 7, 3), horas: 7, contratoId: 1, provinciaId: 1 },
          { operarioCuil: '20-2-2', fecha: new Date(2026, 7, 3), horas: 7, contratoId: 99, provinciaId: 1 },
          // Alfa: 15 en mi contrato otro día → entra, con más horas que Zeta
          { operarioCuil: '20-3-3', fecha: new Date(2026, 7, 4), horas: 15, contratoId: 1, provinciaId: 1 },
          // Beta: 13 exactos → NO entra (umbral estrictamente mayor)
          { operarioCuil: '20-4-4', fecha: new Date(2026, 7, 3), horas: 13, contratoId: 1, provinciaId: 1 },
        ]) // totales del día (pendiente+aprobado, todos los contratos)
        .mockResolvedValueOnce([
          {
            id: 1, operarioCuil: '20-2-2', fecha: new Date(2026, 7, 3), horas: 7, estado: 'aprobado',
            observacion: null, contrato: { codigo: 'K5' },
            operario: { apellido_nombre: 'Zeta Juan' },
            tareas: [{ tarea: { nombre: 'Zanjeo' } }],
            createdAt: new Date(2026, 7, 3, 18, 0), aprobadoEn: new Date(2026, 7, 4, 9, 0),
            cargadoPor: { cuil: '20-9-9', nombreFueraNomina: 'Super Visor' },
            aprobadoPor: { cuil: '20-8-8', nombreFueraNomina: 'Jefe Higiene' },
          },
          {
            id: 2, operarioCuil: '20-2-2', fecha: new Date(2026, 7, 3), horas: 7, estado: 'pendiente',
            observacion: 'Viaje a Metán', contrato: { codigo: 'K9' },
            operario: { apellido_nombre: 'Zeta Juan' },
            tareas: [],
            createdAt: new Date(2026, 7, 3, 18, 30), aprobadoEn: null,
            cargadoPor: { cuil: '20-9-9', nombreFueraNomina: 'Super Visor' },
            aprobadoPor: null,
          },
          {
            id: 3, operarioCuil: '20-3-3', fecha: new Date(2026, 7, 4), horas: 15, estado: 'aprobado',
            observacion: null, contrato: { codigo: 'K5' },
            operario: { apellido_nombre: 'Alfa Pedro' },
            tareas: [{ tarea: { nombre: 'Perforación' } }],
            createdAt: new Date(2026, 7, 4, 19, 0), aprobadoEn: new Date(2026, 7, 5, 9, 0),
            cargadoPor: { cuil: '20-9-9', nombreFueraNomina: 'Super Visor' },
            aprobadoPor: { cuil: '20-8-8', nombreFueraNomina: 'Jefe Higiene' },
          },
        ]); // detalle de los días que superaron el umbral
      const r = await service.controlDiario({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1);
      expect(r).toHaveLength(2);
      expect(r[0]).toMatchObject({
        operarioCuil: '20-3-3', operarioNombre: 'Alfa Pedro', fecha: '2026-08-04',
        totalHoras: 15, contratos: ['K5'],
      });
      expect(r[1]).toMatchObject({
        operarioCuil: '20-2-2', operarioNombre: 'Zeta Juan', fecha: '2026-08-03',
        totalHoras: 14, contratos: ['K5', 'K9'],
      });
      expect(r[1].registros).toHaveLength(2);
      expect(r[1].registros[0]).toMatchObject({
        contratoCodigo: 'K5', horas: 7, estado: 'aprobado', tareas: ['Zanjeo'], observacion: null,
      });
      // el primer query excluye desaprobado (no cuentan para el total)
      const whereTotales = prismaMock.registroHoras.findMany.mock.calls[0][0].where;
      expect(whereTotales.estado).toEqual({ not: 'desaprobado' });
      // el segundo query NO excluye desaprobado (el detalle muestra la historia completa)
      const whereDetalle = prismaMock.registroHoras.findMany.mock.calls[1][0].where;
      expect(whereDetalle.estado).toBeUndefined();
    });

    it('un día cuyo total supera 13 pero sin ninguna fila en mis contratos filtrados NO entra', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      prismaMock.registroHoras.findMany.mockResolvedValueOnce([
        // 14hs pero todas en el contrato 2 — con filtro contratoIds=[1] el día no entra
        { operarioCuil: '20-2-2', fecha: new Date(2026, 7, 3), horas: 14, contratoId: 2, provinciaId: 1 },
      ]);
      const r = await service.controlDiario({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1, {
        contratoIds: [1],
      });
      expect(r).toEqual([]);
      // sin días candidatos no hace falta el query de detalle
      expect(prismaMock.registroHoras.findMany).toHaveBeenCalledTimes(1);
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
