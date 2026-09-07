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
  /** Ks que `contratosExistentes` debe reportar como INEXISTENTES en el
   * maestro de contratos. Por defecto todos los Ks consultados existen. */
  ksInexistentes?: string[];
} = {}) {
  const maestro = opts.maestro ?? [];
  const ksInexistentes = new Set(opts.ksInexistentes ?? []);
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
    if (sql.includes('SELECT codigo_k FROM sth_cert_contratos')) {
      // contratosExistentes (paso 6c): por defecto TODOS los Ks consultados
      // existen en el maestro; `ksInexistentes` deja simular el K tipeado mal.
      const pedidos = (query.values as string[]) ?? [];
      return Promise.resolve(
        pedidos.filter((k) => !ksInexistentes.has(k)).map((codigo_k) => ({ codigo_k })),
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

  return { prisma, queryRaw, executeRaw, certCargaLogCreate, certCargaLogFindFirst, transaction };
}

import * as ExcelJS from 'exceljs';

async function armarExcel(filas: (string | number)[][], headers = ['ÍTEMS', 'TAREA', 'K', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', 'TOTAL']): Promise<Buffer> {
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

    const buf = await armarExcel([['431', 'Tarea', 'K12', 'Salta', 3, 100, 300]]);
    const resp = await service.preview(buf, 'a.xlsx', 2026, 8, 'excel', CERT_ADMIN, CUIL);

    expect(resp.resumen).toEqual({
      total: 1,
      con_error: 0,
      bloqueadas: 0,
      total_mes: 300,
      total_declarado: null,
    });
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
    const buf = await armarExcel([['999', 'Tarea', 'K12', 'Salta', 3, 100, 300]]);
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
      ['431', 'Tarea', 'K12', 'Salta', 0, 10, 0],
      ['431', 'Tarea', 'K12', 'Salta', 3, 100, 300],
    ]);
    const resp = await service.preview(buf, 'a.xlsx', 2026, 8, 'excel', CERT_ADMIN, CUIL);
    expect(resp.resumen.total).toBe(1);
  });

  it('avisos de negocio: K del nombre distinto del resuelto + período del archivo distinto del elegido (Task 11)', async () => {
    const { prisma } = crearPrismaMock({
      maestro: [{ itemCodigo: '431', codigoK: 'K2', idItem: 1, ptosGasnor: null, idContrato: 1 }],
    });
    const service = new CargaService(prisma as any, new ResolucionService(prisma as any), new PreviewStore());

    // Archivo "K11..." pero la fila cuadra en K2 (maestro) + cabecera con
    // "PERIODO A CERTIFICAR" de julio, mientras se elige agosto en la UI.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('CERTIF');
    ws.addRow(['PERIODO A CERTIFICAR', '1/7/2026', '31/7/2026']);
    ws.addRow(['ÍTEMS', 'TAREA', 'K', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', 'TOTAL']);
    ws.addRow(['431', 'Tarea', 'K2', 'Salta', 3, 100, 300]);
    const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);

    const resp = await service.preview(buf, 'K11 certificacion.xlsx', 2026, 8, 'excel', CERT_ADMIN, CUIL);

    expect(resp.resumen.bloqueadas).toBe(0);
    expect(resp.k_nombre_archivo).toBe('K11');
    expect(resp.periodo_archivo).toEqual({ desde: '2026-07-01', hasta: '2026-07-31' });
    expect(resp.avisos).toContainEqual(
      expect.objectContaining({ tipo: 'k_nombre_archivo', fuerte: false }),
    );
    expect(resp.avisos).toContainEqual(
      expect.objectContaining({ tipo: 'periodo_archivo', fuerte: true }),
    );
    expect(resp.filas[0].cuadratura.cuadra).toBe(true);
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
    const buf = await armarExcel([['431', 'Tarea', 'K12', 'Salta', 3, 100, 300]]);
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

  it('edición solo toca los campos del DTO (whitelist): cantidades editada + confirmada no tocan contrato ni total', async () => {
    const { prisma } = fixtureBase();
    const { service, preview } = await armarPreview(prisma, CERT_ADMIN);
    const rowId = preview.filas[0].rowId;
    // cantidades editada sola (7 × unitario 100 = 700 vs total impreso 300)
    // rompe la cuadratura y bloquearía la fila (Task 7/12); `confirmada`
    // levanta ESE bloqueo y nada más, así se prueba el whitelist con UNA
    // sola cifra editada.
    const dto: ConfirmarCargaDto = {
      previewId: preview.previewId,
      ediciones: [{ rowId, cantidades: '7', confirmada: true } as any],
    };
    // no debe tirar y el contrato debe seguir siendo el resuelto original
    await service.confirmar(dto, CERT_ADMIN, CUIL, 'Juan');
    // la sesión ya se limpió tras confirmar, así que verificamos vía la
    // llamada al INSERT (las cantidades editadas SÍ deben viajar; el total
    // impreso NO se toca).
    const insertCall = (prisma as any).$executeRaw.mock.calls[0][0];
    expect(insertCall.values).toContain('7');
    expect(insertCall.values).toContain('300');
    // el contrato resuelto siguió siendo K12 → id_contrato 1 (mock)
    expect(insertCall.values).toContain(1);
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

  it('item inexistente al confirmar (B2), con otra fila cargable en el mismo archivo: bloquea TODA la carga con 422 (Task 12)', async () => {
    const { prisma } = crearPrismaMock({
      maestro: [{ itemCodigo: '111', codigoK: 'K12', idItem: 1, ptosGasnor: null, idContrato: 1 }],
    });
    const store = new PreviewStore();
    const service = new CargaService(prisma as any, new ResolucionService(prisma as any), store);
    const buf = await armarExcel([
      ['111', 'Tarea', 'K12', 'Salta', 3, 100, 300],
      ['999', 'Tarea', 'K12', 'Salta', 3, 100, 300], // no está en el maestro
    ]);
    const preview = await service.preview(buf, 'archivo.xlsx', 2026, 8, 'excel', CERT_ADMIN, CUIL);
    await expect(
      service.confirmar({ previewId: preview.previewId, ediciones: [] }, CERT_ADMIN, CUIL, 'Juan'),
    ).rejects.toMatchObject({
      response: {
        message:
          'Hay 1 fila bloqueada. Corregilas, confirmalas o excluilas antes de cargar.',
        bloqueadas: [
          expect.objectContaining({
            rowId: preview.filas[1].rowId,
            item_codigo: '999',
            detalle: expect.stringContaining('no encontrado en el maestro'),
          }),
        ],
      },
    });
    expect((prisma as any).$transaction).not.toHaveBeenCalled();
  });

  it('excluir la fila bloqueada deja pasar el resto (la 422 es evitable sin editar cifras)', async () => {
    const { prisma } = crearPrismaMock({
      maestro: [{ itemCodigo: '111', codigoK: 'K12', idItem: 1, ptosGasnor: null, idContrato: 1 }],
    });
    const store = new PreviewStore();
    const service = new CargaService(prisma as any, new ResolucionService(prisma as any), store);
    const buf = await armarExcel([
      ['111', 'Tarea', 'K12', 'Salta', 3, 100, 300],
      ['999', 'Tarea', 'K12', 'Salta', 3, 100, 300], // no está en el maestro
    ]);
    const preview = await service.preview(buf, 'archivo.xlsx', 2026, 8, 'excel', CERT_ADMIN, CUIL);
    const resp = await service.confirmar(
      { previewId: preview.previewId, ediciones: [{ rowId: preview.filas[1].rowId, excluida: true } as any] },
      CERT_ADMIN,
      CUIL,
      'Juan',
    );
    expect(resp.insertadas).toBe(1);
    expect(resp.omitidas).toBe(0);
    expect(resp.manuales).toBe(0);
  });

  it('item_codigo editado: la fila bloqueada por ítem inexistente pasa a resolver contra el maestro', async () => {
    const { prisma } = crearPrismaMock({
      maestro: [{ itemCodigo: '111', codigoK: 'K12', idItem: 1, ptosGasnor: null, idContrato: 1 }],
    });
    const store = new PreviewStore();
    const service = new CargaService(prisma as any, new ResolucionService(prisma as any), store);
    const buf = await armarExcel([['999', 'Tarea', 'K12', 'Salta', 3, 100, 300]]);
    const preview = await service.preview(buf, 'archivo.xlsx', 2026, 8, 'excel', CERT_ADMIN, CUIL);
    expect(preview.filas[0].tiene_error).toBe(true);

    const resp = await service.confirmar(
      { previewId: preview.previewId, ediciones: [{ rowId: preview.filas[0].rowId, item_codigo: ' 111 ' } as any] },
      CERT_ADMIN,
      CUIL,
      'Juan',
    );
    expect(resp.insertadas).toBe(1);
    const insertCall = (prisma as any).$executeRaw.mock.calls[0][0];
    expect(insertCall.values).toContain(1); // id_item del maestro
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

  it('estado parcial cuando una fila válida falla al resolver ids (único camino a parcial desde Task 12)', async () => {
    // Jujuy está ACTIVA (pasa la revalidación) pero no existe en la tabla
    // de provincias que consulta resolverIds → error de resolución de ids,
    // que sigue acumulando en `errores` en vez de bloquear la carga.
    const { prisma } = crearPrismaMock({
      maestro: [{ itemCodigo: '431', codigoK: 'K12', idItem: 1, ptosGasnor: null, idContrato: 1 }],
      provinciasActivas: ['Salta', 'Jujuy'],
      provinciasTodas: [{ id: 1, provincia: 'SALTA' }],
    });
    const store = new PreviewStore();
    const service = new CargaService(prisma as any, new ResolucionService(prisma as any), store);
    const buf = await armarExcel([
      ['431', 'Tarea', 'K12', 'Salta', 3, 100, 300],
      ['431', 'Tarea', 'K12', 'Jujuy', 3, 100, 300],
    ]);
    const preview = await service.preview(buf, 'a.xlsx', 2026, 8, 'excel', CERT_ADMIN, CUIL);
    const resp = await service.confirmar(
      { previewId: preview.previewId, ediciones: [] },
      CERT_ADMIN,
      CUIL,
      'Juan',
    );
    expect(resp.insertadas).toBe(1);
    expect(resp.omitidas).toBe(1);
    expect(resp.errores[0].mensaje).toContain("Provincia 'Jujuy' no encontrada");
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
      ['431', 'Tarea', 'K12', 'Salta', 0, 10, 0], // plantilla
      ['431', 'Tarea', 'K12', 'Salta', 3, 100, 300],
    ]);
    const preview = await service.preview(buf, 'a.xlsx', 2026, 8, 'excel', CERT_ADMIN, CUIL);
    expect(preview.filas).toHaveLength(1); // la plantilla nunca entró a la sesión
    const resp = await service.confirmar({ previewId: preview.previewId, ediciones: [] }, CERT_ADMIN, CUIL, 'Juan');
    expect(resp.insertadas).toBe(1);
  });
});

// ---------------------------------------------------------------------
// Task 12: bloqueadas rechazan, `confirmada`, filas manuales y `origen`.
// ---------------------------------------------------------------------
describe('CargaService.confirmar — bloqueadas, confirmada y filas manuales (Task 12)', () => {
  const CERT_CARGA_K12_K8: CertClaim = { nivel: 'carga', ks: ['K12', 'K8'], inc: false };

  const ITEM_MANUAL = {
    id_item: 77,
    item_codigo: '5',
    codigo_k: 'K8',
    id_contrato: 2,
    tarea: 'Adicional servicios > 3 m',
    unidad_medida: 'un',
    ptos_gasnor: null,
    tipo: null,
    contratista: null,
  };

  /** Sesión con una fila que cuadra (A) y una que no (B: 922 × 66989.90 vs 14804768). */
  async function armarPreviewDosFilas(cert: CertClaim = CERT_ADMIN) {
    const mock = crearPrismaMock({
      maestro: [
        { itemCodigo: '431', codigoK: 'K12', idItem: 1, ptosGasnor: null, idContrato: 1 },
        { itemCodigo: '5', codigoK: 'K8', idItem: 77, ptosGasnor: null, idContrato: 2 },
      ],
    });
    const resolucion = new ResolucionService(mock.prisma as any);
    const cargarItemsPorId = jest
      .spyOn(resolucion, 'cargarItemsPorId')
      .mockResolvedValue(new Map());
    const store = new PreviewStore();
    const service = new CargaService(mock.prisma as any, resolucion, store);
    const buf = await armarExcel([
      ['431', 'Tarea', 'K12', 'Salta', 3, 100, 300],
      ['431', 'Tarea', 'K12', 'Salta', 922, 66989.9, 14804768],
    ]);
    const preview = await service.preview(buf, 'archivo.xlsx', 2026, 8, 'excel', cert, CUIL);
    return { ...mock, service, store, preview, cargarItemsPorId, rowA: preview.filas[0].rowId, rowB: preview.filas[1].rowId };
  }

  it('confirmar rechaza con 422 y lista las bloqueadas si queda una fila con error no excluida', async () => {
    const { service, preview, rowB, transaction } = await armarPreviewDosFilas();
    expect(preview.filas[1].cuadratura.cuadra).toBe(false);
    await expect(
      service.confirmar({ previewId: preview.previewId, ediciones: [] }, CERT_ADMIN, CUIL, 'Nombre'),
    ).rejects.toMatchObject({
      response: {
        message: 'Hay 1 fila bloqueada. Corregilas, confirmalas o excluilas antes de cargar.',
        bloqueadas: [expect.objectContaining({ rowId: rowB, item_codigo: '431' })],
      },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('confirmar acepta la fila si viene confirmada=true, y aplica unitario/total editados', async () => {
    const { service, preview, rowA, rowB, executeRaw } = await armarPreviewDosFilas();
    const r = await service.confirmar(
      {
        previewId: preview.previewId,
        ediciones: [
          { rowId: rowB, confirmada: true } as any,
          { rowId: rowA, precio_unitario: '200', total_mes: '600' } as any,
        ],
      },
      CERT_ADMIN,
      CUIL,
      'Nombre',
    );
    expect(r.insertadas).toBe(2);
    expect(r.manuales).toBe(0);
    const insertCall = executeRaw.mock.calls[0][0];
    expect(String(insertCall.strings.join(''))).toContain('origen');
    expect(insertCall.values).toContain('200');
    expect(insertCall.values).toContain('600');
    expect(insertCall.values).toContain('archivo');
  });

  it('editar item_codigo a un código ausente del maestro → 422 con el ítem en bloqueadas y sin transacción', async () => {
    const { service, preview, rowA, rowB, transaction } = await armarPreviewDosFilas();
    await expect(
      service.confirmar(
        {
          previewId: preview.previewId,
          ediciones: [
            { rowId: rowB, excluida: true } as any,
            { rowId: rowA, item_codigo: '888' } as any,
          ],
        },
        CERT_ADMIN,
        CUIL,
        'Nombre',
      ),
    ).rejects.toMatchObject({
      response: {
        bloqueadas: [
          expect.objectContaining({
            detalle: expect.stringContaining('Ítem 888 no encontrado en el maestro'),
          }),
        ],
      },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('filas manuales: valida ítem por id, K dentro del claim carga, cuadratura, y las inserta con origen manual', async () => {
    const { service, preview, cargarItemsPorId, executeRaw, certCargaLogCreate, rowB } =
      await armarPreviewDosFilas(CERT_CARGA_K12_K8);
    cargarItemsPorId.mockResolvedValue(new Map([[77, ITEM_MANUAL]]));

    const r = await service.confirmar(
      {
        previewId: preview.previewId,
        ediciones: [{ rowId: rowB, excluida: true } as any],
        manuales: [
          { id_item: 77, provincia: 'Salta', cantidades: '4', precio_unitario: '15151.96', total_mes: '60607.84' },
        ],
      },
      CERT_CARGA_K12_K8,
      CUIL,
      'Nombre',
    );

    expect(cargarItemsPorId).toHaveBeenCalledWith([77]);
    expect(r.manuales).toBe(1);
    expect(r.insertadas).toBe(2);
    const insertCall = executeRaw.mock.calls[0][0];
    expect(String(insertCall.strings.join(''))).toContain('origen');
    // 'manual' aparece dos veces en la tupla: hoja_origen Y origen (columna
    // final) — pinnear ambigüedad: exactamente 2 ocurrencias, y la ÚLTIMA
    // (columna `origen`) es 'manual'.
    expect(insertCall.values.filter((v: unknown) => v === 'manual')).toHaveLength(2);
    expect(insertCall.values[insertCall.values.length - 1]).toBe('manual');
    expect(insertCall.values).toContain('60607.84');
    expect(certCargaLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ filasManuales: 1 }) }),
    );
  });

  it('fila manual inserta el id_item/id_contrato del ítem elegido en la UI (cargarItemsPorId), no el que resolverIds resolvería por código+K', async () => {
    const mock = crearPrismaMock({
      maestro: [{ itemCodigo: '5', codigoK: 'K8', idItem: 60, ptosGasnor: null, idContrato: 9 }],
    });
    const resolucion = new ResolucionService(mock.prisma as any);
    jest.spyOn(resolucion, 'cargarItemsPorId').mockResolvedValue(
      new Map([
        [
          77,
          {
            id_item: 77,
            item_codigo: '5',
            codigo_k: 'K8',
            id_contrato: 3,
            tarea: 'Adicional',
            unidad_medida: 'un',
            ptos_gasnor: null,
            tipo: null,
            contratista: null,
          },
        ],
      ]),
    );
    const store = new PreviewStore();
    const service = new CargaService(mock.prisma as any, resolucion, store);
    const cert: CertClaim = { nivel: 'carga', ks: ['K8'], inc: false };
    const buf = await armarExcel([]);
    const preview = await service.preview(buf, 'manual.xlsx', 2026, 8, 'excel', cert, CUIL);

    const r = await service.confirmar(
      {
        previewId: preview.previewId,
        ediciones: [],
        manuales: [
          { id_item: 77, provincia: 'Salta', cantidades: '4', precio_unitario: '15151.96', total_mes: '60607.84' },
        ],
      },
      cert,
      CUIL,
      'Nombre',
    );

    expect(r.manuales).toBe(1);
    const insertCall = mock.executeRaw.mock.calls[0][0];
    // (id_item, nombre_contrato, tarea, id_contrato, ...): el id_item va en
    // values[0] y el id_contrato en values[3].
    expect(insertCall.values[0]).toBe(77);
    expect(insertCall.values[3]).toBe(3);
  });

  it('fila manual con id_item inexistente en el maestro → 400', async () => {
    const { service, preview, cargarItemsPorId, rowB } = await armarPreviewDosFilas();
    cargarItemsPorId.mockResolvedValue(new Map());
    await expect(
      service.confirmar(
        {
          previewId: preview.previewId,
          ediciones: [{ rowId: rowB, excluida: true } as any],
          manuales: [{ id_item: 999, provincia: 'Salta', cantidades: '1', precio_unitario: '10', total_mes: '10' }],
        },
        CERT_ADMIN,
        CUIL,
        'N',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('fila manual de un K fuera del claim carga → 403', async () => {
    const certCargaK12: CertClaim = { nivel: 'carga', ks: ['K12'], inc: false };
    const { service, preview, cargarItemsPorId, rowB } = await armarPreviewDosFilas(certCargaK12);
    cargarItemsPorId.mockResolvedValue(
      new Map([
        [
          78,
          { id_item: 78, item_codigo: '9', codigo_k: 'K2', id_contrato: 5, tarea: 't', unidad_medida: null, ptos_gasnor: null, tipo: null, contratista: null },
        ],
      ]),
    );
    await expect(
      service.confirmar(
        {
          previewId: preview.previewId,
          ediciones: [{ rowId: rowB, excluida: true } as any],
          manuales: [{ id_item: 78, provincia: 'Salta', cantidades: '1', precio_unitario: '10', total_mes: '10' }],
        },
        certCargaK12,
        CUIL,
        'N',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fila manual que no cuadra sin confirmada → 422 con la manual en bloqueadas', async () => {
    const { service, preview, cargarItemsPorId, rowB } = await armarPreviewDosFilas();
    cargarItemsPorId.mockResolvedValue(new Map([[77, ITEM_MANUAL]]));
    await expect(
      service.confirmar(
        {
          previewId: preview.previewId,
          ediciones: [{ rowId: rowB, excluida: true } as any],
          manuales: [{ id_item: 77, provincia: 'Salta', cantidades: '4', precio_unitario: '15151.96', total_mes: '999' }],
        },
        CERT_ADMIN,
        CUIL,
        'N',
      ),
    ).rejects.toMatchObject({
      response: { bloqueadas: [expect.objectContaining({ rowId: 'manual-1', item_codigo: '5' })] },
    });
  });

  it('fila manual que no cuadra pero viene confirmada=true → se carga', async () => {
    const { service, preview, cargarItemsPorId, rowB } = await armarPreviewDosFilas();
    cargarItemsPorId.mockResolvedValue(new Map([[77, ITEM_MANUAL]]));
    const r = await service.confirmar(
      {
        previewId: preview.previewId,
        ediciones: [{ rowId: rowB, excluida: true } as any],
        manuales: [
          { id_item: 77, provincia: 'Salta', cantidades: '4', precio_unitario: '15151.96', total_mes: '999', confirmada: true },
        ],
      },
      CERT_ADMIN,
      CUIL,
      'N',
    );
    expect(r.manuales).toBe(1);
    expect(r.insertadas).toBe(2);
  });

  it('fila manual con provincia inválida → 422 (confirmada NO levanta ese bloqueo)', async () => {
    const { service, preview, cargarItemsPorId, rowB } = await armarPreviewDosFilas();
    cargarItemsPorId.mockResolvedValue(new Map([[77, ITEM_MANUAL]]));
    await expect(
      service.confirmar(
        {
          previewId: preview.previewId,
          ediciones: [{ rowId: rowB, excluida: true } as any],
          manuales: [
            { id_item: 77, provincia: 'Neuquén', cantidades: '4', precio_unitario: '15151.96', total_mes: '60607.84', confirmada: true },
          ],
        },
        CERT_ADMIN,
        CUIL,
        'N',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

// ---------------------------------------------------------------------
// Review final Etapa B: normalización de coma, idempotencia del
// confirmar y K inexistente en el maestro de contratos.
// ---------------------------------------------------------------------
describe('CargaService.confirmar — coma decimal, idempotencia y K inexistente', () => {
  async function armarPreviewUnaFila(
    opts: Parameters<typeof crearPrismaMock>[0] = {
      maestro: [{ itemCodigo: '431', codigoK: 'K12', idItem: 1, ptosGasnor: null, idContrato: 1 }],
    },
  ) {
    const mock = crearPrismaMock(opts);
    const store = new PreviewStore();
    const service = new CargaService(mock.prisma as any, new ResolucionService(mock.prisma as any), store);
    const buf = await armarExcel([['431', 'Tarea', 'K12', 'Salta', 3, 100, 300]]);
    const preview = await service.preview(buf, 'archivo.xlsx', 2026, 8, 'excel', CERT_ADMIN, CUIL);
    return { ...mock, service, store, preview, rowId: preview.filas[0].rowId };
  }

  it('una cantidad editada con coma se guarda con PUNTO y así llega al INSERT', async () => {
    const { service, preview, rowId, executeRaw } = await armarPreviewUnaFila();
    // 3,5 × 100 = 350 vs total impreso 300 → no cuadra; `confirmada` levanta
    // ese bloqueo para poder observar la cifra que efectivamente se inserta.
    const r = await service.confirmar(
      {
        previewId: preview.previewId,
        ediciones: [{ rowId, cantidades: '3,5', confirmada: true } as any],
      },
      CERT_ADMIN,
      CUIL,
      'Juan',
    );
    expect(r.insertadas).toBe(1);
    const values = executeRaw.mock.calls[0][0].values;
    expect(values).toContain('3.5');
    expect(values).not.toContain('3,5');
  });

  it('un precio unitario con coma normalizado hace CUADRAR la fila (revalidarFila ve el mismo número)', async () => {
    const { service, preview, rowId, executeRaw } = await armarPreviewUnaFila();
    // 3 × 100,5 = 301,5 vs 301,5 impreso → cuadra sin `confirmada`, lo que
    // solo puede pasar si la coma se normalizó ANTES de revalidar.
    const r = await service.confirmar(
      {
        previewId: preview.previewId,
        ediciones: [{ rowId, precio_unitario: '100,5', total_mes: '301,5' } as any],
      },
      CERT_ADMIN,
      CUIL,
      'Juan',
    );
    expect(r.insertadas).toBe(1);
    const values = executeRaw.mock.calls[0][0].values;
    expect(values).toContain('100.5');
    expect(values).toContain('301.5');
  });

  it('idempotencia: un confirmar que falló con 422 no deja pegada la edición — el reintento sin ediciones vuelve al valor ORIGINAL', async () => {
    const { service, preview, rowId, executeRaw, transaction } = await armarPreviewUnaFila();

    // Intento 1: cantidades 99 (99 × 100 = 9900 vs 300 impreso) → 422.
    await expect(
      service.confirmar(
        { previewId: preview.previewId, ediciones: [{ rowId, cantidades: '99' } as any] },
        CERT_ADMIN,
        CUIL,
        'Juan',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(transaction).not.toHaveBeenCalled();

    // Intento 2: MISMA sesión, sin ediciones → la fila vuelve a valer 3.
    const r = await service.confirmar(
      { previewId: preview.previewId, ediciones: [] },
      CERT_ADMIN,
      CUIL,
      'Juan',
    );
    expect(r.insertadas).toBe(1);
    const values = executeRaw.mock.calls[0][0].values;
    expect(values).toContain('3');
    expect(values).not.toContain('99');
  });

  it('idempotencia: `confirmada` tampoco queda pegado entre intentos', async () => {
    const { service, preview, rowId, prisma, executeRaw } = await armarPreviewUnaFila();

    // Intento 1: cantidades=99 + confirmada=true (que solas pasarían), pero
    // el duplicado por nombre de archivo lo aborta DESPUÉS de aplicar las
    // ediciones sobre la sesión.
    (prisma as any).certCargaLog.findFirst.mockResolvedValueOnce({ id: 1 });
    await expect(
      service.confirmar(
        {
          previewId: preview.previewId,
          ediciones: [{ rowId, cantidades: '99', confirmada: true } as any],
        },
        CERT_ADMIN,
        CUIL,
        'Juan',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Intento 2 sin ediciones: si `confirmada`/cantidades hubieran quedado
    // pegados, se insertaría 99; el reset devuelve la fila a 3.
    const r = await service.confirmar(
      { previewId: preview.previewId, ediciones: [] },
      CERT_ADMIN,
      CUIL,
      'Juan',
    );
    expect(r.insertadas).toBe(1);
    const values = executeRaw.mock.calls[0][0].values;
    expect(values).toContain('3');
    expect(values).not.toContain('99');
  });

  it('K editado que no existe en el maestro de contratos → 422 con el detalle, sin transacción', async () => {
    const { service, preview, rowId, transaction, queryRaw } = await armarPreviewUnaFila({
      maestro: [{ itemCodigo: '431', codigoK: 'K12', idItem: 1, ptosGasnor: null, idContrato: 1 }],
      ksInexistentes: ['KZZ'],
    });

    await expect(
      service.confirmar(
        { previewId: preview.previewId, ediciones: [{ rowId, contrato: 'KZZ' } as any] },
        CERT_ADMIN,
        CUIL,
        'Juan',
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Hay 1 fila bloqueada. Corregilas, confirmalas o excluilas antes de cargar.',
        bloqueadas: [
          expect.objectContaining({
            rowId,
            detalle: expect.stringContaining('Contrato KZZ no existe en el maestro de contratos'),
          }),
        ],
      },
    });
    expect(transaction).not.toHaveBeenCalled();

    // Batch: UNA sola query de existencia de contratos para toda la carga.
    const consultasExistencia = queryRaw.mock.calls.filter((c: any[]) =>
      String((c[0] as { sql: string }).sql).includes('SELECT codigo_k FROM sth_cert_contratos'),
    );
    expect(consultasExistencia).toHaveLength(1);
  });

  it('K existente en el maestro no agrega ningún detalle (el camino feliz sigue intacto)', async () => {
    const { service, preview } = await armarPreviewUnaFila();
    const r = await service.confirmar(
      { previewId: preview.previewId, ediciones: [] },
      CERT_ADMIN,
      CUIL,
      'Juan',
    );
    expect(r.insertadas).toBe(1);
    expect(r.errores).toEqual([]);
  });
});
