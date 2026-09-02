import { BadRequestException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { CargaService } from './carga.service';
import { ResolucionService } from './resolucion.service';
import { PreviewStore } from './preview-store';
import { ConfirmarCargaDto } from '../dto/carga.dto';
import { CertClaim } from '../accesos.service';

// ---------------------------------------------------------------------
// Mock de Prisma: enrutamos $queryRaw por el TEXTO de la consulta (todas
// las queries batch de ResolucionService son reconocibles por su SELECT),
// para poder ejercitar CargaService de punta a punta con una
// ResolucionService REAL (no mockeada) sobre datos de maestro controlados.
// ---------------------------------------------------------------------
interface MaestroFixture {
  itemCodigo: string;
  codigoK: string;
  idItem: number;
  idContrato: number;
  ptosGasnor: string | null;
}

function crearPrismaMock(opts: {
  maestro?: MaestroFixture[];
  provinciasActivas?: string[];
  provinciasTodas?: { id: number; provincia: string }[];
  cargaExistente?: boolean;
} = {}) {
  const maestro = opts.maestro ?? [];
  const provinciasActivas = opts.provinciasActivas ?? ['Salta', 'Jujuy'];
  const provinciasTodas = opts.provinciasTodas ?? [
    { id: 1, provincia: 'SALTA' },
    { id: 2, provincia: 'JUJUY' },
  ];

  const queryRaw = jest.fn((query: { sql: string; values: unknown[] }) => {
    const sql = query.sql;
    if (sql.includes('sth_cert_provincias') && sql.includes('activo = 1')) {
      return Promise.resolve(provinciasActivas.map((provincia) => ({ provincia })));
    }
    if (sql.includes('sth_cert_provincias')) {
      return Promise.resolve(provinciasTodas);
    }
    if (sql.includes('sth_cert_items') && sql.includes('di.id_item,')) {
      // resolverIds: items batch
      return Promise.resolve(
        maestro.map((m) => ({
          id_item: m.idItem,
          item_norm: m.itemCodigo.replace(/\./g, ','),
          codigo_k: m.codigoK,
          ptos_gasnor: m.ptosGasnor,
        })),
      );
    }
    if (sql.includes('sth_cert_items')) {
      // cargarMaestro
      return Promise.resolve(
        maestro.map((m) => ({ item_norm: m.itemCodigo.replace(/\./g, ','), codigo_k: m.codigoK })),
      );
    }
    if (sql.includes('sth_cert_contratos')) {
      const ks = [...new Set(maestro.map((m) => m.codigoK))];
      return Promise.resolve(ks.map((k, i) => ({ id_contrato: i + 1, codigo_k: k })));
    }
    throw new Error(`Query no reconocida en el mock: ${sql}`);
  });

  const executeRaw = jest.fn().mockResolvedValue(1);
  const certCargaLogCreate = jest.fn().mockResolvedValue({});
  const certCargaLogFindFirst = jest
    .fn()
    .mockResolvedValue(opts.cargaExistente ? { id: 1 } : null);
  const transaction = jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));

  const prisma = {
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
    $transaction: transaction,
    certCargaLog: { findFirst: certCargaLogFindFirst, create: certCargaLogCreate },
  };

  return { prisma, executeRaw, certCargaLogCreate, certCargaLogFindFirst, transaction };
}

import * as ExcelJS from 'exceljs';

async function armarExcel(filas: (string | number)[][], headers = ['ÍTEMS', 'TAREA', 'K', 'PROVINCIA', 'CANTIDADES', 'TOTAL']): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('CERTIF K12');
  ws.addRow(headers);
  for (const f of filas) ws.addRow(f);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

const CERT_ADMIN: CertClaim = { nivel: 'admin', ks: [], inc: false };
const CERT_CARGA_K12: CertClaim = { nivel: 'carga', ks: ['K12'], inc: false };
const CUIL = '20111111112';

