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
  const prismaMock: any = { novedad: { findUnique: jest.fn() } };
  const adjuntoStorageMock = { guardar: jest.fn(), leer: jest.fn(), borrar: jest.fn() };
  let service: NovedadesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    adjuntoStorageMock.leer.mockResolvedValue({ buffer: Buffer.from('pdf'), mimetype: 'application/pdf' });
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
    prismaMock.novedad.findUnique.mockResolvedValue({ adjuntoUrl: 'x.pdf', cargadoPorCuil: '20999999999' });
    await expect(
      service.obtenerAdjunto(1, { cuil: '20111111111', rol: 'JefeCuadrilla' }),
    ).rejects.toThrow('No podés ver el adjunto de una novedad que no cargaste');
    expect(adjuntoStorageMock.leer).not.toHaveBeenCalled();
  });

  it('JefeCuadrilla SÍ puede ver el adjunto de la novedad que cargó él', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({ adjuntoUrl: 'x.pdf', cargadoPorCuil: '20111111111' });
    const r = await service.obtenerAdjunto(1, { cuil: '20111111111', rol: 'JefeCuadrilla' });
    expect(r.mimetype).toBe('application/pdf');
  });

  it('HyS ve cualquier adjunto (resolver ausencias es su trabajo)', async () => {
    prismaMock.novedad.findUnique.mockResolvedValue({ adjuntoUrl: 'x.pdf', cargadoPorCuil: '20999999999' });
    const r = await service.obtenerAdjunto(1, { cuil: '20111111111', rol: 'HyS' });
    expect(r.mimetype).toBe('application/pdf');
  });
});
