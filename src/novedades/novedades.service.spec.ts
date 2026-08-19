import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { NovedadesService } from './novedades.service';
import { PrismaService } from '../prisma/prisma.service';
import { CalculoService } from '../liquidacion/calculo.service';
import { NOVEDAD_ADJUNTO_STORAGE } from './storage/novedad-adjunto-storage.interface';

describe('NovedadesService#findAll', () => {
  const prismaMock: any = {
    novedad: { findMany: jest.fn() },
  };
  let service: NovedadesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.novedad.findMany.mockResolvedValue([]);

    const mod = await Test.createTestingModule({
      providers: [
        NovedadesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CalculoService, useValue: { diasClip: jest.fn() } },
        { provide: NOVEDAD_ADJUNTO_STORAGE, useValue: {} },
      ],
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

describe('NovedadesService#update', () => {
  const prismaMock: any = {
    novedad: { findUnique: jest.fn(), update: jest.fn() },
    tipoNovedad: { findUnique: jest.fn() },
    auditoria: { create: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(prismaMock)),
  };
  const adjuntoStorageMock = {
    guardar: jest.fn(),
    leer: jest.fn(),
    borrar: jest.fn(),
  };
  let service: NovedadesService;

  const NOVEDAD_RESUELTA = {
    id: 1,
    operarioCuil: '20111111111',
    tipoNovedadId: 5,
    fechaInicio: new Date(2026, 7, 1),
    fechaFin: new Date(2026, 7, 2),
    justificacionTexto: 'texto viejo',
    adjuntoUrl: null,
    estadoHys: 'desaprobada',
    aprobadoHysPorCuil: '20999999999',
    aprobadoHysEn: new Date(2026, 7, 5),
    descargoHys: 'no corresponde',
    estado: 'activa',
    tipoNovedad: { id: 5, nombre: 'Ausencia' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const mod = await Test.createTestingModule({
      providers: [
        NovedadesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CalculoService, useValue: { diasClip: jest.fn() } },
        { provide: NOVEDAD_ADJUNTO_STORAGE, useValue: adjuntoStorageMock },
      ],
    }).compile();
    service = mod.get(NovedadesService);
  });

  it('404 si la novedad no existe', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue(null);
    await expect(
      service.update(999, {}, undefined, { cuil: '20000000000', rol: 'Admin' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('editar una novedad ya resuelta (aprobada/desaprobada) la vuelve a pendiente y limpia la resolución', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue(NOVEDAD_RESUELTA);
    prismaMock.novedad.update.mockResolvedValue({ ...NOVEDAD_RESUELTA, estadoHys: 'pendiente' });

    await service.update(1, { justificacionTexto: 'texto nuevo' }, undefined, {
      cuil: '20000000000',
      rol: 'Admin',
    });

    const data = prismaMock.novedad.update.mock.calls[0][0].data;
    expect(data.estadoHys).toBe('pendiente');
    expect(data.aprobadoHysPorCuil).toBeNull();
    expect(data.aprobadoHysEn).toBeNull();
    expect(data.descargoHys).toBeNull();
    expect(data.justificacionTexto).toBe('texto nuevo');
  });

  it('editar una novedad que estaba pendiente NO toca estadoHys (ya lo estaba)', async () => {
    const novedadPendiente = { ...NOVEDAD_RESUELTA, estadoHys: 'pendiente' };
    prismaMock.novedad.findUnique.mockResolvedValue(novedadPendiente);
    prismaMock.novedad.update.mockResolvedValue(novedadPendiente);

    await service.update(1, { justificacionTexto: 'texto nuevo' }, undefined, {
      cuil: '20000000000',
      rol: 'Admin',
    });

    const data = prismaMock.novedad.update.mock.calls[0][0].data;
    expect(data.estadoHys).toBeUndefined();
    expect(data.aprobadoHysPorCuil).toBeUndefined();
    expect(data.aprobadoHysEn).toBeUndefined();
    expect(data.descargoHys).toBeUndefined();
  });

  it('escribe una fila de Auditoria con snapshot antes/después', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue(NOVEDAD_RESUELTA);
    prismaMock.novedad.update.mockResolvedValue({ ...NOVEDAD_RESUELTA, estadoHys: 'pendiente' });

    await service.update(1, { justificacionTexto: 'texto nuevo' }, undefined, {
      cuil: '20555555555',
      rol: 'Admin',
    });

    expect(prismaMock.auditoria.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.auditoria.create.mock.calls[0][0].data;
    expect(data.tabla).toBe('sth_novedades');
    expect(data.registroId).toBe(1);
    expect(data.usuarioCuil).toBe('20555555555');
    expect(data.accion).toBe('editar');
    expect(data.campo).toBe('novedad');
    expect(JSON.parse(data.valorAnterior)).toMatchObject({ estadoHys: 'desaprobada' });
    expect(JSON.parse(data.valorNuevo)).toMatchObject({ estadoHys: 'pendiente' });
  });

  it('si sube un adjunto nuevo y ya había uno, borra el viejo antes de guardar el nuevo', async () => {
    const conAdjunto = { ...NOVEDAD_RESUELTA, adjuntoUrl: '2026/07/viejo.jpg' };
    prismaMock.novedad.findUnique.mockResolvedValue(conAdjunto);
    prismaMock.novedad.update.mockResolvedValue(conAdjunto);
    adjuntoStorageMock.guardar.mockResolvedValue('2026/08/nuevo.jpg');

    await service.update(
      1,
      {},
      { buffer: Buffer.from('x'), mimetype: 'image/jpeg' },
      { cuil: '20000000000', rol: 'Admin' },
    );

    expect(adjuntoStorageMock.borrar).toHaveBeenCalledWith('2026/07/viejo.jpg');
    expect(adjuntoStorageMock.guardar).toHaveBeenCalledWith(Buffer.from('x'), 'image/jpeg');
    const data = prismaMock.novedad.update.mock.calls[0][0].data;
    expect(data.adjuntoUrl).toBe('2026/08/nuevo.jpg');
  });

  it('HyS puede editar una novedad de tipo Ausencia', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue(NOVEDAD_RESUELTA);
    prismaMock.novedad.update.mockResolvedValue(NOVEDAD_RESUELTA);

    await expect(
      service.update(1, { justificacionTexto: 'texto nuevo' }, undefined, {
        cuil: '20666666666',
        rol: 'HyS',
      }),
    ).resolves.toBeDefined();
  });

  it('HyS recibe 403 al intentar editar una novedad que no es Ausencia', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({
      ...NOVEDAD_RESUELTA,
      tipoNovedad: { id: 6, nombre: 'Accidente' },
    });

    await expect(
      service.update(1, { justificacionTexto: 'texto nuevo' }, undefined, {
        cuil: '20666666666',
        rol: 'HyS',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('Admin puede editar cualquier tipo de novedad (sin restricción)', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({
      ...NOVEDAD_RESUELTA,
      tipoNovedad: { id: 6, nombre: 'Accidente' },
    });
    prismaMock.novedad.update.mockResolvedValue(NOVEDAD_RESUELTA);

    await expect(
      service.update(1, { justificacionTexto: 'texto nuevo' }, undefined, {
        cuil: '20000000000',
        rol: 'Admin',
      }),
    ).resolves.toBeDefined();
  });

  it('editar una novedad anulada lanza BadRequestException', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({ ...NOVEDAD_RESUELTA, estado: 'anulada' });

    await expect(
      service.update(1, { justificacionTexto: 'texto nuevo' }, undefined, {
        cuil: '20000000000',
        rol: 'Admin',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  /** El alcance también se juzga sobre el tipo DESTINO: si no, HyS convertía
   * una Ausencia (que sí puede tocar) en otro tipo y se escapaba de su
   * restricción — con impacto en liquidación si el destino tiene generaPlus. */
  it('HyS recibe 403 si intenta convertir una Ausencia en otro tipo', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue(NOVEDAD_RESUELTA); // es Ausencia
    prismaMock.tipoNovedad.findUnique.mockResolvedValue({ id: 6, nombre: 'Accidente' });

    await expect(
      service.update(1, { tipoNovedadId: 6 }, undefined, { cuil: '20666666666', rol: 'HyS' }),
    ).rejects.toThrow(ForbiddenException);
    expect(prismaMock.novedad.update).not.toHaveBeenCalled();
  });

  it('HyS puede editar una Ausencia mandando su MISMO tipo (no es un cambio)', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue(NOVEDAD_RESUELTA);
    prismaMock.novedad.update.mockResolvedValue(NOVEDAD_RESUELTA);

    await expect(
      service.update(1, { tipoNovedadId: 5, justificacionTexto: 'nuevo' }, undefined, {
        cuil: '20666666666',
        rol: 'HyS',
      }),
    ).resolves.toBeDefined();
    // Mismo tipo: no hace falta ir a buscar el destino a la base.
    expect(prismaMock.tipoNovedad.findUnique).not.toHaveBeenCalled();
  });

  it('Admin sí puede convertir una Ausencia en otro tipo (sin restricción)', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue(NOVEDAD_RESUELTA);
    prismaMock.tipoNovedad.findUnique.mockResolvedValue({ id: 6, nombre: 'Accidente' });
    prismaMock.novedad.update.mockResolvedValue({ ...NOVEDAD_RESUELTA, tipoNovedadId: 6 });

    await expect(
      service.update(1, { tipoNovedadId: 6 }, undefined, { cuil: '20000000000', rol: 'Admin' }),
    ).resolves.toBeDefined();
  });

  it('404 si el tipo destino no existe', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue(NOVEDAD_RESUELTA);
    prismaMock.tipoNovedad.findUnique.mockResolvedValue(null);

    await expect(
      service.update(1, { tipoNovedadId: 999 }, undefined, { cuil: '20000000000', rol: 'Admin' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('NovedadesService#anular', () => {
  const prismaMock: any = {
    novedad: { findUnique: jest.fn(), update: jest.fn() },
    auditoria: { create: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(prismaMock)),
  };
  let service: NovedadesService;

  const NOVEDAD_ACTIVA = {
    id: 1,
    operarioCuil: '20111111111',
    tipoNovedadId: 5,
    estado: 'activa',
    tipoNovedad: { id: 5, nombre: 'Ausencia' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        NovedadesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CalculoService, useValue: { diasClip: jest.fn() } },
        { provide: NOVEDAD_ADJUNTO_STORAGE, useValue: {} },
      ],
    }).compile();
    service = mod.get(NovedadesService);
  });

  it('404 si la novedad no existe', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue(null);
    await expect(
      service.anular(999, 'motivo', { cuil: '20000000000', rol: 'Admin' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('HyS puede anular una novedad de tipo Ausencia', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue(NOVEDAD_ACTIVA);
    prismaMock.novedad.update.mockResolvedValue({ ...NOVEDAD_ACTIVA, estado: 'anulada' });

    await expect(
      service.anular(1, 'motivo', { cuil: '20666666666', rol: 'HyS' }),
    ).resolves.toBeDefined();
  });

  it('HyS recibe 403 al intentar anular una novedad que no es Ausencia', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({
      ...NOVEDAD_ACTIVA,
      tipoNovedad: { id: 6, nombre: 'Accidente' },
    });

    await expect(
      service.anular(1, 'motivo', { cuil: '20666666666', rol: 'HyS' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('Admin puede anular cualquier tipo de novedad (sin restricción)', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({
      ...NOVEDAD_ACTIVA,
      tipoNovedad: { id: 6, nombre: 'Accidente' },
    });
    prismaMock.novedad.update.mockResolvedValue({ ...NOVEDAD_ACTIVA, estado: 'anulada' });

    await expect(
      service.anular(1, 'motivo', { cuil: '20000000000', rol: 'Admin' }),
    ).resolves.toBeDefined();
  });

  it('anular una novedad ya anulada lanza BadRequestException', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({ ...NOVEDAD_ACTIVA, estado: 'anulada' });

    await expect(
      service.anular(1, 'motivo', { cuil: '20000000000', rol: 'Admin' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('la transacción escribe el update de estado y la fila de Auditoria', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue(NOVEDAD_ACTIVA);
    prismaMock.novedad.update.mockResolvedValue({ ...NOVEDAD_ACTIVA, estado: 'anulada' });

    await service.anular(1, 'Carga duplicada', { cuil: '20777777777', rol: 'Admin' });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.novedad.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          estado: 'anulada',
          motivoAnulacion: 'Carga duplicada',
          anuladaPorCuil: '20777777777',
        }),
      }),
    );
    expect(prismaMock.auditoria.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tabla: 'sth_novedades',
          registroId: 1,
          usuarioCuil: '20777777777',
          accion: 'anular',
          campo: 'estado',
          valorAnterior: 'activa',
          valorNuevo: 'anulada',
        }),
      }),
    );
  });
});

describe('NovedadesService#resolverHys', () => {
  const prismaMock: any = {
    novedad: { findUnique: jest.fn(), update: jest.fn() },
  };
  let service: NovedadesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        NovedadesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CalculoService, useValue: { diasClip: jest.fn() } },
        { provide: NOVEDAD_ADJUNTO_STORAGE, useValue: {} },
      ],
    }).compile();
    service = mod.get(NovedadesService);
  });

  it('404 si la novedad no existe', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue(null);
    await expect(
      service.resolverHys(999, { estadoHys: 'aprobada' }, '20000000000'),
    ).rejects.toThrow(NotFoundException);
  });

  it('resolver una novedad anulada lanza BadRequestException', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({ id: 1, estado: 'anulada' });
    await expect(
      service.resolverHys(1, { estadoHys: 'aprobada' }, '20000000000'),
    ).rejects.toThrow(BadRequestException);
  });

  it('resuelve una novedad activa sin problemas', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({ id: 1, estado: 'activa' });
    prismaMock.novedad.update.mockResolvedValue({ id: 1, estadoHys: 'aprobada' });

    await expect(
      service.resolverHys(1, { estadoHys: 'aprobada' }, '20000000000'),
    ).resolves.toBeDefined();
  });
});

describe('NovedadesService#reabrir', () => {
  const prismaMock: any = {
    novedad: { findUnique: jest.fn(), update: jest.fn() },
    auditoria: { create: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(prismaMock)),
  };
  let service: NovedadesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        NovedadesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CalculoService, useValue: { diasClip: jest.fn() } },
        { provide: NOVEDAD_ADJUNTO_STORAGE, useValue: {} },
      ],
    }).compile();
    service = mod.get(NovedadesService);
  });

  it('404 si la novedad no existe', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue(null);
    await expect(service.reabrir(999, { cuil: '20000000000', rol: 'HyS' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('reabrir una novedad anulada lanza BadRequestException', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({ id: 2, estadoHys: 'aprobada', estado: 'anulada' });
    await expect(service.reabrir(2, { cuil: '20000000000', rol: 'HyS' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('resetea estadoHys a pendiente y limpia aprobadoHysPorCuil/aprobadoHysEn/descargoHys', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({ id: 2, estadoHys: 'aprobada' });
    prismaMock.novedad.update.mockResolvedValue({ id: 2, estadoHys: 'pendiente' });

    await service.reabrir(2, { cuil: '20000000000', rol: 'HyS' });

    const data = prismaMock.novedad.update.mock.calls[0][0].data;
    expect(data).toEqual({
      estadoHys: 'pendiente',
      aprobadoHysPorCuil: null,
      aprobadoHysEn: null,
      descargoHys: null,
    });
  });

  it('escribe una fila de Auditoria con accion=reabrir y el estadoHys previo', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({ id: 2, estadoHys: 'desaprobada' });
    prismaMock.novedad.update.mockResolvedValue({ id: 2, estadoHys: 'pendiente' });

    await service.reabrir(2, { cuil: '20777777777', rol: 'Admin' });

    expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
      data: {
        tabla: 'sth_novedades',
        registroId: 2,
        usuarioCuil: '20777777777',
        accion: 'reabrir',
        campo: 'estadoHys',
        valorAnterior: 'desaprobada',
        valorNuevo: 'pendiente',
      },
    });
  });
});

describe('NovedadesService#resumenAusencias', () => {
  const prismaMock: any = {
    novedad: { findMany: jest.fn() },
  };
  const calculoMock = { diasClip: jest.fn() };
  let service: NovedadesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        NovedadesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CalculoService, useValue: calculoMock },
        { provide: NOVEDAD_ADJUNTO_STORAGE, useValue: {} },
      ],
    }).compile();
    service = mod.get(NovedadesService);
  });

  it('filtra por tipoNovedad.nombre = Ausencia y por la superposición con la quincena', async () => {
    prismaMock.novedad.findMany.mockResolvedValue([]);
    await service.resumenAusencias(2026, 8, 1);

    const where = prismaMock.novedad.findMany.mock.calls[0][0].where;
    expect(where.tipoNovedad).toEqual({ nombre: 'Ausencia' });
    expect(where.estado).toBe('activa');
    expect(where.fechaInicio).toEqual({ lte: new Date(2026, 7, 15) });
    expect(where.OR).toEqual([
      { fechaFin: { gte: new Date(2026, 7, 1) } },
      { fechaFin: null, fechaInicio: { gte: new Date(2026, 7, 1) } },
    ]);
  });

  it('operario con una Ausencia activa y otra anulada: la anulada no llega (where filtra estado: activa) y no cuenta días', async () => {
    // El where ya excluye estado: 'anulada' (verificado en el test anterior),
    // así que Prisma nunca devolvería la anulada — solo la activa participa
    // del resumen para este operario.
    prismaMock.novedad.findMany.mockResolvedValue([
      {
        operarioCuil: '20444444444',
        fechaInicio: new Date(2026, 7, 2),
        fechaFin: new Date(2026, 7, 2),
        estadoHys: 'aprobada',
        estado: 'activa',
        operario: { apellido_nombre: 'MIXTO, MARIO', legajo: 404 },
      },
    ]);
    calculoMock.diasClip.mockReturnValueOnce(1);

    const resumen = await service.resumenAusencias(2026, 8, 1);

    expect(resumen).toEqual([
      {
        operarioCuil: '20444444444',
        apellidoNombre: 'MIXTO, MARIO',
        legajo: 404,
        diasJustificados: 1,
        diasInjustificados: 0,
        diasPendientes: 0,
      },
    ]);
  });

  it('usa CalculoService#diasClip para clipear cada novedad a la quincena, y bucketiza por estadoHys', async () => {
    prismaMock.novedad.findMany.mockResolvedValue([
      {
        operarioCuil: '20111111111',
        fechaInicio: new Date(2026, 7, 1),
        fechaFin: new Date(2026, 7, 3),
        estadoHys: 'aprobada',
        operario: { apellido_nombre: 'JUSTIFICADO, JUAN', legajo: 101 },
      },
      {
        operarioCuil: '20111111111',
        fechaInicio: new Date(2026, 7, 5),
        fechaFin: new Date(2026, 7, 5),
        estadoHys: 'desaprobada',
        operario: { apellido_nombre: 'JUSTIFICADO, JUAN', legajo: 101 },
      },
      {
        operarioCuil: '20222222222',
        fechaInicio: new Date(2026, 7, 10),
        fechaFin: null,
        estadoHys: 'pendiente',
        operario: { apellido_nombre: 'PENDIENTE, PEDRO', legajo: 202 },
      },
      {
        operarioCuil: '20333333333',
        fechaInicio: new Date(2026, 7, 11),
        fechaFin: null,
        estadoHys: 'no_aplica',
        operario: { apellido_nombre: 'SINAPROBACION, SOFIA', legajo: 303 },
      },
    ]);
    calculoMock.diasClip.mockReturnValueOnce(3).mockReturnValueOnce(1).mockReturnValueOnce(1).mockReturnValueOnce(1);

    const resumen = await service.resumenAusencias(2026, 8, 1);

    expect(resumen).toEqual(
      expect.arrayContaining([
        {
          operarioCuil: '20111111111',
          apellidoNombre: 'JUSTIFICADO, JUAN',
          legajo: 101,
          diasJustificados: 3,
          diasInjustificados: 1,
          diasPendientes: 0,
        },
        {
          operarioCuil: '20222222222',
          apellidoNombre: 'PENDIENTE, PEDRO',
          legajo: 202,
          diasJustificados: 0,
          diasInjustificados: 0,
          diasPendientes: 1,
        },
        {
          operarioCuil: '20333333333',
          apellidoNombre: 'SINAPROBACION, SOFIA',
          legajo: 303,
          diasJustificados: 0,
          diasInjustificados: 0,
          diasPendientes: 1, // no_aplica también cuenta como "pendiente" en el resumen
        },
      ]),
    );
    expect(resumen).toHaveLength(3);
  });

  it('sin novedades: devuelve lista vacía', async () => {
    prismaMock.novedad.findMany.mockResolvedValue([]);
    const resumen = await service.resumenAusencias(2026, 8, 1);
    expect(resumen).toEqual([]);
  });
});