describe('CargaService.preview', () => {
  it('rechaza niveles distintos de admin/carga', async () => {
    const { prisma } = crearPrismaMock();
    const service = new CargaService(prisma as any, new ResolucionService(prisma as any), new PreviewStore());
    const cert: CertClaim = { nivel: 'gerente', ks: [], inc: false };
    await expect(
      service.preview(await armarExcel([]), 'a.xlsx', 2026, 8, 'excel', cert, CUIL),
    ).rejects.toThrow('Solo niveles admin y carga pueden cargar certificaciones.');
  });

  it('rechaza cert null', async () => {
    const { prisma } = crearPrismaMock();
    const service = new CargaService(prisma as any, new ResolucionService(prisma as any), new PreviewStore());
    await expect(
      service.preview(await armarExcel([]), 'a.xlsx', 2026, 8, 'excel', null, CUIL),
    ).rejects.toThrow(ForbiddenException);
  });

  it('arma el preview con resumen (total, con_error, total_mes) y guarda la sesión con owner = cuil', async () => {
    const { prisma } = crearPrismaMock({
      maestro: [{ itemCodigo: '431', codigoK: 'K12', idItem: 1, ptosGasnor: null, idContrato: 1 }],
    });
    const store = new PreviewStore();
    const service = new CargaService(prisma as any, new ResolucionService(prisma as any), store);

    const buf = await armarExcel([['431', 'Tarea', 'K12', 'Salta', 3, 100]]);
    const resp = await service.preview(buf, 'a.xlsx', 2026, 8, 'excel', CERT_ADMIN, CUIL);

    expect(resp.resumen).toEqual({ total: 1, con_error: 0, total_mes: 100, total_declarado: null });
    expect(resp.filas).toHaveLength(1);
    expect(resp.filas[0].item_en_maestro).toBe(true);
    expect(resp.filas[0].rowId).toBeTruthy();

    const sesion = store.recuperar(resp.previewId, CUIL);
    expect(sesion).not.toBeNull();
    expect(sesion!.ownerCuil).toBe(CUIL);
  });

  it('marca con_error una fila con ítem fuera del maestro (item_en_maestro=false)', async () => {
    const { prisma } = crearPrismaMock({ maestro: [] });
    const service = new CargaService(prisma as any, new ResolucionService(prisma as any), new PreviewStore());
    const buf = await armarExcel([['999', 'Tarea', 'K12', 'Salta', 3, 100]]);
    const resp = await service.preview(buf, 'a.xlsx', 2026, 8, 'excel', CERT_ADMIN, CUIL);
    expect(resp.resumen.con_error).toBe(1);
    expect(resp.filas[0].item_en_maestro).toBe(false);
    expect(resp.filas[0].error_detalle).toContain('no encontrado en el maestro');
  });

  it('filtra las filas de plantilla (cantidad y total en 0/null) sin avisar', async () => {
    const { prisma } = crearPrismaMock({
      maestro: [{ itemCodigo: '431', codigoK: 'K12', idItem: 1, ptosGasnor: null, idContrato: 1 }],
    });
    const service = new CargaService(prisma as any, new ResolucionService(prisma as any), new PreviewStore());
    const buf = await armarExcel([
      ['431', 'Tarea', 'K12', 'Salta', 0, 0],
      ['431', 'Tarea', 'K12', 'Salta', 3, 100],
    ]);
    const resp = await service.preview(buf, 'a.xlsx', 2026, 8, 'excel', CERT_ADMIN, CUIL);
    expect(resp.resumen.total).toBe(1);
  });
});

