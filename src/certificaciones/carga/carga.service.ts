import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CertClaim } from '../accesos.service';
import { ErrorParseo, FilaParseada } from './parser-tipos';
import { parsearExcel } from './parser-excel';
import { parsearPdf } from './parser-pdf';
import { esFilaPlantilla, revalidarFila } from './validacion';
import { ResolucionService } from './resolucion.service';
import { PreviewStore, PreviewSession, FilaPreview } from './preview-store';
import { ConfirmarCargaDto } from '../dto/carga.dto';

/**
 * CargaService — preview y confirmar server-authoritative de la carga de
 * certificaciones, port de app/routers/certificaciones.py (preview,
 * confirmar) + app/services/carga.py (cargar_certificaciones,
 * anotar_contrato_final) del portal. Ver
 * docs/superpowers/specs/2026-09-02-inventario-carga-portal.md §1 y §5,
 * y el brief de esta task para el orden exacto del confirmar.
 */

const MSG_SESION_EXPIRADA = 'La sesión expiró (30 minutos). Volvé a subir el archivo.';
const NIVELES_CARGA = new Set(['admin', 'carga']);
const DETALLE_ERRORES_MAX = 2000;

export interface ResumenPreview {
  total: number;
  con_error: number;
  total_mes: number;
  total_declarado: number | null;
}

export interface RespuestaPreview {
  previewId: string;
  archivo: string;
  hojas: string[];
  periodo: string;
  resumen: ResumenPreview;
  filas: FilaPreview[];
  errores: ErrorParseo[];
}

export interface ErrorConfirmar {
  hoja: string;
  fila: number;
  item_codigo: string;
  mensaje: string;
}

export interface RespuestaConfirmar {
  mensaje: string;
  insertadas: number;
  omitidas: number;
  errores: ErrorConfirmar[];
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function num(v: string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

@Injectable()
export class CargaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolucion: ResolucionService,
    private readonly store: PreviewStore,
  ) {}

  private exigirNivelCarga(cert: CertClaim | null): void {
    if (!cert || !NIVELES_CARGA.has(cert.nivel)) {
      throw new ForbiddenException('Solo niveles admin y carga pueden cargar certificaciones.');
    }
  }

