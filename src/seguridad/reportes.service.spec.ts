import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ReportesService, SEG_FOTO_STORAGE } from './reportes.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Reportes de Seguridad (ADR-027). Lo que más importa: los movimientos de
 * puntos se escriben SOLO al calificar/reabrir y dentro de la misma
 * transacción, el autor solo toca lo suyo mientras está pendiente, y nadie
 * califica lo propio.
 */
describe('ReportesService', () => {
  const prismaMock: any = {
    segReporte: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    segReporteInvolucrado: { createMany: jest.fn(), deleteMany: jest.fn() },
    segReporteFoto: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn() },
    segInspector: { findUnique: jest.fn() },
    segMovimientoPuntos: { deleteMany: jest.fn(), createMany: jest.fn() },
    segNaturaleza: { findUnique: jest.fn() },
    segMotivoParalizacion: { findUnique: jest.fn() },
    provincia: { findUnique: jest.fn() },
    tareaCatalogo: { findUnique: jest.fn() },
    snuempleados: { findMany: jest.fn() },
    usuario: { findMany: jest.fn() },
    auditoria: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const storage = { guardar: jest.fn(), leer: jest.fn(), borrar: jest.fn() };
  let service: ReportesService;

  const OPERARIO = { cuil: '20111111111', rol: 'Operario' };
  const HYS1 = { cuil: '27222222222', rol: 'HyS' };
  const HYS2 = { cuil: '27333333333', rol: 'HyS' };

  /** Reporte tal como lo devuelve `cargar` (con INCLUDE_REPORTE). */
  const reporte = (extra: any = {}) => ({
    id: 7,
    tipo: 'aviso_riesgo',
    estado: 'pendiente',
    autorCuil: OPERARIO.cuil,
    fechaReporte: new Date('2026-10-06T00:00:00Z'),
    createdAt: new Date('2026-10-07T11:42:00Z'),
    provinciaId: 1,
    contratoId: 2,
    tareaId: 3,
    ubicacion: null,
    latitud: null,
    longitud: null,
    errorMetros: null,
    origenPunto: null,
    descripcion: 'Zanja sin vallar',
    naturalezaId: 4,
    motivoParalizacionId: null,
    controlRiesgo: 'Vallé con cinta y conos',
    puntaje: null,
    comentarioHys: null,
    calificadoPorCuil: null,
    calificadoEn: null,
    motivoAnulacion: null,
    provincia: { id: 1, nombre: 'Salta' },
    contrato: { id: 2, codigo: 'K2', nombre: 'Operaciones Domiciliarias' },
    tarea: { id: 3, nombre: 'Conexión' },
    naturaleza: { id: 4, nombre: 'Condición peligrosa' },
    motivoParalizacion: null,
    involucrados: [],
    fotos: [],
    ...extra,
  });

  const DTO = {
    tipo: 'aviso_riesgo' as const,
    fechaReporte: '2026-10-06',
    provinciaId: 1,
    contratoId: 2,
    tareaId: 3,
    descripcion: 'Zanja sin vallar',
    naturalezaId: 4,
    controlRiesgo: 'Vallé con cinta y conos',
  };

  beforeEach(async () => {
    // reset (no clear): un mockResolvedValueOnce sin consumir no debe pasar
    // al test siguiente.
    jest.resetAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.snuempleados.findMany.mockResolvedValue([]);
    prismaMock.usuario.findMany.mockResolvedValue([]);
    prismaMock.provincia.findUnique.mockResolvedValue({ id: 1 });
    prismaMock.tareaCatalogo.findUnique.mockResolvedValue({ contratoId: 2, activo: true, contrato: { activo: true } });
    prismaMock.segNaturaleza.findUnique.mockResolvedValue({ activo: true });
    prismaMock.segReporte.create.mockResolvedValue({ id: 7, tipo: 'aviso_riesgo' });
    prismaMock.segReporte.update.mockImplementation(async ({ data }: any) => ({ ...reporte(), ...data }));
    prismaMock.segInspector.findUnique.mockResolvedValue(null);
    storage.guardar.mockResolvedValue('2026/10/foto.jpg');

    const mod = await Test.createTestingModule({
      providers: [
        ReportesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: SEG_FOTO_STORAGE, useValue: storage },
      ],
    }).compile();
    service = mod.get(ReportesService);
  });

  /** Primera lectura (`cargar`) y la relectura final de `detalle`. */
  function conReporte(r: any, final: any = r) {
    prismaMock.segReporte.findUnique.mockResolvedValueOnce(r).mockResolvedValueOnce(final);
  }

  // ------------------------------------------------------------------ alta

  describe('crear', () => {
    it('cualquier rol crea un reporte, a su nombre y pendiente', async () => {
      prismaMock.segReporte.findUnique.mockResolvedValueOnce(reporte());
      await service.crear(DTO, OPERARIO);
      expect(prismaMock.segReporte.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ autorCuil: OPERARIO.cuil, tipo: 'aviso_riesgo', controlRiesgo: 'Vallé con cinta y conos' }),
      });
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tabla: 'sth_seg_reportes', accion: 'crear' }),
      });
    });

    it('un operario no habilitado no carga inspecciones', async () => {
      const dto = { ...DTO, tipo: 'inspeccion' as const, involucrados: ['20444444444'] };
      await expect(service.crear(dto, OPERARIO)).rejects.toThrow(ForbiddenException);
      expect(prismaMock.segReporte.create).not.toHaveBeenCalled();
    });

    it('un supervisor habilitado como inspector sí', async () => {
      prismaMock.segInspector.findUnique.mockResolvedValue({ cuil: '20666666666' });
      prismaMock.snuempleados.findMany.mockResolvedValueOnce([{ cuil: '20444444444' }]);
      prismaMock.segReporte.findUnique.mockResolvedValueOnce(reporte({ tipo: 'inspeccion', autorCuil: '20666666666' }));
      const dto = { ...DTO, tipo: 'inspeccion' as const, involucrados: ['20444444444'] };
      await service.crear(dto, { cuil: '20666666666', rol: 'Supervisor' });
      expect(prismaMock.segReporte.create).toHaveBeenCalled();
    });

    it('la paralización sin punto GPS no se envía; con punto, se guarda', async () => {
      const paral = { ...DTO, tipo: 'paralizacion' as const, naturalezaId: undefined, motivoParalizacionId: 3 };
      prismaMock.segMotivoParalizacion.findUnique.mockResolvedValue({ activo: true });
      await expect(service.crear(paral, OPERARIO)).rejects.toThrow('Falta tomar la ubicación');
      prismaMock.segReporte.findUnique.mockResolvedValueOnce(reporte({ tipo: 'paralizacion' }));
      await service.crear({ ...paral, latitud: -24.78, longitud: -65.41, errorMetros: 9.6 }, OPERARIO);
      expect(prismaMock.segReporte.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ latitud: -24.78, longitud: -65.41, errorMetros: 10, origenPunto: 'gps' }),
      });
    });

    it('quien carga más tarde marca el punto en el mapa: vale para la paralización y no lleva error', async () => {
      const paral = { ...DTO, tipo: 'paralizacion' as const, naturalezaId: undefined, motivoParalizacionId: 3 };
      prismaMock.segMotivoParalizacion.findUnique.mockResolvedValue({ activo: true });
      prismaMock.segReporte.findUnique.mockResolvedValueOnce(reporte({ tipo: 'paralizacion' }));
      await service.crear({ ...paral, latitud: -24.78, longitud: -65.41, errorMetros: 40, origenPunto: 'mapa' }, OPERARIO);
      expect(prismaMock.segReporte.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ latitud: -24.78, longitud: -65.41, errorMetros: null, origenPunto: 'mapa' }),
      });
    });

    it('sin punto, el origen queda vacío aunque venga en el pedido', async () => {
      prismaMock.segReporte.findUnique.mockResolvedValueOnce(reporte());
      await service.crear({ ...DTO, origenPunto: 'mapa' }, OPERARIO);
      expect(prismaMock.segReporte.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ latitud: null, origenPunto: null }),
      });
    });

    it('rechaza los campos que no corresponden al tipo', async () => {
      await expect(service.crear({ ...DTO, naturalezaId: undefined }, OPERARIO)).rejects.toThrow('Falta la naturaleza del riesgo');
    });

    it('rechaza una fecha futura', async () => {
      await expect(service.crear({ ...DTO, fechaReporte: '2999-01-01' }, OPERARIO)).rejects.toThrow('no puede ser futura');
    });

    it('rechaza una tarea de otro contrato', async () => {
      prismaMock.tareaCatalogo.findUnique.mockResolvedValue({ contratoId: 99, activo: true, contrato: { activo: true } });
      await expect(service.crear(DTO, OPERARIO)).rejects.toThrow('La tarea no pertenece a ese contrato');
    });

    it('rechaza involucrados que no están en la nómina', async () => {
      prismaMock.snuempleados.findMany.mockResolvedValueOnce([]);
      await expect(service.crear({ ...DTO, involucrados: ['20999999999'] }, OPERARIO)).rejects.toThrow('no está en la nómina');
    });
  });

  // ----------------------------------------------------- edición del autor

  describe('editar / anular', () => {
    it('otro usuario no puede editar el reporte', async () => {
      conReporte(reporte());
      await expect(service.editar(7, DTO, { cuil: '20555555555', rol: 'Operario' })).rejects.toThrow(ForbiddenException);
    });

    it('calificado, queda fijo para el autor', async () => {
      conReporte(reporte({ estado: 'aprobado', puntaje: 8 }));
      await expect(service.editar(7, DTO, OPERARIO)).rejects.toThrow(BadRequestException);
    });

    it('el autor no mueve el pin del mapa una vez enviado: eso lo corrige HyS', async () => {
      const guardado = reporte({ latitud: '-24.780000', longitud: '-65.410000', origenPunto: 'mapa' });
      conReporte(guardado);
      await expect(
        service.editar(7, { ...DTO, latitud: -24.9, longitud: -65.41, origenPunto: 'mapa' }, OPERARIO),
      ).rejects.toThrow('solo lo corrige HyS');
      expect(prismaMock.segReporte.update).not.toHaveBeenCalled();
    });

    it('editar sin tocar el punto del mapa, o retomarlo con GPS, sí se puede', async () => {
      const guardado = reporte({ latitud: '-24.780000', longitud: '-65.410000', origenPunto: 'mapa' });
      conReporte(guardado);
      await service.editar(7, { ...DTO, latitud: -24.78, longitud: -65.41, origenPunto: 'mapa' }, OPERARIO);
      conReporte(guardado);
      await service.editar(7, { ...DTO, latitud: -24.9, longitud: -65.4, errorMetros: 8, origenPunto: 'gps' }, OPERARIO);
      expect(prismaMock.segReporte.update).toHaveBeenCalledTimes(2);
    });

    it('anular deja el reporte guardado con su motivo', async () => {
      conReporte(reporte(), reporte({ estado: 'anulado' }));
      await service.anular(7, 'Lo mandé dos veces', OPERARIO);
      expect(prismaMock.segReporte.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: expect.objectContaining({ estado: 'anulado', motivoAnulacion: 'Lo mandé dos veces' }),
      });
      expect(prismaMock.segMovimientoPuntos.createMany).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------ fotos

  describe('agregarFoto', () => {
    const JPG = { buffer: Buffer.from('jpg'), mimetype: 'image/jpeg' as const };

    it('guarda la ubicación de una foto de cámara', async () => {
      conReporte(reporte());
      prismaMock.segReporteFoto.create.mockResolvedValue({ id: 1 });
      await service.agregarFoto(7, JPG, { grupo: 'riesgo', origen: 'camara', latitud: -24.78, longitud: -65.41, errorMetros: 8 }, OPERARIO);
      expect(prismaMock.segReporteFoto.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ origen: 'camara', latitud: -24.78, longitud: -65.41, errorMetros: 8 }),
      });
    });

    it('una foto de galería no lleva ubicación', async () => {
      conReporte(reporte());
      await expect(
        service.agregarFoto(7, JPG, { grupo: 'riesgo', origen: 'galeria', latitud: -24.78, longitud: -65.41 }, OPERARIO),
      ).rejects.toThrow('Solo una foto sacada con la cámara lleva ubicación');
      expect(storage.guardar).not.toHaveBeenCalled();
    });

    it('tope de 3 fotos por grupo', async () => {
      const fotos = [1, 2, 3].map((id) => ({ id, grupo: 'riesgo', origen: 'galeria', latitud: null, longitud: null, errorMetros: null, subidoEn: new Date() }));
      conReporte(reporte({ fotos }));
      await expect(service.agregarFoto(7, JPG, { grupo: 'riesgo', origen: 'galeria' }, OPERARIO)).rejects.toThrow('Ya hay 3 fotos');
    });

    it('una propuesta de mejora no lleva fotos del control', async () => {
      conReporte(reporte({ tipo: 'propuesta_mejora' }));
      await expect(service.agregarFoto(7, JPG, { grupo: 'control', origen: 'galeria' }, OPERARIO)).rejects.toThrow(
        'no lleva fotos del control',
      );
    });
  });

  // ------------------------------------------------------- calificar/reabrir

  describe('calificar', () => {
    it('aprobar suma el puntaje al autor, en la misma transacción', async () => {
      conReporte(reporte(), reporte({ estado: 'aprobado', puntaje: 8 }));
      await service.calificar(7, { decision: 'aprobar', puntaje: 8 }, HYS1);

      expect(prismaMock.segReporte.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: expect.objectContaining({ estado: 'aprobado', puntaje: 8, calificadoPorCuil: HYS1.cuil }),
      });
      expect(prismaMock.segMovimientoPuntos.deleteMany).toHaveBeenCalledWith({ where: { reporteId: 7 } });
      expect(prismaMock.segMovimientoPuntos.createMany).toHaveBeenCalledWith({
        data: [{ reporteId: 7, cuil: OPERARIO.cuil, fecha: new Date('2026-10-06T00:00:00Z'), puntos: 8 }],
      });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it('desaprobar vale 0: borra los movimientos y no crea ninguno', async () => {
      conReporte(reporte({ estado: 'aprobado', puntaje: 8 }), reporte({ estado: 'desaprobado' }));
      await service.calificar(7, { decision: 'desaprobar', comentario: 'Solo avisaste, no gestionaste' }, HYS1);
      expect(prismaMock.segReporte.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: expect.objectContaining({ estado: 'desaprobado', puntaje: null, comentarioHys: 'Solo avisaste, no gestionaste' }),
      });
      expect(prismaMock.segMovimientoPuntos.deleteMany).toHaveBeenCalled();
      expect(prismaMock.segMovimientoPuntos.createMany).not.toHaveBeenCalled();
    });

    it('una inspección aprobada resta a cada involucrado', async () => {
      const insp = reporte({
        tipo: 'inspeccion',
        autorCuil: HYS1.cuil,
        involucrados: [{ cuil: '20444444444' }, { cuil: '20555555555' }],
      });
      conReporte(insp, { ...insp, estado: 'aprobado', puntaje: 6 });
      // La autora la aprueba: ella no suma nada, así que no hay conflicto.
      await service.calificar(7, { decision: 'aprobar', puntaje: 6 }, HYS1);
      expect(prismaMock.segMovimientoPuntos.createMany).toHaveBeenCalledWith({
        data: [
          { reporteId: 7, cuil: '20444444444', fecha: insp.fechaReporte, puntos: -6 },
          { reporteId: 7, cuil: '20555555555', fecha: insp.fechaReporte, puntos: -6 },
        ],
      });
    });

    it('HyS no califica su propio reporte (que no sea inspección)', async () => {
      conReporte(reporte({ autorCuil: HYS1.cuil }));
      await expect(service.calificar(7, { decision: 'aprobar', puntaje: 9 }, HYS1)).rejects.toThrow(
        'No podés calificar tu propio reporte',
      );
      expect(prismaMock.segMovimientoPuntos.createMany).not.toHaveBeenCalled();
    });

    it('la otra persona de HyS sí puede', async () => {
      conReporte(reporte({ autorCuil: HYS1.cuil }), reporte({ autorCuil: HYS1.cuil, estado: 'aprobado', puntaje: 9 }));
      await service.calificar(7, { decision: 'aprobar', puntaje: 9 }, HYS2);
      expect(prismaMock.segMovimientoPuntos.createMany).toHaveBeenCalled();
    });

    it('un anulado no se califica', async () => {
      conReporte(reporte({ estado: 'anulado' }));
      await expect(service.calificar(7, { decision: 'aprobar', puntaje: 5 }, HYS1)).rejects.toThrow('anulado');
    });
  });

  describe('corregir (HyS)', () => {
    it('reclasifica un aviso como propuesta: descarta control y fotos del control', async () => {
      const aviso = reporte({
        fotos: [{ id: 1, grupo: 'control', origen: 'galeria', latitud: null, longitud: null, errorMetros: null, subidoEn: new Date() }],
      });
      conReporte(aviso, reporte({ tipo: 'propuesta_mejora' }));
      const dto = { ...DTO, tipo: 'propuesta_mejora' as const, naturalezaId: undefined, controlRiesgo: undefined };
      await service.corregir(7, dto, HYS1);
      expect(prismaMock.segReporte.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: expect.objectContaining({ tipo: 'propuesta_mejora', controlRiesgo: null, naturalezaId: null }),
      });
      expect(prismaMock.segReporteFoto.updateMany).toHaveBeenCalledWith({
        where: { reporteId: 7, grupo: 'control', eliminadoEn: null },
        data: expect.objectContaining({ eliminadoPorCuil: HYS1.cuil }),
      });
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ accion: 'editar', campo: 'correccion_hys' }),
      });
    });

    it('si estaba aprobado, recalcula los puntos en la misma transacción', async () => {
      conReporte(reporte({ estado: 'aprobado', puntaje: 8 }), reporte({ tipo: 'inspeccion', estado: 'aprobado', puntaje: 8 }));
      prismaMock.snuempleados.findMany.mockResolvedValueOnce([{ cuil: '20444444444' }]);
      // HyS lo pasa a inspección: el autor deja de sumar 8 y el observado pierde 8.
      await service.corregir(7, { ...DTO, tipo: 'inspeccion', involucrados: ['20444444444'] }, HYS1);
      expect(prismaMock.segMovimientoPuntos.deleteMany).toHaveBeenCalledWith({ where: { reporteId: 7 } });
      expect(prismaMock.segMovimientoPuntos.createMany).toHaveBeenCalledWith({
        data: [{ reporteId: 7, cuil: '20444444444', fecha: new Date('2026-10-06T00:00:00Z'), puntos: -8 }],
      });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    });

    it('un pendiente corregido no toca movimientos', async () => {
      conReporte(reporte());
      await service.corregir(7, DTO, HYS1);
      expect(prismaMock.segMovimientoPuntos.deleteMany).not.toHaveBeenCalled();
    });

    it('HyS corrige el punto en el mapa y la auditoría guarda el antes y el después', async () => {
      conReporte(reporte({ latitud: '-24.780000', longitud: '-65.410000', errorMetros: 12, origenPunto: 'gps' }));
      await service.corregir(7, { ...DTO, latitud: -24.8, longitud: -65.42, origenPunto: 'mapa' }, HYS1);
      expect(prismaMock.segReporte.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: expect.objectContaining({ latitud: -24.8, longitud: -65.42, errorMetros: null, origenPunto: 'mapa' }),
      });
      const aud = prismaMock.auditoria.create.mock.calls[0][0].data;
      expect(JSON.parse(aud.valorAnterior).punto).toEqual([-24.78, -65.41, 12, 'gps']);
      expect(JSON.parse(aud.valorNuevo).punto).toEqual([-24.8, -65.42, null, 'mapa']);
    });

    it('un anulado no se corrige', async () => {
      conReporte(reporte({ estado: 'anulado' }));
      await expect(service.corregir(7, DTO, HYS1)).rejects.toThrow('anulado');
    });
  });

  describe('reabrir', () => {
    it('vuelve a pendiente y borra los movimientos', async () => {
      conReporte(reporte({ estado: 'aprobado', puntaje: 8 }), reporte());
      await service.reabrir(7, HYS1);
      expect(prismaMock.segReporte.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { estado: 'pendiente', puntaje: null, comentarioHys: null, calificadoPorCuil: null, calificadoEn: null },
      });
      expect(prismaMock.segMovimientoPuntos.deleteMany).toHaveBeenCalledWith({ where: { reporteId: 7 } });
    });

    it('un pendiente no se reabre', async () => {
      conReporte(reporte());
      await expect(service.reabrir(7, HYS1)).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------- presentación

  describe('detalle', () => {
    it('el autor no ve quién de HyS lo calificó; HyS sí', async () => {
      const calificado = reporte({ estado: 'aprobado', puntaje: 8, calificadoPorCuil: HYS1.cuil });
      prismaMock.segReporte.findUnique.mockResolvedValueOnce(calificado);
      expect((await service.detalle(7, OPERARIO)).calificadoPor).toBeNull();
      prismaMock.segReporte.findUnique.mockResolvedValueOnce(calificado);
      expect((await service.detalle(7, HYS2)).calificadoPor).toEqual({ cuil: HYS1.cuil, nombre: '' });
    });

    it('nadie más que el autor, HyS y Admin lo ve', async () => {
      prismaMock.segReporte.findUnique.mockResolvedValueOnce(reporte());
      await expect(service.detalle(7, { cuil: '20444444444', rol: 'JefeCuadrilla' })).rejects.toThrow(ForbiddenException);
    });

    it('solo una paralización pendiente es alarma', async () => {
      prismaMock.segReporte.findUnique.mockResolvedValueOnce(reporte({ tipo: 'paralizacion' }));
      expect((await service.detalle(7, HYS1)).alarma).toBe(true);
      prismaMock.segReporte.findUnique.mockResolvedValueOnce(reporte({ tipo: 'paralizacion', estado: 'aprobado', puntaje: 7 }));
      expect((await service.detalle(7, HYS1)).alarma).toBe(false);
    });
  });
});
