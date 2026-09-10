import { Test } from '@nestjs/testing';
import { NovedadesService } from './novedades.service';
import { PrismaService } from '../prisma/prisma.service';
import { CalculoService } from '../liquidacion/calculo.service';
import { NOVEDAD_ADJUNTO_STORAGE } from './storage/novedad-adjunto-storage.interface';

/**
 * Alcance del adjunto (revisión 2026-08-19): el certificado médico es dato
 * sensible y los ids son secuenciales; el JefeCuadrilla solo puede ver los
 * adjuntos de las novedades que él mismo cargó — mismo criterio que findAll.
 */
describe('NovedadesService#obtenerAdjunto — alcance', () => {
  const prismaMock: any = {
    novedad: { findUnique: jest.fn() },
    novedadAdjunto: { findFirst: jest.fn() },
  };
  const adjuntoStorageMock = { guardar: jest.fn(), leer: jest.fn(), borrar: jest.fn() };
  let service: NovedadesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    adjuntoStorageMock.leer.mockResolvedValue({ buffer: Buffer.from('pdf'), mimetype: 'application/pdf' });
    prismaMock.novedadAdjunto.findFirst.mockResolvedValue({ path: '2026/09/x.pdf' });
    const mod = await Test.createTestingModule({
      providers: [
        NovedadesService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CalculoService, useValue: {} },
        { provide: NOVEDAD_ADJUNTO_STORAGE, useValue: adjuntoStorageMock },
      ],
    }).compile();
    service = mod.get(NovedadesService);
  });

  it('JefeCuadrilla NO puede ver el adjunto de una novedad que no cargó', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({ cargadoPorCuil: '20999999999' });
    await expect(
      service.obtenerAdjunto(1, 7, { cuil: '20111111111', rol: 'JefeCuadrilla' }),
    ).rejects.toThrow('No podés acceder a los certificados de una novedad que no cargaste');
    expect(adjuntoStorageMock.leer).not.toHaveBeenCalled();
  });

  it('JefeCuadrilla SÍ puede ver el adjunto de la novedad que cargó él', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({ cargadoPorCuil: '20111111111' });
    const r = await service.obtenerAdjunto(1, 7, { cuil: '20111111111', rol: 'JefeCuadrilla' });
    expect(r.mimetype).toBe('application/pdf');
  });

  it('HyS ve cualquier adjunto (resolver ausencias es su trabajo)', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({ cargadoPorCuil: '20999999999' });
    const r = await service.obtenerAdjunto(1, 7, { cuil: '20111111111', rol: 'HyS' });
    expect(r.mimetype).toBe('application/pdf');
  });

  /**
   * El id del adjunto viaja en la URL y también es secuencial: sin filtrar
   * por novedadId, alcanzaba con abrir una novedad propia y pedir el id de
   * un certificado ajeno para leerlo.
   */
  it('un adjunto de OTRA novedad no se puede leer desde esta', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({ cargadoPorCuil: '20111111111' });
    prismaMock.novedadAdjunto.findFirst.mockResolvedValue(null);

    await expect(
      service.obtenerAdjunto(1, 999, { cuil: '20111111111', rol: 'Supervisor' }),
    ).rejects.toThrow('Certificado no encontrado');

    expect(prismaMock.novedadAdjunto.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 999, novedadId: 1, eliminadoEn: null } }),
    );
    expect(adjuntoStorageMock.leer).not.toHaveBeenCalled();
  });

  it('un adjunto ya dado de baja no se puede leer', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({ cargadoPorCuil: '20111111111' });
    prismaMock.novedadAdjunto.findFirst.mockResolvedValue(null);

    await expect(
      service.obtenerAdjunto(1, 7, { cuil: '20111111111', rol: 'Supervisor' }),
    ).rejects.toThrow('Certificado no encontrado');
  });
});
