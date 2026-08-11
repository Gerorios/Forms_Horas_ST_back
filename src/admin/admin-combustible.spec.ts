import { Test } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminService — catálogos de combustible', () => {
  const prismaMock = {
    estacionServicio: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    tipoCombustible: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    tipoCombustibleAlias: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
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

  it('actualizarEstacion guarda cuit y acepta null para borrarlo', async () => {
    (prismaMock.estacionServicio.update as jest.Mock).mockResolvedValue({ id: 1, nombre: 'YPF Centro', localidad: null, cuit: '30123456789', activo: true });
    await service.actualizarEstacionServicio(1, { cuit: '30123456789' });
    expect(prismaMock.estacionServicio.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { cuit: '30123456789' } });

    await service.actualizarEstacionServicio(1, { cuit: null });
    expect(prismaMock.estacionServicio.update).toHaveBeenLastCalledWith({ where: { id: 1 }, data: { cuit: null } });
  });

  it('guardarAlias reemplaza el set completo y descarta vacíos y duplicados', async () => {
    (prismaMock.tipoCombustible.findMany as jest.Mock).mockResolvedValue([
      { id: 5, nombre: 'Gasoil premium', activo: true, aliases: [{ id: 1, tipoCombustibleId: 5, alias: 'INFINIA DIESEL' }, { id: 2, tipoCombustibleId: 5, alias: 'EURO DIESEL' }] },
    ]);
    const r = await service.guardarAliasTipoCombustible(5, ['INFINIA DIESEL', ' EURO DIESEL ', '', 'INFINIA DIESEL']);
    expect(prismaMock.tipoCombustibleAlias.deleteMany).toHaveBeenCalledWith({ where: { tipoCombustibleId: 5 } });
    expect(prismaMock.tipoCombustibleAlias.createMany).toHaveBeenCalledWith({
      data: [
        { tipoCombustibleId: 5, alias: 'INFINIA DIESEL' },
        { tipoCombustibleId: 5, alias: 'EURO DIESEL' },
      ],
    });
    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(r).toEqual([{ id: 5, nombre: 'Gasoil premium', activo: true, aliases: ['EURO DIESEL', 'INFINIA DIESEL'] }]);
  });

  it('guardarAlias con lista vacía borra todos sin crear', async () => {
    (prismaMock.tipoCombustible.findMany as jest.Mock).mockResolvedValue([
      { id: 5, nombre: 'Gasoil premium', activo: true, aliases: [] },
    ]);
    await service.guardarAliasTipoCombustible(5, ['', '   ']);
    expect(prismaMock.tipoCombustibleAlias.deleteMany).toHaveBeenCalledWith({ where: { tipoCombustibleId: 5 } });
    expect(prismaMock.tipoCombustibleAlias.createMany).not.toHaveBeenCalled();
  });

  it('getTiposCombustible devuelve aliases como string[] ordenado', async () => {
    (prismaMock.tipoCombustible.findMany as jest.Mock).mockResolvedValue([
      { id: 2, nombre: 'Gasoil', activo: true, aliases: [{ id: 3, tipoCombustibleId: 2, alias: 'ULTRA DIESEL' }, { id: 4, tipoCombustibleId: 2, alias: 'DIESEL 500' }] },
    ]);
    const r = await service.getTiposCombustible();
    expect(r).toEqual([{ id: 2, nombre: 'Gasoil', activo: true, aliases: ['DIESEL 500', 'ULTRA DIESEL'] }]);
  });

  it('togglea activo de un tipo de combustible', async () => {
    (prismaMock.tipoCombustible.update as jest.Mock).mockResolvedValue({ id: 2, nombre: 'GNC', activo: false });
    await service.toggleTipoCombustible(2, false);
    expect(prismaMock.tipoCombustible.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { activo: false } });
  });
});
