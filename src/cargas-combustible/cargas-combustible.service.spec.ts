import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { CargasCombustibleService } from './cargas-combustible.service';
import { PrismaService } from '../prisma/prisma.service';
import { TICKET_STORAGE } from './storage/ticket-storage.interface';

const dtoBase = {
  fechaCarga: '2026-07-30', movilId: 1, litros: 40.5, monto: 52000, km: 123456,
  medioPago: 'caja' as const, nroComprobante: 'FC 0001-00001234',
  estacionId: 1, tipoCombustibleId: 2, provinciaId: 1, tareaIds: [10, 20],
};
const foto = { buffer: Buffer.from('img'), mimetype: 'image/jpeg' as const };

describe('CargasCombustibleService', () => {
  const prismaMock: any = {
    tareaCatalogo: { findMany: jest.fn() },
    contratoHabilitado: { findMany: jest.fn() },
    cargaCombustible: { create: jest.fn(), findFirst: jest.fn() },
    auditoria: { create: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(prismaMock)),
  };
  const storageMock = { guardar: jest.fn().mockResolvedValue('2026/07/uuid.jpg'), leer: jest.fn(), borrar: jest.fn() };
  let service: CargasCombustibleService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        CargasCombustibleService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TICKET_STORAGE, useValue: storageMock },
      ],
    }).compile();
    service = mod.get(CargasCombustibleService);
  });

  it('crea la carga con foto, tareas y auditoría', async () => {
    prismaMock.tareaCatalogo.findMany.mockResolvedValue([{ id: 10, contratoId: 5 }, { id: 20, contratoId: 7 }]);
    prismaMock.contratoHabilitado.findMany.mockResolvedValue([{ contratoId: 5 }, { contratoId: 7 }]);
    prismaMock.cargaCombustible.create.mockResolvedValue({ id: 99 });
    const r = await service.crear(dtoBase, foto, '20-11111111-1');
    expect(storageMock.guardar).toHaveBeenCalledWith(foto.buffer, 'image/jpeg');
    expect(prismaMock.cargaCombustible.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        cargadoPorCuil: '20-11111111-1', fotoPath: '2026/07/uuid.jpg',
        tareas: { createMany: { data: [{ tareaId: 10 }, { tareaId: 20 }] } },
      }),
    }));
    expect(prismaMock.auditoria.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tabla: 'sth_cargas_combustible', registroId: 99, accion: 'crear' }),
    }));
    expect(r.id).toBe(99);
  });

  it('rechaza tareas de contratos no habilitados', async () => {
    prismaMock.tareaCatalogo.findMany.mockResolvedValue([{ id: 10, contratoId: 5 }, { id: 20, contratoId: 7 }]);
    prismaMock.contratoHabilitado.findMany.mockResolvedValue([{ contratoId: 5 }]); // el 7 no está habilitado
    await expect(service.crear(dtoBase, foto, '20-11111111-1')).rejects.toThrow(ForbiddenException);
    expect(storageMock.guardar).not.toHaveBeenCalled();
  });

  it('ultimoKm devuelve el km de la última carga activa del móvil', async () => {
    prismaMock.cargaCombustible.findFirst.mockResolvedValue({ km: 120000, fechaCarga: new Date('2026-07-20') });
    const r = await service.ultimoKm(1);
    expect(prismaMock.cargaCombustible.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { movilId: 1, estado: 'activa' },
      orderBy: [{ fechaCarga: 'desc' }, { id: 'desc' }],
    }));
    expect(r.km).toBe(120000);
  });

  it('ultimoKm devuelve null si el móvil no tiene cargas', async () => {
    prismaMock.cargaCombustible.findFirst.mockResolvedValue(null);
    expect(await service.ultimoKm(1)).toEqual({ km: null, fechaCarga: null });
  });
});
