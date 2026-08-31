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

describe('AccesosService.upsert', () => {
  const prisma = {
    certificacionAcceso: { upsert: jest.fn() },
    certificacionContratoHabilitado: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const service = new AccesosService(prisma);

  it('ejecuta $transaction con upsert del acceso + deleteMany + createMany de los K', async () => {
    await service.upsert('20-1', { nivel: 'carga', verIncidencia: true, contratoIds: [6, 11] });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const operaciones = prisma.$transaction.mock.calls[0][0];
    expect(operaciones).toHaveLength(3);

    expect(prisma.certificacionAcceso.upsert).toHaveBeenCalledWith({
      where: { cuil: '20-1' },
      update: { nivel: 'carga', verIncidencia: true },
      create: { cuil: '20-1', nivel: 'carga', verIncidencia: true },
    });
    expect(prisma.certificacionContratoHabilitado.deleteMany).toHaveBeenCalledWith({
      where: { cuil: '20-1' },
    });
    expect(prisma.certificacionContratoHabilitado.createMany).toHaveBeenCalledWith({
      data: [
        { cuil: '20-1', contratoId: 6 },
        { cuil: '20-1', contratoId: 11 },
      ],
    });
  });
});

describe('AccesosService.eliminar', () => {
  const prisma = {
    certificacionAcceso: { delete: jest.fn() },
    certificacionContratoHabilitado: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const service = new AccesosService(prisma);

  it('ejecuta $transaction con deleteMany de contratos y luego delete del acceso, en ese orden', async () => {
    await service.eliminar('20-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const operaciones = prisma.$transaction.mock.calls[0][0];
    expect(operaciones).toHaveLength(2);

    expect(prisma.certificacionContratoHabilitado.deleteMany).toHaveBeenCalledWith({
      where: { cuil: '20-1' },
    });
    expect(prisma.certificacionAcceso.delete).toHaveBeenCalledWith({
      where: { cuil: '20-1' },
    });

    const ordenDeleteMany = prisma.certificacionContratoHabilitado.deleteMany.mock.invocationCallOrder[0];
    const ordenDelete = prisma.certificacionAcceso.delete.mock.invocationCallOrder[0];
    expect(ordenDeleteMany).toBeLessThan(ordenDelete);
  });
});

describe('AccesosService.listar', () => {
  const prisma = {
    certificacionAcceso: { findMany: jest.fn() },
  } as any;
  const service = new AccesosService(prisma);

  it('lista los accesos incluyendo el email del usuario', () => {
    prisma.certificacionAcceso.findMany.mockReturnValue([]);

    service.listar();

    expect(prisma.certificacionAcceso.findMany).toHaveBeenCalledWith({
      include: { usuario: { select: { email: true } } },
    });
  });
});