  private async provinciasActivas(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ provincia: string }[]>(
      Prisma.sql`SELECT provincia FROM sth_cert_provincias WHERE activo = 1`,
    );
    return rows.map((r) => r.provincia);
  }

  // -------------------------------------------------------------------
  // PREVIEW
  // -------------------------------------------------------------------

  async preview(
    contenido: Buffer,
    nombreArchivo: string,
    anio: number,
    mes: number,
    tipoArchivo: 'excel' | 'pdf',
    cert: CertClaim | null,
    cuil: string,
  ): Promise<RespuestaPreview> {
    this.exigirNivelCarga(cert);

    const resultado =
      tipoArchivo === 'pdf'
        ? await parsearPdf(contenido, nombreArchivo, anio, mes)
        : await parsearExcel(contenido, nombreArchivo, anio, mes);

    const visibles = resultado.filas.filter((f) => !esFilaPlantilla(f));

    const [mapa, provinciasValidas] = await Promise.all([
      this.resolucion.cargarMaestro(visibles.map((f) => f.item_codigo)),
      this.provinciasActivas(),
    ]);

    const filasMap = new Map<string, FilaPreview>();
    let conError = 0;
    let totalMes = 0;

    for (const f of visibles) {
      const itemEnMaestro = mapa.existe(f.item_codigo);
      const { contrato, fuente } = this.resolucion.resolverContratoFinal(
        mapa,
        f.item_codigo,
        f.contrato || null,
        null,
      );
      const filaResuelta: FilaParseada = { ...f, contrato: contrato ?? '' };
      const { tieneError, detalle } = revalidarFila(filaResuelta, {
        itemExiste: itemEnMaestro,
        provinciasValidas,
      });

      const rowId = randomUUID();
      const filaPreview: FilaPreview = {
        ...filaResuelta,
        tiene_error: tieneError,
        rowId,
        item_en_maestro: itemEnMaestro,
        error_detalle: detalle,
        contrato_archivo: f.contrato,
        contrato_fuente: fuente,
        contrato_del_maestro: fuente === 'maestro' ? contrato : null,
        excluida: false,
      };
      filasMap.set(rowId, filaPreview);

      if (tieneError) conError++;
      else totalMes += num(filaPreview.total_mes);
    }

    const previewId = randomUUID();
    const sesion: PreviewSession = {
      id: previewId,
      ownerCuil: cuil,
      archivo: nombreArchivo,
      anio,
      mes,
      filas: filasMap,
      creadaEn: Date.now(),
    };
    this.store.guardar(sesion);

    return {
      previewId,
      archivo: resultado.archivo,
      hojas: resultado.hojas,
      periodo: resultado.periodo,
      resumen: {
        total: visibles.length,
        con_error: conError,
        total_mes: totalMes,
        total_declarado: resultado.total_declarado,
      },
      filas: Array.from(filasMap.values()),
      errores: resultado.errores,
    };
  }

  // -------------------------------------------------------------------
  // CONFIRMAR
  // -------------------------------------------------------------------

  async confirmar(
    dto: ConfirmarCargaDto,
    cert: CertClaim | null,
    cuil: string,
    nombre: string,
  ): Promise<RespuestaConfirmar> {
    // 1) sesión (expirada/inexistente) + 2) ownership por cuil (B1): la
    // misma llamada cubre ambos casos con el mismo mensaje — PreviewStore
    // no distingue "no existe/expiró" de "es de otro cuil", a propósito,
    // para no filtrar si existe una sesión ajena con ese id.
    const sesion = this.store.recuperar(dto.previewId, cuil);
    if (!sesion) throw new BadRequestException(MSG_SESION_EXPIRADA);

    this.exigirNivelCarga(cert);

    // 3) aplicar ediciones — SOLO los 5 campos del DTO, whitelist real (el
    // service nunca hace spread del DTO sobre la fila).
    for (const edicion of dto.ediciones) {
      const fila = sesion.filas.get(edicion.rowId);
      if (!fila) throw new BadRequestException(`Fila desconocida en la sesión: ${edicion.rowId}`);

      if (edicion.contrato !== undefined) {
        fila.contrato = edicion.contrato;
        fila.contrato_fuente = 'editado';
      }
      if (edicion.provincia !== undefined) fila.provincia = edicion.provincia;
      if (edicion.cantidades !== undefined) fila.cantidades = edicion.cantidades;
      if (edicion.total_mes !== undefined) fila.total_mes = edicion.total_mes;
      if (edicion.excluida !== undefined) fila.excluida = edicion.excluida;
    }

    // 4) duplicado por archivo_nombre (global, sin período — paridad con
    // el portal, incluido el falso positivo documentado en el inventario).
    const yaCargado = await this.prisma.certCargaLog.findFirst({
      where: { archivoNombre: sesion.archivo },
      select: { id: true },
    });
    if (yaCargado) {
      const mensaje =
        cert!.nivel === 'admin'
          ? `Ya se cargó un archivo llamado "${sesion.archivo}". Eliminá la carga anterior desde el historial antes de repetirla.`
          : `Ya se cargó un archivo llamado "${sesion.archivo}". Pedile a un administrador que elimine la carga anterior.`;
      throw new BadRequestException(mensaje);
    }

    // 5) re-resolver contrato con ediciones (editado gana) + 6) revalidar
    // TODO server-side (maestro RE-CARGADO en batch — fix B2 — y
    // provincias activas).
    const filas = Array.from(sesion.filas.values());
    const [mapa, provinciasValidas] = await Promise.all([
      this.resolucion.cargarMaestro(filas.map((f) => f.item_codigo)),
      this.provinciasActivas(),
    ]);

    for (const fila of filas) {
      const contratoEditado = fila.contrato_fuente === 'editado' ? fila.contrato : null;
      const { contrato, fuente } = this.resolucion.resolverContratoFinal(
        mapa,
        fila.item_codigo,
        fila.contrato_archivo,
        contratoEditado,
      );
      fila.contrato = contrato ?? '';
      fila.contrato_fuente = fuente;
      fila.item_en_maestro = mapa.existe(fila.item_codigo);

      const { tieneError, detalle } = revalidarFila(fila, {
        itemExiste: fila.item_en_maestro,
        provinciasValidas,
      });
      fila.tiene_error = tieneError;
      fila.error_detalle = detalle;
    }

    // 7) filtrar cargables: descarta excluida (silencioso, es una elección
    // del usuario) + revalidación (ignora el tiene_error que trajera el
    // cliente — acá siempre es el recalculado server-side de arriba). Las
    // filas con error de revalidación (ítem/contrato/provincia/cantidad/
    // total) NO se descartan en silencio: se acumulan en `errores` con
    // contexto real (fixes B2+B5), igual que las que fallen más adelante
    // al resolver ids.
    const errores: ErrorConfirmar[] = [];
    const cargables: FilaPreview[] = [];
    for (const f of filas) {
      if (f.excluida) continue;
      if (f.tiene_error) {
        errores.push({
          hoja: f.hoja_origen,
          fila: f.fila_excel,
          item_codigo: f.item_codigo,
          mensaje: f.error_detalle ?? 'Fila inválida',
        });
        continue;
      }
      cargables.push(f);
    }

    // 8) permisos nivel carga: los Ks resueltos deben ser ⊆ cert.ks, ANTES
    // de insertar nada (fail-closed).
    if (cert!.nivel === 'carga') {
      const ksSet = new Set(cert!.ks);
      for (const f of cargables) {
        if (!ksSet.has(f.contrato)) {
          throw new ForbiddenException(`No tenés acceso al contrato ${f.contrato}`);
        }
      }
    }

    if (cargables.length === 0 && errores.length === 0) {
      throw new UnprocessableEntityException('No hay filas válidas para cargar');
    }

    // 9) resolver ids en batch.
    const idsPorIndice =
      cargables.length > 0
        ? await this.resolucion.resolverIds(
            cargables.map((f) => ({
              item_codigo: f.item_codigo,
              contrato: f.contrato || null,
              provincia: f.provincia,
              ptos_gasnor: f.ptos_gasnor,
            })),
          )
        : new Map();

    const paraInsertar: { fila: FilaPreview; idItem: number; idContrato: number; idProvincia: number; ptosGasnor: string | null }[] = [];

    cargables.forEach((fila, i) => {
      const ids = idsPorIndice.get(i);
      if (!ids || ids.idContrato === null) {
        errores.push({
          hoja: fila.hoja_origen,
          fila: fila.fila_excel,
          item_codigo: fila.item_codigo,
          mensaje: `Contrato ${fila.contrato} no encontrado`,
        });
        return;
      }
      if (ids.idItem === null) {
        errores.push({
          hoja: fila.hoja_origen,
          fila: fila.fila_excel,
          item_codigo: fila.item_codigo,
          mensaje: `Ítem ${fila.item_codigo} no encontrado`,
        });
        return;
      }
      if (ids.idProvincia === null) {
        errores.push({
          hoja: fila.hoja_origen,
          fila: fila.fila_excel,
          item_codigo: fila.item_codigo,
          mensaje: `Provincia '${fila.provincia}' no encontrada`,
        });
        return;
      }
      paraInsertar.push({
        fila,
        idItem: ids.idItem,
        idContrato: ids.idContrato,
        idProvincia: ids.idProvincia,
        ptosGasnor: ids.ptosGasnor,
      });
    });

    if (paraInsertar.length === 0) {
      throw new UnprocessableEntityException('No hay filas válidas para cargar');
    }

    // 10) UNA transacción: multi-INSERT raw + create del log.
    const valores = paraInsertar.map(({ fila, idItem, idContrato, idProvincia, ptosGasnor }) =>
      Prisma.sql`(${idItem}, ${fila.nombre_contrato}, ${fila.tarea}, ${idContrato}, ${fila.unidad_medida}, ${ptosGasnor}, ${fila.tipo}, ${fila.contratista}, ${idProvincia}, ${fila.region}, ${fila.cantidades}, ${fila.precio_unitario}, ${fila.total_mes}, ${fila.observaciones}, ${fila.fecha}, ${fila.hoja_origen}, ${fila.archivo_origen}, ${nombre})`,
    );
    const insertSql = Prisma.sql`
      INSERT INTO sth_cert_certificaciones
        (id_item, nombre_contrato, tarea, id_contrato, unidad_medida, ptos_gasnor, tipo, contratista,
         id_provincia, region, cantidades, precio_unitario, total_mes, observaciones, fecha,
         hoja_origen, archivo_origen, cargado_por)
      VALUES ${Prisma.join(valores)}
    `;

    const ksInsertados = [...new Set(paraInsertar.map((p) => p.fila.contrato))];
    const estado = errores.length > 0 ? 'parcial' : 'ok';
    const periodo = `${sesion.anio}-${pad2(sesion.mes)}`;
    const detalleErrores = errores.length > 0 ? JSON.stringify(errores).slice(0, DETALLE_ERRORES_MAX) : null;

    await this.prisma.$transaction([
      this.prisma.$executeRaw(insertSql),
      this.prisma.certCargaLog.create({
        data: {
          usuarioId: 0, // el claim solo trae cuil (string); sin columna alternativa en el DDL real (mismo criterio que el bug B1 del portal para usuarios de Horas)
          usuarioNombre: nombre,
          archivoNombre: sesion.archivo,
          contrato: ksInsertados.join(','),
          periodo,
          filasCargadas: paraInsertar.length,
          filasError: errores.length,
          estado,
          detalleErrores,
        },
      }),
    ]);

    // 11) limpiar sesión.
    this.store.limpiar(dto.previewId);

    return {
      mensaje: `${paraInsertar.length} filas cargadas correctamente`,
      insertadas: paraInsertar.length,
      omitidas: errores.length,
      errores,
    };
  }
}
