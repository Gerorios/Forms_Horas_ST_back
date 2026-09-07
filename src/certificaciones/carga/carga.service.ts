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
import { AvisoParseo, ErrorParseo, FilaParseada, PeriodoArchivo } from './parser-tipos';
import { parsearExcel } from './parser-excel';
import { parsearPdf } from './parser-pdf';
import { esFilaPlantilla, revalidarFila } from './validacion';
import { avisoKNombre, avisoPeriodo } from './avisos';
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
  /** Alias de `con_error` (mismo número) bajo el nombre que consume el
   * frontend nuevo — se mantiene `con_error` por compatibilidad. */
  bloqueadas: number;
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
  avisos: AvisoParseo[];
  columnas_ignoradas: string[];
  periodo_archivo: PeriodoArchivo | null;
  k_nombre_archivo: string | null;
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
  /** Cuántas de las insertadas son filas manuales (`origen = 'manual'`). */
  manuales: number;
  errores: ErrorConfirmar[];
}

/** Fila que quedó bloqueada al confirmar (rechazo 422, spec §2.9). */
export interface FilaBloqueada {
  rowId: string;
  item_codigo: string;
  detalle: string;
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
      const { tieneError, detalle, cuadratura } = revalidarFila(filaResuelta, {
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
        cuadratura,
        confirmada: false,
        origen: 'archivo',
      };
      filasMap.set(rowId, filaPreview);

      if (tieneError) conError++;
      else totalMes += num(filaPreview.total_mes);
    }

    const ksResueltos = [
      ...new Set(Array.from(filasMap.values()).map((f) => f.contrato).filter(Boolean)),
    ];
    const avisos = [...resultado.avisos];
    const aK = avisoKNombre(resultado.k_nombre_archivo, ksResueltos, resultado.archivo);
    if (aK) avisos.push(aK);
    const aP = avisoPeriodo(resultado.periodo_archivo, anio, mes, resultado.archivo);
    if (aP) avisos.push(aP);

    const previewId = randomUUID();
    const sesion: PreviewSession = {
      id: previewId,
      ownerCuil: cuil,
      archivo: nombreArchivo,
      anio,
      mes,
      filas: filasMap,
      creadaEn: Date.now(),
      total_declarado: resultado.total_declarado,
      k_nombre_archivo: resultado.k_nombre_archivo,
      periodo_archivo: resultado.periodo_archivo,
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
        bloqueadas: conError,
        total_mes: totalMes,
        total_declarado: resultado.total_declarado,
      },
      filas: Array.from(filasMap.values()),
      errores: resultado.errores,
      avisos,
      columnas_ignoradas: resultado.columnas_ignoradas,
      periodo_archivo: resultado.periodo_archivo,
      k_nombre_archivo: resultado.k_nombre_archivo,
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

