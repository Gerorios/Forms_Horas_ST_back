import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { HistorialService } from './historial.service';
import { AccesosService, CertClaim } from '../accesos.service';

function crearPrismaMock(opts: { queryRawResult?: unknown[]; log?: unknown } = {}) {
  const queryRaw = jest.fn().mockResolvedValue(opts.queryRawResult ?? []);
  const executeRaw = jest.fn().mockResolvedValue(3);
  const certCargaLogFindUnique = jest.fn().mockResolvedValue(opts.log ?? null);
  const certCargaLogDelete = jest.fn().mockResolvedValue({});
  const transaction = jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));

  return {
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    $transaction: transaction,
    certCargaLog: { findUnique: certCargaLogFindUnique, delete: certCargaLogDelete },
  } as any;
}

describe('HistorialService.listar — visibilidad por nivel', () => {
  it('admin ve las 100 últimas de todos (sin filtrar por usuario_nombre)', async () => {
    const prisma = crearPrismaMock();
    const accesos = { resolverNombre: jest.fn() } as unknown as AccesosService;
    const service = new HistorialService(prisma, accesos);

    await service.listar({ nivel: 'admin', ks: [], inc: false }, '20-1');

    expect(accesos.resolverNombre).not.toHaveBeenCalled();
    const sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.sql).toContain('LIMIT ?');
    expect(sql.values).toEqual(expect.arrayContaining([100]));
    expect(sql.sql).not.toContain('usuario_nombre =');
  });

  it('lectura también ve las 100 últimas de todos', async () => {
    const prisma = crearPrismaMock();
    const accesos = { resolverNombre: jest.fn() } as unknown as AccesosService;
    const service = new HistorialService(prisma, accesos);

    await service.listar({ nivel: 'lectura', ks: [], inc: false }, '20-1');

    expect(accesos.resolverNombre).not.toHaveBeenCalled();
    const sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.values).toEqual(expect.arrayContaining([100]));
  });

  it('carga ve solo 50 propias, filtradas por el nombre resuelto de su cuil', async () => {
    const prisma = crearPrismaMock();
    const accesos = { resolverNombre: jest.fn().mockResolvedValue('PEREZ JUAN') } as unknown as AccesosService;
    const service = new HistorialService(prisma, accesos);

    await service.listar({ nivel: 'carga', ks: ['K6'], inc: false }, '20-1');

    expect(accesos.resolverNombre).toHaveBeenCalledWith('20-1');
    const sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.sql).toContain('usuario_nombre = ?');
    expect(sql.values).toEqual(expect.arrayContaining(['PEREZ JUAN', 50]));
  });

  it('sin cert o nivel desconocido rechaza con Forbidden', async () => {
    const prisma = crearPrismaMock();
    const accesos = { resolverNombre: jest.fn() } as unknown as AccesosService;
    const service = new HistorialService(prisma, accesos);

    await expect(service.listar(null, '20-1')).rejects.toThrow(ForbiddenException);
    await expect(
      service.listar({ nivel: 'otro' } as unknown as CertClaim, '20-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('mapea el shape exacto que devuelve la query (cargado_en ya formateado)', async () => {
    const fila = {
      id: 1,
      usuario_nombre: 'PEREZ JUAN',
      archivo_nombre: 'archivo.xlsx',
      contrato: 'K6',
      periodo: '2026-08',
      filas_cargadas: 10,
      filas_error: 1,
      estado: 'parcial',
      cargado_en: '2026-08-21 14:30',
    };
    const prisma = crearPrismaMock({ queryRawResult: [fila] });
    const accesos = { resolverNombre: jest.fn() } as unknown as AccesosService;
    const service = new HistorialService(prisma, accesos);

    const resultado = await service.listar({ nivel: 'admin', ks: [], inc: false }, '20-1');
    expect(resultado).toEqual([fila]);
  });
});

describe('HistorialService.deshacer', () => {
  it('solo admin puede deshacer', async () => {
    const prisma = crearPrismaMock();
    const accesos = {} as AccesosService;
    const service = new HistorialService(prisma, accesos);

    await expect(service.deshacer(1, { nivel: 'lectura', ks: [], inc: false })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.deshacer(1, null)).rejects.toThrow(ForbiddenException);
    expect(prisma.certCargaLog.findUnique).not.toHaveBeenCalled();
  });

  it('404 si el log no existe', async () => {
    const prisma = crearPrismaMock({ log: null });
    const accesos = {} as AccesosService;
    const service = new HistorialService(prisma, accesos);

    await expect(service.deshacer(999, { nivel: 'admin', ks: [], inc: false })).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('borra fact + log en UNA transacción y devuelve el conteo', async () => {
    const log = { id: 5, archivoNombre: 'archivo.xlsx', periodo: '2026-08' };
    const prisma = crearPrismaMock({ log });
    const accesos = {} as AccesosService;
    const service = new HistorialService(prisma, accesos);

    const resultado = await service.deshacer(5, { nivel: 'admin', ks: [], inc: false });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const operaciones = prisma.$transaction.mock.calls[0][0];
    expect(operaciones).toHaveLength(2);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const sql = prisma.$executeRaw.mock.calls[0][0];
    expect(sql.sql).toContain('DELETE FROM sth_cert_certificaciones');
    expect(sql.sql).toContain("DATE_FORMAT(fecha, '%Y-%m') = ?");
    expect(sql.values).toEqual(['archivo.xlsx', '2026-08']);
    expect(prisma.certCargaLog.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(resultado).toEqual({ mensaje: 'Carga deshecha', filasBorradas: 3 });
  });
});
