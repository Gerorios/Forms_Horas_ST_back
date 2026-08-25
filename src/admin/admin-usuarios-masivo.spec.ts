import { Test } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminService.createUsuariosMasivo — perf (prefetch en vez de N+1)', () => {
  const prismaMock: any = {
    rol: { findUnique: jest.fn() },
    usuario: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    snuempleados: { findMany: jest.fn() },
  };
  let service: AdminService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [AdminService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(AdminService);

    prismaMock.rol.findUnique.mockResolvedValue({ id: 1, nombre: 'Operario' });
    // Sin colisión de email en ninguno de los tests.
    prismaMock.usuario.findUnique.mockResolvedValue(null);
    prismaMock.usuario.create.mockImplementation((args: any) => Promise.resolve({ cuil: args.data.cuil }));
  });

  it('consulta usuario/empleado existentes con UN findMany c/u (no un findUnique por cuil)', async () => {
    prismaMock.usuario.findMany.mockResolvedValue([{ cuil: '20-1-1' }]); // ya tiene usuario
    prismaMock.snuempleados.findMany.mockResolvedValue([
      { cuil: '20-2-2', legajo: 5, apellido_nombre: 'PEREZ JUAN', activo: 'S', borrado: 'N' },
      { cuil: '20-3-3', legajo: 6, apellido_nombre: 'GOMEZ ANA', activo: 'S', borrado: 'N' },
    ]);

    const r = await service.createUsuariosMasivo(['20-1-1', '20-2-2', '20-3-3']);

    expect(prismaMock.usuario.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.snuempleados.findMany).toHaveBeenCalledTimes(1);
    expect(r.omitidos).toEqual([{ cuil: '20-1-1', motivo: 'ya tiene usuario' }]);
    expect(r.creados.map((c) => c.cuil).sort()).toEqual(['20-2-2', '20-3-3']);
    expect(prismaMock.usuario.create).toHaveBeenCalledTimes(2);
  });

  it('empleado inexistente o inactivo se omite con el motivo correcto', async () => {
    prismaMock.usuario.findMany.mockResolvedValue([]);
    prismaMock.snuempleados.findMany.mockResolvedValue([
      { cuil: '20-2-2', legajo: 5, apellido_nombre: 'PEREZ JUAN', activo: 'N', borrado: 'N' },
    ]);

    const r = await service.createUsuariosMasivo(['20-1-1', '20-2-2']);

    expect(r.omitidos).toEqual(
      expect.arrayContaining([
        { cuil: '20-1-1', motivo: 'empleado inexistente o inactivo' },
        { cuil: '20-2-2', motivo: 'empleado inexistente o inactivo' },
      ]),
    );
    expect(r.creados).toEqual([]);
    expect(prismaMock.usuario.create).not.toHaveBeenCalled();
  });
});