    // 3) aplicar ediciones — SOLO los 8 campos del DTO, whitelist real (el
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
      if (edicion.precio_unitario !== undefined) fila.precio_unitario = edicion.precio_unitario;
      if (edicion.item_codigo !== undefined) fila.item_codigo = edicion.item_codigo.trim();
      if (edicion.confirmada !== undefined) fila.confirmada = edicion.confirmada;
    }

    // 4) duplicado por archivo_nombre (global, sin período — paridad con
    // el portal, incluido el falso positivo documentado en el inventario).
    const yaCargado = await this.prisma.certCargaLog.findFirst({
      where: { archivoNombre: sesion.archivo },
      select: { id: true },
    });
    if (yaCargado) {
      // Paridad textual exacta con el portal (app/routers/certificaciones.py
      // líneas 23-29, `mensaje_archivo_duplicado`).
      const base = `El archivo '${sesion.archivo}' ya fue cargado anteriormente. `;
      const mensaje =
        cert!.nivel === 'admin'
          ? base + 'Si necesitás reemplazarlo, eliminá la carga anterior desde el historial.'
          : base + 'Si necesitás reemplazarlo, pedile a un administrador que elimine la carga anterior desde el historial.';
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

      const { tieneError, detalle, cuadratura } = revalidarFila(fila, {
        itemExiste: fila.item_en_maestro,
        provinciasValidas,
        confirmada: fila.confirmada,
      });
      fila.tiene_error = tieneError;
      fila.error_detalle = detalle;
      fila.cuadratura = cuadratura;
    }

    // 6b) filas manuales (spec §2.8): el body solo trae id de ítem +
    // cifras; TODO el resto del ítem sale del maestro, así el navegador no
    // puede inventar código/K/tarea. Se validan con las mismas reglas que
    // las del archivo (`confirmada` levanta solo la cuadratura).
    const manualesDto = dto.manuales ?? [];
    const itemsPorId = await this.resolucion.cargarItemsPorId(manualesDto.map((m) => m.id_item));
    const manuales: FilaPreview[] = [];
    // rowId de la manual -> id_item/id_contrato EXACTOS que eligió el usuario
    // en la UI (`cargarItemsPorId`). Se usan en el INSERT en vez de lo que
    // `resolverIds` elegiría por código+K, porque un código puede estar
    // duplicado dentro de un mismo K (ver P1 del review de Task 12): el
    // usuario ya vio y eligió un `id_item` puntual, y ese es el que se debe
    // guardar, no "cualquiera que matchee código+K".
    const idsManualesPorRowId = new Map<string, { idItem: number; idContrato: number }>();
    for (const m of manualesDto) {
      const it = itemsPorId.get(m.id_item);
      if (!it) throw new BadRequestException(`Ítem del maestro inexistente: ${m.id_item}`);
      if (cert!.nivel === 'carga' && !cert!.ks.includes(it.codigo_k)) {
        throw new ForbiddenException(`No tenés acceso al contrato ${it.codigo_k}`);
      }

      const base: FilaParseada = {
        hoja_origen: 'manual',
        archivo_origen: sesion.archivo,
        item_codigo: it.item_codigo,
        nombre_contrato: null,
        tarea: it.tarea,
        contrato: it.codigo_k,
        unidad_medida: it.unidad_medida,
        ptos_gasnor: it.ptos_gasnor,
        tipo: it.tipo,
        contratista: it.contratista,
        provincia: m.provincia.trim(),
        region: '',
        cantidades: m.cantidades.trim(),
        precio_unitario: m.precio_unitario.trim(),
        total_mes: m.total_mes.trim(),
        observaciones: m.observaciones?.trim() || null,
        fecha: `${sesion.anio}-${pad2(sesion.mes)}-01`,
        nro_np: null,
        tiene_error: false,
        fila_excel: 0,
      };
      const { tieneError, detalle, cuadratura } = revalidarFila(base, {
        itemExiste: true,
        provinciasValidas,
        confirmada: !!m.confirmada,
      });
      const rowId = `manual-${manuales.length + 1}`;
      manuales.push({
        ...base,
        rowId,
        item_en_maestro: true,
        error_detalle: detalle,
        tiene_error: tieneError,
        contrato_archivo: it.codigo_k,
        contrato_fuente: 'maestro',
        contrato_del_maestro: it.codigo_k,
        excluida: false,
        cuadratura,
        confirmada: !!m.confirmada,
        origen: 'manual',
      });
      idsManualesPorRowId.set(rowId, { idItem: it.id_item, idContrato: it.id_contrato });
    }

    // 7) bloqueadas RECHAZAN la carga entera (spec §2.9): cualquier fila no
    // excluida —del archivo o manual— con error server-side devuelve 422 con
    // la lista de rowIds, en vez de omitirse en silencio. La exclusión sigue
    // siendo silenciosa: es una elección explícita del usuario.
    const todas = [...filas, ...manuales];
    const bloqueadas: FilaBloqueada[] = todas
      .filter((f) => !f.excluida && f.tiene_error)
      .map((f) => ({
        rowId: f.rowId,
        item_codigo: f.item_codigo,
        detalle: f.error_detalle ?? 'Fila inválida',
      }));
    if (bloqueadas.length > 0) {
      throw new UnprocessableEntityException({
        message: `Hay ${bloqueadas.length} ${bloqueadas.length === 1 ? 'fila bloqueada' : 'filas bloqueadas'}. Corregilas, confirmalas o excluilas antes de cargar.`,
        bloqueadas,
      });
    }

    // `errores` queda solo para los fallos de resolución de ids (paso 9),
    // que siguen omitiendo la fila y marcando la carga como 'parcial'.
    const errores: ErrorConfirmar[] = [];
    const cargables: FilaPreview[] = todas.filter((f) => !f.excluida);

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

    if (cargables.length === 0) {
      throw new UnprocessableEntityException('No hay filas válidas para cargar');
    }

    // 9) resolver ids en batch — las manuales pasan por el MISMO
    // `resolverIds` (una sola query batch para archivo+manuales) para
    // resolver id_provincia y ptos_gasnor, PERO su id_item/id_contrato para
    // el INSERT vienen de `idsManualesPorRowId` (el ítem exacto que eligió
    // el usuario en la UI, vía `cargarItemsPorId`), NO de lo que
    // `resolverIds` matchee por código+K — un código puede estar duplicado
    // dentro de un mismo K, y en ese caso "por código+K" podría elegir un
    // id_item distinto al que la persona realmente seleccionó.
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
      if (!ids) return; // resolverIds siempre devuelve una entrada por índice

      const idsManual = fila.origen === 'manual' ? idsManualesPorRowId.get(fila.rowId) : undefined;
      const idContrato = idsManual ? idsManual.idContrato : ids.idContrato;
      const idItem = idsManual ? idsManual.idItem : ids.idItem;

      if (idContrato === null) {
        errores.push({
          hoja: fila.hoja_origen,
          fila: fila.fila_excel,
          item_codigo: fila.item_codigo,
          mensaje: `Contrato ${fila.contrato} no encontrado`,
        });
        return;
      }
      if (idItem === null) {
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
        idItem,
        idContrato,
        idProvincia: ids.idProvincia,
        ptosGasnor: ids.ptosGasnor,
      });
    });

    if (paraInsertar.length === 0) {
      throw new UnprocessableEntityException('No hay filas válidas para cargar');
    }

    // 10) UNA transacción: multi-INSERT raw + create del log.
    const valores = paraInsertar.map(({ fila, idItem, idContrato, idProvincia, ptosGasnor }) =>
      Prisma.sql`(${idItem}, ${fila.nombre_contrato}, ${fila.tarea}, ${idContrato}, ${fila.unidad_medida}, ${ptosGasnor}, ${fila.tipo}, ${fila.contratista}, ${idProvincia}, ${fila.region}, ${fila.cantidades}, ${fila.precio_unitario}, ${fila.total_mes}, ${fila.observaciones}, ${fila.fecha}, ${fila.hoja_origen}, ${fila.archivo_origen}, ${nombre}, ${fila.origen})`,
    );
    const insertSql = Prisma.sql`
      INSERT INTO sth_cert_certificaciones
        (id_item, nombre_contrato, tarea, id_contrato, unidad_medida, ptos_gasnor, tipo, contratista,
         id_provincia, region, cantidades, precio_unitario, total_mes, observaciones, fecha,
         hoja_origen, archivo_origen, cargado_por, origen)
      VALUES ${Prisma.join(valores)}
    `;

    const ksInsertados = [...new Set(paraInsertar.map((p) => p.fila.contrato))];
    const filasManuales = paraInsertar.filter((p) => p.fila.origen === 'manual').length;
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
          filasManuales,
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
      manuales: filasManuales,
      errores,
    };
  }
}
