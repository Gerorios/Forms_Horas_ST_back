import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { NovedadesService, MAX_ADJUNTOS_POR_NOVEDAD } from './novedades.service';
import { PrismaService } from '../prisma/prisma.service';
import { CalculoService } from '../liquidacion/calculo.service';
import { NOVEDAD_ADJUNTO_STORAGE } from './storage/novedad-adjunto-storage.interface';

/**
 * Certificados múltiples por novedad (2026-09-10). El caso que motivó la
 * feature: el operario pide permiso para ir al médico, el supervisor carga la
 * novedad ese día, y el certificado llega cuando el operario vuelve.
 *
 * La regla que atraviesa todo el archivo: adjuntar NUNCA cambia el estado de
 * HyS. El aviso viaja como dato derivado y la decisión de reabrir sigue
 * siendo de HyS.
 */
describe('NovedadesService — certificados', () => {
  const prismaMock: any = {
    novedad: { findUnique: jest.fn() },
    novedadAdjunto: { count: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    auditoria: { create: jest.fn() },
    snuempleados: { findMany: jest.fn() },
    usuario: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const storage = { guardar: jest.fn(), leer: jest.fn(), borrar: jest.fn() };
  let service: NovedadesService;

  const SUPERVISOR = { cuil: '20111111111', rol: 'Supervisor' };
  const ARCHIVO = { buffer: Buffer.from('pdf'), mimetype: 'application/pdf' as const };

  /** Novedad tal como la lee agregarAdjunto/quitarAdjunto (select acotado). */
  const NOVEDAD = {
    id: 1,
    cargadoPorCuil: '20111111111',
    estado: 'activa',
    estadoHys: 'pendiente',
  };

  /** Lo que devuelve el `detalle(id)` final de agregar/quitar. */
  const DETALLE = {
    id: 1,
    estadoHys: 'pendiente',
    aprobadoHysEn: null,
    cargadoPor: { cuil: '20111111111', nombreFueraNomina: null },
    adjuntos: [],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    storage.guardar.mockResolvedValue('2026/09/nuevo.pdf');
    prismaMock.novedadAdjunto.count.mockResolvedValue(0);
    prismaMock.novedadAdjunto.create.mockResolvedValue({ id: 42 });
    prismaMock.snuempleados.findMany.mockResolvedValue([]);
    prismaMock.usuario.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));

    const mod = await Test.createTestingModule({
      providers: [
        NovedadesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CalculoService, useValue: {} },
        { provide: NOVEDAD_ADJUNTO_STORAGE, useValue: storage },
      ],
    }).compile();
    service = mod.get(NovedadesService);
  });

  /** agregar/quitar terminan releyendo la novedad completa para devolverla. */
  function conDetalleFinal(novedad: any = NOVEDAD, detalle: any = DETALLE) {
    prismaMock.novedad.findUnique.mockResolvedValueOnce(novedad).mockResolvedValueOnce(detalle);
  }

  // ---------------------------------------------------------------- agregar

  describe('agregarAdjunto', () => {
    it('guarda el archivo y lo asocia a la novedad, con quién lo subió', async () => {
      conDetalleFinal();

      await service.agregarAdjunto(1, ARCHIVO, SUPERVISOR);

      expect(storage.guardar).toHaveBeenCalledWith(ARCHIVO.buffer, 'application/pdf');
      expect(prismaMock.novedadAdjunto.create).toHaveBeenCalledWith({
        data: {
          novedadId: 1,
          path: '2026/09/nuevo.pdf',
          mimetype: 'application/pdf',
          subidoPorCuil: '20111111111',
        },
      });
    });

    it('deja auditoría con accion=adjuntar', async () => {
      conDetalleFinal();

      await service.agregarAdjunto(1, ARCHIVO, SUPERVISOR);

      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tabla: 'sth_novedades_adjuntos',
          registroId: 42,
          usuarioCuil: '20111111111',
          accion: 'adjuntar',
        }),
      });
    });

    /** El corazón de la decisión: subir un papel no resuelve nada. */
    it('NO cambia el estado de HyS de una novedad ya resuelta', async () => {
      conDetalleFinal(
        { ...NOVEDAD, estadoHys: 'desaprobada' },
        { ...DETALLE, estadoHys: 'desaprobada' },
      );
      prismaMock.novedad.update = jest.fn();

      const r: any = await service.agregarAdjunto(1, ARCHIVO, SUPERVISOR);

      expect(prismaMock.novedad.update).not.toHaveBeenCalled();
      expect(r.estadoHys).toBe('desaprobada');
    });

    it('rechaza el cuarto certificado y no toca el disco', async () => {
      prismaMock.novedad.findUnique.mockResolvedValue(NOVEDAD);
      prismaMock.novedadAdjunto.count.mockResolvedValue(MAX_ADJUNTOS_POR_NOVEDAD);

      await expect(service.agregarAdjunto(1, ARCHIVO, SUPERVISOR)).rejects.toThrow(
        `Llegaste al máximo de ${MAX_ADJUNTOS_POR_NOVEDAD} certificados`,
      );
      expect(storage.guardar).not.toHaveBeenCalled();
      expect(prismaMock.novedadAdjunto.create).not.toHaveBeenCalled();
    });

    it('no deja archivos huérfanos cuando la novedad está anulada', async () => {
      prismaMock.novedad.findUnique.mockResolvedValue({ ...NOVEDAD, estado: 'anulada' });

      await expect(service.agregarAdjunto(1, ARCHIVO, SUPERVISOR)).rejects.toThrow(
        BadRequestException,
      );
      expect(storage.guardar).not.toHaveBeenCalled();
    });

    it('JefeCuadrilla no puede adjuntar a una novedad que no cargó', async () => {
      prismaMock.novedad.findUnique.mockResolvedValue({ ...NOVEDAD, cargadoPorCuil: '20999999999' });

      await expect(
        service.agregarAdjunto(1, ARCHIVO, { cuil: '20111111111', rol: 'JefeCuadrilla' }),
      ).rejects.toThrow(ForbiddenException);
      expect(storage.guardar).not.toHaveBeenCalled();
    });

    it('JefeCuadrilla SÍ puede adjuntar a la que cargó él', async () => {
      conDetalleFinal();

      await expect(
        service.agregarAdjunto(1, ARCHIVO, { cuil: '20111111111', rol: 'JefeCuadrilla' }),
      ).resolves.toBeDefined();
      expect(storage.guardar).toHaveBeenCalled();
    });

    it('novedad inexistente', async () => {
      prismaMock.novedad.findUnique.mockResolvedValue(null);
      await expect(service.agregarAdjunto(9, ARCHIVO, SUPERVISOR)).rejects.toThrow(NotFoundException);
    });
  });

  // ----------------------------------------------------------------- quitar

  describe('quitarAdjunto', () => {
    const ADJUNTO = { id: 42, path: '2026/09/x.pdf', subidoPorCuil: '20111111111' };

    beforeEach(() => {
      prismaMock.novedadAdjunto.findFirst.mockResolvedValue(ADJUNTO);
    });

    it('es baja lógica: marca la fila y CONSERVA el archivo', async () => {
      conDetalleFinal();

      await service.quitarAdjunto(1, 42, SUPERVISOR);

      expect(prismaMock.novedadAdjunto.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { eliminadoEn: expect.any(Date), eliminadoPorCuil: '20111111111' },
      });
      expect(storage.borrar).not.toHaveBeenCalled();
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ accion: 'quitar_adjunto' }),
      });
    });

    it('no se puede quitar el certificado de una novedad ya resuelta', async () => {
      prismaMock.novedad.findUnique.mockResolvedValue({ ...NOVEDAD, estadoHys: 'aprobada' });

      await expect(service.quitarAdjunto(1, 42, SUPERVISOR)).rejects.toThrow(
        'ya fue resuelta por HyS',
      );
      expect(prismaMock.novedadAdjunto.update).not.toHaveBeenCalled();
    });

    it('un supervisor no puede quitar el certificado que subió otro', async () => {
      prismaMock.novedad.findUnique.mockResolvedValue(NOVEDAD);
      prismaMock.novedadAdjunto.findFirst.mockResolvedValue({
        ...ADJUNTO,
        subidoPorCuil: '20999999999',
      });

      await expect(service.quitarAdjunto(1, 42, SUPERVISOR)).rejects.toThrow(
        'Solo podés quitar los certificados que subiste vos',
      );
    });

    it('HyS puede quitar cualquiera mientras no esté resuelta', async () => {
      conDetalleFinal();
      prismaMock.novedadAdjunto.findFirst.mockResolvedValue({
        ...ADJUNTO,
        subidoPorCuil: '20999999999',
      });

      await expect(
        service.quitarAdjunto(1, 42, { cuil: '20666666666', rol: 'HyS' }),
      ).resolves.toBeDefined();
      expect(prismaMock.novedadAdjunto.update).toHaveBeenCalled();
    });

    /**
     * La salida para el certificado subido en la novedad equivocada: es dato
     * de salud de otra persona y no puede quedar recuperable.
     */
    it('Admin con definitivo borra el archivo del disco', async () => {
      conDetalleFinal({ ...NOVEDAD, estadoHys: 'aprobada' }, DETALLE);

      await service.quitarAdjunto(1, 42, { cuil: '20000000000', rol: 'Admin' }, true);

      expect(storage.borrar).toHaveBeenCalledWith('2026/09/x.pdf');
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ accion: 'borrar_adjunto' }),
      });
    });

    it('un no-Admin no puede pedir el borrado definitivo', async () => {
      prismaMock.novedad.findUnique.mockResolvedValue(NOVEDAD);

      await expect(
        service.quitarAdjunto(1, 42, { cuil: '20666666666', rol: 'HyS' }, true),
      ).rejects.toThrow('Solo un Admin puede borrar un certificado definitivamente');
      expect(storage.borrar).not.toHaveBeenCalled();
    });

    it('un certificado de otra novedad no se puede quitar desde esta', async () => {
      prismaMock.novedad.findUnique.mockResolvedValue(NOVEDAD);
      prismaMock.novedadAdjunto.findFirst.mockResolvedValue(null);

      await expect(service.quitarAdjunto(1, 999, SUPERVISOR)).rejects.toThrow(NotFoundException);
    });
  });

  // ------------------------------------------------- aviso "llegó después"

  describe('certificadoPosteriorAResolucion', () => {
    const resuelta = (adjuntos: { subidoEn: Date }[], aprobadoHysEn: Date | null) => ({
      id: 1,
      estadoHys: 'aprobada',
      aprobadoHysEn,
      cargadoPor: { cuil: '20111111111', nombreFueraNomina: null },
      adjuntos: adjuntos.map((a, i) => ({
        id: i + 1,
        mimetype: 'application/pdf',
        subidoPorCuil: '20111111111',
        ...a,
      })),
    });

    async function detalleDe(novedad: any) {
      prismaMock.novedad.findUnique.mockResolvedValue(NOVEDAD);
      prismaMock.novedadAdjunto.findFirst.mockResolvedValue({
        id: 42,
        path: 'x.pdf',
        subidoPorCuil: '20111111111',
      });
      prismaMock.novedad.findUnique.mockResolvedValueOnce(NOVEDAD).mockResolvedValueOnce(novedad);
      return (await service.quitarAdjunto(1, 42, SUPERVISOR)) as any;
    }

    it('avisa cuando el certificado llegó DESPUÉS de que HyS resolvió', async () => {
      const r = await detalleDe(
        resuelta([{ subidoEn: new Date('2026-09-09T17:03:00Z') }], new Date('2026-09-05T10:00:00Z')),
      );
      expect(r.certificadoPosteriorAResolucion).toBe(true);
    });

    it('no avisa cuando el certificado ya estaba al resolver', async () => {
      const r = await detalleDe(
        resuelta([{ subidoEn: new Date('2026-09-02T08:15:00Z') }], new Date('2026-09-05T10:00:00Z')),
      );
      expect(r.certificadoPosteriorAResolucion).toBe(false);
    });

    /** Se apaga solo: al resolver de nuevo, aprobadoHysEn pasa a ser posterior. */
    it('se apaga cuando HyS vuelve a resolver', async () => {
      const r = await detalleDe(
        resuelta([{ subidoEn: new Date('2026-09-09T17:03:00Z') }], new Date('2026-09-10T09:00:00Z')),
      );
      expect(r.certificadoPosteriorAResolucion).toBe(false);
    });

    it('nunca avisa si la novedad todavía no fue resuelta', async () => {
      const r = await detalleDe(resuelta([{ subidoEn: new Date('2026-09-09T17:03:00Z') }], null));
      expect(r.certificadoPosteriorAResolucion).toBe(false);
    });

    it('sin certificados no avisa', async () => {
      const r = await detalleDe(resuelta([], new Date('2026-09-05T10:00:00Z')));
      expect(r.certificadoPosteriorAResolucion).toBe(false);
    });
  });
});
