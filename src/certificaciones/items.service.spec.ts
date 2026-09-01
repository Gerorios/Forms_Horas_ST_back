import { ForbiddenException } from '@nestjs/common';
import { ItemsService } from './items.service';

const admin = { nivel: 'admin', ks: [], inc: true };

describe('ItemsService.listar', () => {
  const prisma = { $queryRaw: jest.fn() } as any;
  const service = new ItemsService(prisma);
  beforeEach(() => prisma.$queryRaw.mockReset());

  it('sin claim o nivel no-admin tira Forbidden', async () => {
    await expect(service.listar({}, null)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listar({}, { nivel: 'lectura', ks: [], inc: true })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listar({}, { nivel: 'carga', ks: ['K6'], inc: false })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('devuelve el shape del portal con ptos_gasnor como number', async () => {
    prisma.$queryRaw.mockResolvedValue([{
      id_item: 1, item_codigo: '384,1', codigo_k: 'K6', grupo: null, subgrupo: null,
      tarea: 'Reparacion', frecuencia: null, contratista: null,
      ptos_gasnor: '28.0000', unidad_medida: 'un', tipo: 'OPEX', contrato_nombre: null,
    }]);
    const r = await service.listar({}, admin);
    expect(r[0].ptos_gasnor).toBe(28);
    expect(r[0].id_item).toBe(1);
  });

  it('ptos_gasnor null queda null (no 0)', async () => {
    prisma.$queryRaw.mockResolvedValue([{
      id_item: 2, item_codigo: '1', codigo_k: 'K2', grupo: null, subgrupo: null,
      tarea: 'x', frecuencia: null, contratista: null,
      ptos_gasnor: null, unidad_medida: null, tipo: null, contrato_nombre: null,
    }]);
    expect((await service.listar({}, admin))[0].ptos_gasnor).toBeNull();
  });

  it('codigo_k se normaliza a mayúsculas y buscar escapa % y _', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await service.listar({ codigoK: 'k6', buscar: '38%_1' }, admin);
    const sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.values).toContain('K6');
    expect(sql.values.some((v: unknown) => String(v).includes('38\\%\\_1'))).toBe(true);
  });
});

describe('ItemsService.crear', () => {
  const prisma = { $queryRaw: jest.fn(), certItem: { create: jest.fn() }, certContratoErp: { findFirst: jest.fn() } } as any;
  const service = new ItemsService(prisma);
  beforeEach(() => { prisma.$queryRaw.mockReset(); prisma.certItem.create.mockReset(); prisma.certContratoErp.findFirst.mockReset(); });

  it('contrato inexistente → BadRequest con el mensaje del portal', async () => {
    prisma.certContratoErp.findFirst.mockResolvedValue(null);
    await expect(service.crear({ item_codigo: '384.1', codigo_k: 'K7', tarea: 'x' } as any, admin))
      .rejects.toThrow('Contrato K7 no encontrado');
  });

  it('duplicado normalizado punto≡coma → BadRequest', async () => {
    prisma.certContratoErp.findFirst.mockResolvedValue({ id_contrato: 3, codigo_k: 'K6' });
    prisma.$queryRaw.mockResolvedValue([{ id_item: 99 }]); // ya existe "384,1"
    await expect(service.crear({ item_codigo: '384.1', codigo_k: 'K6', tarea: 'x' } as any, admin))
      .rejects.toThrow('El ítem 384.1 ya existe en K6');
    expect(prisma.certItem.create).not.toHaveBeenCalled();
  });

  it('crea con ptos_gasnor 0 (guardable, fix del portal)', async () => {
    prisma.certContratoErp.findFirst.mockResolvedValue({ id_contrato: 3, codigo_k: 'K6' });
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.certItem.create.mockResolvedValue({});
    await service.crear({ item_codigo: '500', codigo_k: 'K6', tarea: 'x', ptos_gasnor: 0 } as any, admin);
    expect(prisma.certItem.create.mock.calls[0][0].data.ptos_gasnor).toBe(0);
  });

  it('nivel no-admin → Forbidden', async () => {
    await expect(service.crear({} as any, { nivel: 'lectura', ks: [], inc: true })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ItemsService.actualizar', () => {
  const prisma = { $queryRaw: jest.fn(), certItem: { findUnique: jest.fn(), update: jest.fn() }, certContratoErp: { findFirst: jest.fn() } } as any;
  const service = new ItemsService(prisma);
  beforeEach(() => { prisma.$queryRaw.mockReset(); prisma.certItem.findUnique.mockReset(); prisma.certItem.update.mockReset(); prisma.certContratoErp.findFirst.mockReset(); });

  it('id inexistente → NotFound', async () => {
    prisma.certItem.findUnique.mockResolvedValue(null);
    await expect(service.actualizar(999, {} as any, admin)).rejects.toThrow('Ítem no encontrado');
  });

  it('null borra el campo; ausente no lo toca (fix del portal)', async () => {
    prisma.certItem.findUnique.mockResolvedValue({ id_item: 1, item_codigo: '384,1', id_contrato: 3 });
    prisma.certItem.update.mockResolvedValue({});
    await service.actualizar(1, { grupo: null, tarea: 'Nueva tarea' } as any, admin);
    const data = prisma.certItem.update.mock.calls[0][0].data;
    expect(data.grupo).toBeNull();
    expect(data.tarea).toBe('Nueva tarea');
    expect('subgrupo' in data).toBe(false); // ausente: no se toca
  });

  it('mover de contrato revalida unicidad normalizada (fix del agujero del portal)', async () => {
    prisma.certItem.findUnique.mockResolvedValue({ id_item: 1, item_codigo: '384,1', id_contrato: 3 });
    prisma.certContratoErp.findFirst.mockResolvedValue({ id_contrato: 5, codigo_k: 'K8' });
    prisma.$queryRaw.mockResolvedValue([{ id_item: 42 }]); // K8 ya tiene "384.1"
    await expect(service.actualizar(1, { codigo_k: 'K8' } as any, admin))
      .rejects.toThrow('El ítem 384,1 ya existe en K8');
    expect(prisma.certItem.update).not.toHaveBeenCalled();
  });

  it('sin campos → {mensaje: "Sin cambios"} sin tocar la BD', async () => {
    prisma.certItem.findUnique.mockResolvedValue({ id_item: 1, item_codigo: '1', id_contrato: 3 });
    expect(await service.actualizar(1, {} as any, admin)).toEqual({ mensaje: 'Sin cambios' });
    expect(prisma.certItem.update).not.toHaveBeenCalled();
  });
});

describe('ItemsService.eliminar', () => {
  const prisma = { $queryRaw: jest.fn(), certItem: { findUnique: jest.fn(), delete: jest.fn() } } as any;
  const service = new ItemsService(prisma);
  beforeEach(() => { prisma.$queryRaw.mockReset(); prisma.certItem.findUnique.mockReset(); prisma.certItem.delete.mockReset(); });

  it('id inexistente → NotFound (el portal devolvía 200 mentiroso)', async () => {
    prisma.certItem.findUnique.mockResolvedValue(null);
    await expect(service.eliminar(999, admin)).rejects.toThrow('Ítem no encontrado');
  });

  it('con certificaciones cargadas → BadRequest con el conteo', async () => {
    prisma.certItem.findUnique.mockResolvedValue({ id_item: 1 });
    prisma.$queryRaw.mockResolvedValue([{ c: 143n }]);
    await expect(service.eliminar(1, admin))
      .rejects.toThrow('No se puede eliminar: el ítem tiene 143 certificaciones cargadas');
    expect(prisma.certItem.delete).not.toHaveBeenCalled();
  });

  it('sin uso → borra y devuelve el mensaje del portal', async () => {
    prisma.certItem.findUnique.mockResolvedValue({ id_item: 1 });
    prisma.$queryRaw.mockResolvedValue([{ c: 0n }]);
    prisma.certItem.delete.mockResolvedValue({});
    expect(await service.eliminar(1, admin)).toEqual({ mensaje: 'Ítem eliminado' });
  });
});