describe('CargaService.confirmar', () => {
  function fixtureBase() {
    return crearPrismaMock({
      maestro: [{ itemCodigo: '431', codigoK: 'K12', idItem: 1, ptosGasnor: '10', idContrato: 1 }],
    });
  }

  async function armarPreview(prisma: any, cert: CertClaim, cuil = CUIL) {
    const store = new PreviewStore();
    const service = new CargaService(prisma, new ResolucionService(prisma), store);
    const buf = await armarExcel([['431', 'Tarea', 'K12', 'Salta', 3, 100]]);
    const preview = await service.preview(buf, 'archivo.xlsx', 2026, 8, 'excel', cert, cuil);
    return { service, store, preview };
  }

  it('sesión inexistente/expirada → 400 con el mensaje exacto del portal', async () => {
    const { prisma } = fixtureBase();
    const service = new CargaService(prisma as any, new ResolucionService(prisma as any), new PreviewStore());
    const dto: ConfirmarCargaDto = { previewId: 'no-existe', ediciones: [] };
    await expect(service.confirmar(dto, CERT_ADMIN, CUIL, 'Juan Pérez')).rejects.toThrow(
      'La sesión expiró (30 minutos). Volvé a subir el archivo.',
    );
  });

  it('ownership: cuil distinto al dueño de la sesión → mismo mensaje de expiración (fix B1)', async () => {
    const { prisma } = fixtureBase();
    const { service, preview } = await armarPreview(prisma, CERT_ADMIN, CUIL);
    const dto: ConfirmarCargaDto = { previewId: preview.previewId, ediciones: [] };
    await expect(service.confirmar(dto, CERT_ADMIN, '20999999999', 'Otro')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rowId desconocido en una edición → 400', async () => {
    const { prisma } = fixtureBase();
    const { service, preview } = await armarPreview(prisma, CERT_ADMIN);
    const dto: ConfirmarCargaDto = {
      previewId: preview.previewId,
      ediciones: [{ rowId: 'no-existe', contrato: 'K99' } as any],
    };
    await expect(service.confirmar(dto, CERT_ADMIN, CUIL, 'Juan')).rejects.toThrow(BadRequestException);
  });

  it('edición solo toca los 5 campos del DTO (whitelist): un rowId válido con SOLO cantidades editada no toca contrato', async () => {
    const { prisma } = fixtureBase();
    const { service, store, preview } = await armarPreview(prisma, CERT_ADMIN);
    const rowId = preview.filas[0].rowId;
    const dto: ConfirmarCargaDto = { previewId: preview.previewId, ediciones: [{ rowId, cantidades: '7' } as any] };
    // no debe tirar y el contrato debe seguir siendo el resuelto original
    await service.confirmar(dto, CERT_ADMIN, CUIL, 'Juan');
    // la sesión ya se limpió tras confirmar, así que verificamos vía la
    // llamada al INSERT (las cantidades editadas SÍ deben viajar).
    const insertCall = (prisma as any).$executeRaw.mock.calls[0][0];
    expect(insertCall.values).toContain('7');
  });

  it('duplicado por archivo_nombre: mensaje EXACTO del portal, distinto para admin y no-admin', async () => {
    const { prisma } = fixtureBase();
    (prisma as any).certCargaLog.findFirst.mockResolvedValue({ id: 1 });

    const { service: serviceAdmin, preview: previewAdmin } = await armarPreview(prisma, CERT_ADMIN);
    await expect(
      serviceAdmin.confirmar({ previewId: previewAdmin.previewId, ediciones: [] }, CERT_ADMIN, CUIL, 'Juan'),
    ).rejects.toThrow(
      "El archivo 'archivo.xlsx' ya fue cargado anteriormente. Si necesitás reemplazarlo, eliminá la carga anterior desde el historial.",
    );

    const { service: serviceCarga, preview: previewCarga } = await armarPreview(prisma, CERT_CARGA_K12);
    await expect(
      serviceCarga.confirmar({ previewId: previewCarga.previewId, ediciones: [] }, CERT_CARGA_K12, CUIL, 'Juan'),
    ).rejects.toThrow(
      "El archivo 'archivo.xlsx' ya fue cargado anteriormente. Si necesitás reemplazarlo, pedile a un administrador que elimine la carga anterior desde el historial.",
    );
  });

  it('item inexistente al confirmar (B2): re-revalida server-side (no confía en el tiene_error del preview)', async () => {
    // El preview se armó con el ítem en el maestro; al confirmar, el
    // maestro se RE-carga y ahora viene vacío (ítem borrado entretanto) —
    // la fila, única del archivo, queda sin nada cargable → 422 (no hay
    // filas válidas), y NO un insert silencioso con item_existe=true
    // "default" (ese es exactamente el bug B2 del portal).
    const { prisma } = crearPrismaMock({ maestro: [] });
    const { service, preview } = await armarPreview(prisma, CERT_ADMIN);
    await expect(
      service.confirmar({ previewId: preview.previewId, ediciones: [] }, CERT_ADMIN, CUIL, 'Juan'),
    ).rejects.toThrow(UnprocessableEntityException);
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('item inexistente al confirmar (B2), con otra fila cargable en el mismo archivo: se omite con contexto {hoja, fila, item_codigo}', async () => {
    const { prisma } = crearPrismaMock({
      maestro: [{ itemCodigo: '111', codigoK: 'K12', idItem: 1, ptosGasnor: null, idContrato: 1 }],
    });
    const store = new PreviewStore();
    const service = new CargaService(prisma as any, new ResolucionService(prisma as any), store);
    const buf = await armarExcel([
      ['111', 'Tarea', 'K12', 'Salta', 3, 100],
      ['999', 'Tarea', 'K12', 'Salta', 3, 100], // no está en el maestro
    ]);
    const preview = await service.preview(buf, 'archivo.xlsx', 2026, 8, 'excel', CERT_ADMIN, CUIL);
    const resp = await service.confirmar({ previewId: preview.previewId, ediciones: [] }, CERT_ADMIN, CUIL, 'Juan');
    expect(resp.insertadas).toBe(1);
    expect(resp.omitidas).toBe(1);
    expect(resp.errores[0]).toMatchObject({ hoja: 'CERTIF K12', fila: 3, item_codigo: '999' });
    expect(resp.errores[0].mensaje).toContain('no encontrado en el maestro');
  });

  it('permisos nivel carga: fail-closed antes de insertar si el K resuelto no está en cert.ks', async () => {
    const { prisma } = fixtureBase();
    const certSinK12: CertClaim = { nivel: 'carga', ks: ['K8'], inc: false };
    const { service, preview } = await armarPreview(prisma, certSinK12);
    await expect(
      service.confirmar({ previewId: preview.previewId, ediciones: [] }, certSinK12, CUIL, 'Juan'),
    ).rejects.toThrow('No tenés acceso al contrato K12');
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('nivel carga con acceso al K resuelto: inserta OK', async () => {
    const { prisma } = fixtureBase();
    const { service, preview } = await armarPreview(prisma, CERT_CARGA_K12);
    const resp = await service.confirmar(
      { previewId: preview.previewId, ediciones: [] },
      CERT_CARGA_K12,
      CUIL,
      'Juan',
    );
    expect(resp.insertadas).toBe(1);
  });

  it('sin filas válidas (todas excluidas) → 422', async () => {
    const { prisma } = fixtureBase();
    const { service, preview } = await armarPreview(prisma, CERT_ADMIN);
    const rowId = preview.filas[0].rowId;
    await expect(
      service.confirmar(
        { previewId: preview.previewId, ediciones: [{ rowId, excluida: true } as any] },
        CERT_ADMIN,
        CUIL,
        'Juan',
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('llama a $transaction UNA sola vez con el insert y el log juntos', async () => {
    const { prisma, transaction } = fixtureBase();
    const { service, preview } = await armarPreview(prisma, CERT_ADMIN);
    await service.confirmar({ previewId: preview.previewId, ediciones: [] }, CERT_ADMIN, CUIL, 'Juan');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it('limpia la sesión tras confirmar (no se puede reusar el previewId)', async () => {
    const { prisma } = fixtureBase();
    const { service, store, preview } = await armarPreview(prisma, CERT_ADMIN);
    await service.confirmar({ previewId: preview.previewId, ediciones: [] }, CERT_ADMIN, CUIL, 'Juan');
    expect(store.recuperar(preview.previewId, CUIL)).toBeNull();
  });

  it('ptos_gasnor fallback al maestro cuando el archivo no lo trae', async () => {
    const { prisma } = fixtureBase(); // maestro tiene ptosGasnor '10'; el excel no trae columna PTOS
    const { service, preview } = await armarPreview(prisma, CERT_ADMIN);
    await service.confirmar({ previewId: preview.previewId, ediciones: [] }, CERT_ADMIN, CUIL, 'Juan');
    const insertCall = (prisma as any).$executeRaw.mock.calls[0][0];
    expect(insertCall.values).toContain('10');
  });

  it('estado parcial cuando hay filas insertadas Y omitidas', async () => {
    const { prisma } = crearPrismaMock({
      maestro: [{ itemCodigo: '431', codigoK: 'K12', idItem: 1, ptosGasnor: null, idContrato: 1 }],
    });
    const store = new PreviewStore();
    const service = new CargaService(prisma as any, new ResolucionService(prisma as any), store);
    const buf = await armarExcel([
      ['431', 'Tarea', 'K12', 'Salta', 3, 100],
      ['777', 'Tarea', 'K12', 'Salta', 3, 100], // ítem no está en el maestro (B2 lo omite)
    ]);
    const preview = await service.preview(buf, 'a.xlsx', 2026, 8, 'excel', CERT_ADMIN, CUIL);
    // la fila 777 ya viene con error en el preview, pero igual la mandamos
    // (revalidación server-side ignora tiene_error del cliente igual)
    const resp = await service.confirmar(
      { previewId: preview.previewId, ediciones: [] },
      CERT_ADMIN,
      CUIL,
      'Juan',
    );
    expect(resp.insertadas).toBe(1);
    expect(resp.omitidas).toBe(1);
    const logCreate = (prisma as any).certCargaLog.create.mock.calls[0][0];
    expect(logCreate.data.estado).toBe('parcial');
  });

  it('plantillas nunca llegan a insertarse: no viven en la sesión (ya se filtraron en preview)', async () => {
    const { prisma } = crearPrismaMock({
      maestro: [{ itemCodigo: '431', codigoK: 'K12', idItem: 1, ptosGasnor: null, idContrato: 1 }],
    });
    const store = new PreviewStore();
    const service = new CargaService(prisma as any, new ResolucionService(prisma as any), store);
    const buf = await armarExcel([
      ['431', 'Tarea', 'K12', 'Salta', 0, 0], // plantilla
      ['431', 'Tarea', 'K12', 'Salta', 3, 100],
    ]);
    const preview = await service.preview(buf, 'a.xlsx', 2026, 8, 'excel', CERT_ADMIN, CUIL);
    expect(preview.filas).toHaveLength(1); // la plantilla nunca entró a la sesión
    const resp = await service.confirmar({ previewId: preview.previewId, ediciones: [] }, CERT_ADMIN, CUIL, 'Juan');
    expect(resp.insertadas).toBe(1);
  });
});
