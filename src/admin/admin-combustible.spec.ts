import { Test } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminService — catálogos de combustible', () => {
  const prismaMock = {
    estacionServicio: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    tipoCombustible: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  } as unknown as PrismaService;
  let service: AdminService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [AdminService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(AdminService);
  });

  it('crea una estación de servicio', async () => {
    (prismaMock.estacionServicio.create as jest.Mock).mockResolvedValue({ id: 1, nombre: 'YPF Centenario', localidad: null, activo: true });
    const r = await service.crearEstacionServicio({ nombre: 'YPF Centenario' });
    expect(prismaMock.estacionServicio.create).toHaveBeenCalledWith({ data: { nombre: 'YPF Centenario', localidad: undefined } });
    expect(r.id).toBe(1);
  });

  it('togglea activo de un tipo de combustible', async () => {
    (prismaMock.tipoCombustible.update as jest.Mock).mockResolvedValue({ id: 2, nombre: 'GNC', activo: false });
    await service.toggleTipoCombustible(2, false);
    expect(prismaMock.tipoCombustible.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { activo: false } });
  });
});
