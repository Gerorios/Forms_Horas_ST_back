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
