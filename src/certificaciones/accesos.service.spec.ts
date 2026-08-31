import { AccesosService } from './accesos.service';

describe('AccesosService.obtenerAcceso', () => {
  const prisma = {
    certificacionAcceso: { findUnique: jest.fn() },
    certificacionContratoHabilitado: { findMany: jest.fn() },
  } as any;
  const service = new AccesosService(prisma);

  it('sin fila de acceso devuelve null', async () => {
    prisma.certificacionAcceso.findUnique.mockResolvedValue(null);
    expect(await service.obtenerAcceso('20-11111111-1')).toBeNull();
  });

  it('nivel carga devuelve los K habilitados y el flag', async () => {
    prisma.certificacionAcceso.findUnique.mockResolvedValue({
      cuil: '20-1', nivel: 'carga', verIncidencia: true,
    });
    prisma.certificacionContratoHabilitado.findMany.mockResolvedValue([
      { contrato: { codigo: 'K6' } }, { contrato: { codigo: 'K11' } },
    ]);
    expect(await service.obtenerAcceso('20-1')).toEqual({
      nivel: 'carga', ks: ['K6', 'K11'], inc: true,
    });
  });

  it('admin y lectura devuelven ks vacio (ven todo, no se enumera)', async () => {
    prisma.certificacionAcceso.findUnique.mockResolvedValue({
      cuil: '20-1', nivel: 'lectura', verIncidencia: false,
    });
    expect(await service.obtenerAcceso('20-1')).toEqual({
      nivel: 'lectura', ks: [], inc: false,
    });
  });
});
