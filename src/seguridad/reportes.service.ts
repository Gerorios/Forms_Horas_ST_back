import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NOVEDAD_ADJUNTO_STORAGE, NovedadAdjuntoStorage } from '../novedades/storage/novedad-adjunto-storage.interface';
import { CalificarReporteDto, FiltrosPanelDto, FotoDto, ReporteDto } from './dto/reporte.dto';
import {
  CAMPOS_POR_TIPO,
  MAX_FOTOS_POR_GRUPO,
  ROL_HYS,
  TIPO_INSPECCION,
  TipoReporte,
  dateADia,
  diaADate,
  erroresDeCampos,
  hoyAr,
  movimientosDe,
  puedeCalificar,
  puedeInspeccionar,
  puntoDelReporte,
} from './reglas';
import { mapaNombres } from './nombres';

/** Mismo almacenamiento en disco que los certificados de novedades, en otra
 * carpeta (SEGURIDAD_FOTOS_DIR). */
export const SEG_FOTO_STORAGE = 'SEG_FOTO_STORAGE';

export interface Usuario {
  cuil: string;
  rol: string;
}

const ROLES_PANEL = new Set([ROL_HYS, 'Admin']);
const TABLA = 'sth_seg_reportes';

const INCLUDE_REPORTE = {
  provincia: { select: { id: true, nombre: true } },
  contrato: { select: { id: true, codigo: true, nombre: true } },
  tarea: { select: { id: true, nombre: true } },
  naturaleza: { select: { id: true, nombre: true } },
  motivoParalizacion: { select: { id: true, nombre: true } },
  involucrados: { select: { cuil: true } },
  fotos: {
    where: { eliminadoEn: null },
    select: { id: true, grupo: true, origen: true, latitud: true, longitud: true, errorMetros: true, subidoEn: true },
    orderBy: { subidoEn: 'asc' as const },
  },
};

type ReporteCrudo = Awaited<ReturnType<PrismaService['segReporte']['findUniqueOrThrow']>> & {
  provincia: { id: number; nombre: string };
  contrato: { id: number; codigo: string; nombre: string };
  tarea: { id: number; nombre: string };
  naturaleza: { id: number; nombre: string } | null;
  motivoParalizacion: { id: number; nombre: string } | null;
  involucrados: { cuil: string }[];
  fotos: {
    id: number;
    grupo: 'riesgo' | 'control';
    origen: 'camara' | 'galeria';
    latitud: unknown;
    longitud: unknown;
    errorMetros: number | null;
    subidoEn: Date;
  }[];
};

/** Lo que el autor declaró: before/after de Auditoría al editar. */
function snapshot(r: {
  tipo: string;
  fechaReporte: Date;
  provinciaId: number;
  contratoId: number;
  tareaId: number;
  ubicacion: string | null;
  latitud: unknown;
  longitud: unknown;
  errorMetros: number | null;
  origenPunto: string | null;
  descripcion: string;
  naturalezaId: number | null;
  motivoParalizacionId: number | null;
  controlRiesgo: string | null;
  involucrados: { cuil: string }[];
}) {
  return {
    tipo: r.tipo,
    fechaReporte: dateADia(r.fechaReporte),
    provinciaId: r.provinciaId,
    contratoId: r.contratoId,
    tareaId: r.tareaId,
    ubicacion: r.ubicacion,
    punto: r.latitud === null ? null : [Number(r.latitud), Number(r.longitud), r.errorMetros, r.origenPunto],
    descripcion: r.descripcion,
    naturalezaId: r.naturalezaId,
    motivoParalizacionId: r.motivoParalizacionId,
    controlRiesgo: r.controlRiesgo,
    involucrados: r.involucrados.map((i) => i.cuil).sort(),
  };
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** El punto del mapa que trae una edición es el que ya estaba guardado (el
 * autor no lo movió). DECIMAL(9,6): se compara a 6 decimales. */
function mismoPunto(
  actual: { latitud: unknown; longitud: unknown; origenPunto: string | null },
  nuevo: { latitud: number | null; longitud: number | null },
): boolean {
  const igual = (a: unknown, b: number | null) => a !== null && b !== null && Math.abs(Number(a) - b) < 5e-7;
  return actual.origenPunto === 'mapa' && igual(actual.latitud, nuevo.latitud) && igual(actual.longitud, nuevo.longitud);
}

@Injectable()
export class ReportesService {
  constructor(
    private prisma: PrismaService,
    @Inject(SEG_FOTO_STORAGE) private fotos: NovedadAdjuntoStorage,
  ) {}

  // ------------------------------------------------------------ presentación

  /** `verCalificador`: solo HyS y Admin ven quién de HyS calificó; el autor
   * ve el puntaje y el comentario, no el nombre (CONTEXT.md, "Mis puntos"). */
  private async presentar(reportes: ReporteCrudo[], verCalificador: boolean) {
    const nombres = await mapaNombres(
      this.prisma,
      reportes.flatMap((r) => [
        r.autorCuil,
        ...(r.calificadoPorCuil ? [r.calificadoPorCuil] : []),
        ...r.involucrados.map((i) => i.cuil),
      ]),
    );
    return reportes.map((r) => {
      const fotos = r.fotos.map((f) => ({
        id: f.id,
        grupo: f.grupo,
        origen: f.origen,
        subidoEn: f.subidoEn,
        latitud: num(f.latitud),
        longitud: num(f.longitud),
        errorMetros: f.errorMetros,
      }));
      return {
        id: r.id,
        tipo: r.tipo,
        estado: r.estado,
        fechaReporte: dateADia(r.fechaReporte),
        enviadoEn: r.createdAt,
        autor: { cuil: r.autorCuil, nombre: nombres.get(r.autorCuil) ?? '' },
        provincia: r.provincia,
        contrato: r.contrato,
        tarea: r.tarea,
        ubicacion: r.ubicacion,
        descripcion: r.descripcion,
        naturaleza: r.naturaleza,
        motivoParalizacion: r.motivoParalizacion,
        controlRiesgo: r.controlRiesgo,
        involucrados: r.involucrados.map((i) => ({ cuil: i.cuil, nombre: nombres.get(i.cuil) ?? '' })),
        fotos: fotos.map(({ latitud, longitud, errorMetros, ...f }) => ({ ...f, conUbicacion: latitud !== null })),
        punto: puntoDelReporte(fotos, {
          latitud: num(r.latitud),
          longitud: num(r.longitud),
          errorMetros: r.errorMetros,
          origen: r.origenPunto,
        }),
        puntaje: r.puntaje,
        comentarioHys: r.comentarioHys,
        calificadoPor: verCalificador && r.calificadoPorCuil ? { cuil: r.calificadoPorCuil, nombre: nombres.get(r.calificadoPorCuil) ?? '' } : null,
        calificadoEn: r.calificadoEn,
        motivoAnulacion: r.motivoAnulacion,
        // La única urgencia que marca el panel (CONTEXT.md, "Alarma").
        alarma: r.tipo === 'paralizacion' && r.estado === 'pendiente',
      };
    });
  }

  private async cargar(id: number): Promise<ReporteCrudo> {
    const r = await this.prisma.segReporte.findUnique({ where: { id }, include: INCLUDE_REPORTE });
    if (!r) throw new NotFoundException('Reporte no encontrado');
    return r as ReporteCrudo;
  }

  private verificarLectura(r: { autorCuil: string }, usuario: Usuario) {
    if (r.autorCuil !== usuario.cuil && !ROLES_PANEL.has(usuario.rol)) {
      throw new ForbiddenException('Solo el autor, HyS y Admin ven este reporte');
    }
  }

  /** Lo que el autor puede tocar: solo lo suyo y solo mientras está
   * pendiente (calificado, queda fijo; para corregirlo HyS lo reabre). */
  private verificarEdicion(r: { autorCuil: string; estado: string }, usuario: Usuario) {
    if (r.autorCuil !== usuario.cuil) throw new ForbiddenException('Solo el autor puede modificar su reporte');
    if (r.estado !== 'pendiente') {
      throw new BadRequestException('El reporte ya fue calificado o anulado: no se puede modificar');
    }
  }

  // ---------------------------------------------------------- validaciones

  /** Habilitado por HyS para cargar inspecciones (ADR-027, 2026-10-08). */
  async esInspector(cuil: string): Promise<boolean> {
    return (await this.prisma.segInspector.findUnique({ where: { cuil }, select: { cuil: true } })) != null;
  }

  /** `correccion`: la hace HyS/Admin sobre un reporte ajeno; puede llevarlo a
   * inspección aunque el autor no sea inspector (es una reclasificación). */
  private async validar(dto: ReporteDto, usuario: Usuario, correccion = false) {
    if (dto.tipo === TIPO_INSPECCION && !correccion && !puedeInspeccionar(usuario.rol, await this.esInspector(usuario.cuil))) {
      throw new ForbiddenException('Solo HyS y los inspectores habilitados cargan inspecciones de seguridad');
    }
    const tienePunto = dto.latitud !== undefined || dto.longitud !== undefined;
    if (tienePunto && (dto.latitud === undefined || dto.longitud === undefined)) {
      throw new BadRequestException('La ubicación necesita latitud y longitud');
    }
    // Un punto marcado en el mapa no tiene precisión de GPS: no lleva error.
    const origenPunto = tienePunto ? (dto.origenPunto ?? 'gps') : null;
    const involucrados = [...new Set(dto.involucrados ?? [])];
    // Al corregir, HyS no está en la obra: no se le exige el punto GPS (si
    // pasa un aviso a paralización, el punto queda el que haya).
    const errores = erroresDeCampos({ ...dto, involucrados, tienePunto: tienePunto || correccion });
    if (errores.length) throw new BadRequestException(errores.join('. '));

    const fecha = dto.fechaReporte.slice(0, 10);
    if (fecha > hoyAr()) throw new BadRequestException('La fecha del reporte no puede ser futura');

    const [provincia, tarea, naturaleza, motivo, enNomina] = await Promise.all([
      this.prisma.provincia.findUnique({ where: { id: dto.provinciaId }, select: { id: true } }),
      this.prisma.tareaCatalogo.findUnique({
        where: { id: dto.tareaId },
        select: { contratoId: true, activo: true, contrato: { select: { activo: true } } },
      }),
      dto.naturalezaId ? this.prisma.segNaturaleza.findUnique({ where: { id: dto.naturalezaId }, select: { activo: true } }) : null,
      dto.motivoParalizacionId
        ? this.prisma.segMotivoParalizacion.findUnique({ where: { id: dto.motivoParalizacionId }, select: { activo: true } })
        : null,
      involucrados.length
        ? this.prisma.snuempleados.findMany({ where: { cuil: { in: involucrados } }, select: { cuil: true } })
        : [],
    ]);
    if (!provincia) throw new BadRequestException('Provincia inválida');
    if (!tarea || tarea.contratoId !== dto.contratoId) throw new BadRequestException('La tarea no pertenece a ese contrato');
    if (!tarea.activo || !tarea.contrato.activo) throw new BadRequestException('El contrato o la tarea ya no están activos');
    if (dto.naturalezaId && !naturaleza?.activo) throw new BadRequestException('Naturaleza inválida');
    if (dto.motivoParalizacionId && !motivo?.activo) throw new BadRequestException('Motivo de paralización inválido');
    if (enNomina.length !== involucrados.length) throw new BadRequestException('Alguna persona involucrada no está en la nómina');

    return {
      data: {
        tipo: dto.tipo,
        fechaReporte: diaADate(fecha),
        provinciaId: dto.provinciaId,
        contratoId: dto.contratoId,
        tareaId: dto.tareaId,
        ubicacion: dto.ubicacion?.trim() || null,
        latitud: tienePunto ? dto.latitud! : null,
        longitud: tienePunto ? dto.longitud! : null,
        errorMetros: origenPunto === 'gps' && dto.errorMetros !== undefined ? Math.round(dto.errorMetros) : null,
        origenPunto,
        descripcion: dto.descripcion.trim(),
        naturalezaId: dto.naturalezaId ?? null,
        motivoParalizacionId: dto.motivoParalizacionId ?? null,
        controlRiesgo: dto.controlRiesgo?.trim() || null,
      },
      involucrados,
    };
  }

  // ------------------------------------------------------------- el autor

  async crear(dto: ReporteDto, usuario: Usuario) {
    const { data, involucrados } = await this.validar(dto, usuario);
    const creado = await this.prisma.$transaction(async (tx) => {
      const r = await tx.segReporte.create({ data: { ...data, autorCuil: usuario.cuil } });
      if (involucrados.length) {
        await tx.segReporteInvolucrado.createMany({ data: involucrados.map((cuil) => ({ reporteId: r.id, cuil })) });
      }
      await tx.auditoria.create({
        data: { tabla: TABLA, registroId: r.id, usuarioCuil: usuario.cuil, accion: 'crear', campo: 'tipo', valorNuevo: r.tipo },
      });
      return r;
    });
    return this.detalle(creado.id, usuario);
  }

  async editar(id: number, dto: ReporteDto, usuario: Usuario) {
    const actual = await this.cargar(id);
    this.verificarEdicion(actual, usuario);
    const { data, involucrados } = await this.validar(dto, usuario);
    if (data.origenPunto === 'mapa' && !mismoPunto(actual, data)) {
      throw new ForbiddenException('Una vez enviado, el punto en el mapa solo lo corrige HyS');
    }
    if (!CAMPOS_POR_TIPO[dto.tipo].fotosControl && actual.fotos.some((f) => f.grupo === 'control')) {
      throw new BadRequestException('Este tipo de reporte no lleva fotos del control: quitalas antes de cambiar el tipo');
    }
    await this.prisma.$transaction(async (tx) => {
      const nuevo = await tx.segReporte.update({ where: { id }, data });
      await tx.segReporteInvolucrado.deleteMany({ where: { reporteId: id } });
      if (involucrados.length) {
        await tx.segReporteInvolucrado.createMany({ data: involucrados.map((cuil) => ({ reporteId: id, cuil })) });
      }
      await tx.auditoria.create({
        data: {
          tabla: TABLA,
          registroId: id,
          usuarioCuil: usuario.cuil,
          accion: 'editar',
          campo: 'reporte',
          valorAnterior: JSON.stringify(snapshot(actual)),
          valorNuevo: JSON.stringify(snapshot({ ...nuevo, involucrados: involucrados.map((cuil) => ({ cuil })) })),
        },
      });
    });
    return this.detalle(id, usuario);
  }

  /**
   * HyS (o Admin) corrige un reporte ajeno, en cualquier estado salvo
   * anulado (ADR-027, revisión 2026-10-08): los operarios confunden tipos.
   * Lo que el tipo nuevo no admite se descarta (las fotos del control, con
   * baja lógica), y si estaba aprobado los movimientos se recalculan en la
   * misma transacción. La auditoría guarda el antes y el después.
   */
  async corregir(id: number, dto: ReporteDto, usuario: Usuario) {
    const actual = await this.cargar(id);
    if (actual.estado === 'anulado') throw new BadRequestException('El reporte está anulado: no se corrige');
    const { data, involucrados } = await this.validar(dto, usuario, true);
    const sacarFotosControl = !CAMPOS_POR_TIPO[dto.tipo].fotosControl && actual.fotos.some((f) => f.grupo === 'control');
    const movimientos =
      actual.estado === 'aprobado'
        ? movimientosDe({ tipo: dto.tipo, estado: 'aprobado', autorCuil: actual.autorCuil, puntaje: actual.puntaje, involucrados })
        : null;

    await this.prisma.$transaction(async (tx) => {
      const nuevo = await tx.segReporte.update({ where: { id }, data });
      await tx.segReporteInvolucrado.deleteMany({ where: { reporteId: id } });
      if (involucrados.length) {
        await tx.segReporteInvolucrado.createMany({ data: involucrados.map((cuil) => ({ reporteId: id, cuil })) });
      }
      if (sacarFotosControl) {
        await tx.segReporteFoto.updateMany({
          where: { reporteId: id, grupo: 'control', eliminadoEn: null },
          data: { eliminadoEn: new Date(), eliminadoPorCuil: usuario.cuil },
        });
      }
      if (movimientos) {
        await tx.segMovimientoPuntos.deleteMany({ where: { reporteId: id } });
        if (movimientos.length) {
          await tx.segMovimientoPuntos.createMany({
            data: movimientos.map((m) => ({ reporteId: id, cuil: m.cuil, fecha: data.fechaReporte, puntos: m.puntos })),
          });
        }
      }
      await tx.auditoria.create({
        data: {
          tabla: TABLA,
          registroId: id,
          usuarioCuil: usuario.cuil,
          accion: 'editar',
          campo: 'correccion_hys',
          valorAnterior: JSON.stringify(snapshot(actual)),
          valorNuevo: JSON.stringify(snapshot({ ...nuevo, involucrados: involucrados.map((cuil) => ({ cuil })) })),
        },
      });
    });
    return this.detalle(id, usuario);
  }

  /** El autor retira su reporte pendiente (duplicado o error). No genera
   * movimientos y queda guardado. */
  async anular(id: number, motivo: string, usuario: Usuario) {
    const actual = await this.cargar(id);
    this.verificarEdicion(actual, usuario);
    await this.prisma.$transaction(async (tx) => {
      await tx.segReporte.update({
        where: { id },
        data: { estado: 'anulado', motivoAnulacion: motivo.trim(), anuladoEn: new Date() },
      });
      await tx.auditoria.create({
        data: {
          tabla: TABLA, registroId: id, usuarioCuil: usuario.cuil, accion: 'anular',
          campo: 'estado', valorAnterior: 'pendiente', valorNuevo: 'anulado',
        },
      });
    });
    return this.detalle(id, usuario);
  }

  async mios(usuario: Usuario) {
    const reportes = await this.prisma.segReporte.findMany({
      where: { autorCuil: usuario.cuil },
      include: INCLUDE_REPORTE,
      orderBy: { createdAt: 'desc' },
    });
    return this.presentar(reportes as ReporteCrudo[], ROLES_PANEL.has(usuario.rol));
  }

  async detalle(id: number, usuario: Usuario) {
    const r = await this.cargar(id);
    this.verificarLectura(r, usuario);
    return (await this.presentar([r], ROLES_PANEL.has(usuario.rol)))[0];
  }

  // ----------------------------------------------------------------- fotos

  async agregarFoto(
    id: number,
    archivo: { buffer: Buffer; mimetype: 'image/jpeg' | 'image/png' },
    meta: FotoDto,
    usuario: Usuario,
  ) {
    const r = await this.cargar(id);
    this.verificarEdicion(r, usuario);
    if (meta.grupo === 'control' && !CAMPOS_POR_TIPO[r.tipo as TipoReporte].fotosControl) {
      throw new BadRequestException('Este tipo de reporte no lleva fotos del control');
    }
    if (r.fotos.filter((f) => f.grupo === meta.grupo).length >= MAX_FOTOS_POR_GRUPO) {
      throw new BadRequestException(`Ya hay ${MAX_FOTOS_POR_GRUPO} fotos en ese grupo: quitá una antes de subir otra`);
    }
    const conUbicacion = meta.latitud !== undefined || meta.longitud !== undefined || meta.errorMetros !== undefined;
    if (conUbicacion && meta.origen !== 'camara') {
      throw new BadRequestException('Solo una foto sacada con la cámara lleva ubicación');
    }
    if (conUbicacion && (meta.latitud === undefined || meta.longitud === undefined)) {
      throw new BadRequestException('La ubicación necesita latitud y longitud');
    }

    const path = await this.fotos.guardar(archivo.buffer, archivo.mimetype);
    await this.prisma.$transaction(async (tx) => {
      const foto = await tx.segReporteFoto.create({
        data: {
          reporteId: id,
          grupo: meta.grupo,
          origen: meta.origen,
          path,
          mimetype: archivo.mimetype,
          latitud: meta.latitud ?? null,
          longitud: meta.longitud ?? null,
          errorMetros: conUbicacion ? (meta.errorMetros ?? null) : null,
          subidoPorCuil: usuario.cuil,
        },
      });
      await tx.auditoria.create({
        data: {
          tabla: TABLA, registroId: id, usuarioCuil: usuario.cuil, accion: 'adjuntar',
          campo: `foto_${meta.grupo}`, valorNuevo: String(foto.id),
        },
      });
    });
    return this.detalle(id, usuario);
  }

  /** Baja lógica: el archivo queda en disco, como los certificados. */
  async quitarFoto(id: number, fotoId: number, usuario: Usuario) {
    const r = await this.cargar(id);
    this.verificarEdicion(r, usuario);
    if (!r.fotos.some((f) => f.id === fotoId)) throw new NotFoundException('Foto no encontrada');
    await this.prisma.$transaction(async (tx) => {
      await tx.segReporteFoto.update({
        where: { id: fotoId },
        data: { eliminadoEn: new Date(), eliminadoPorCuil: usuario.cuil },
      });
      await tx.auditoria.create({
        data: {
          tabla: TABLA, registroId: id, usuarioCuil: usuario.cuil, accion: 'quitar_adjunto',
          campo: 'foto', valorAnterior: String(fotoId),
        },
      });
    });
    return this.detalle(id, usuario);
  }

  async leerFoto(id: number, fotoId: number, usuario: Usuario) {
    const r = await this.prisma.segReporte.findUnique({ where: { id }, select: { autorCuil: true } });
    if (!r) throw new NotFoundException('Reporte no encontrado');
    this.verificarLectura(r, usuario);
    const foto = await this.prisma.segReporteFoto.findFirst({
      where: { id: fotoId, reporteId: id, eliminadoEn: null },
      select: { path: true },
    });
    if (!foto) throw new NotFoundException('Foto no encontrada');
    return this.fotos.leer(foto.path);
  }

  // ------------------------------------------------------------ panel HyS

  async panel(filtros: FiltrosPanelDto) {
    const reportes = await this.prisma.segReporte.findMany({
      where: {
        ...(filtros.estado ? { estado: filtros.estado as any } : {}),
        ...(filtros.tipo ? { tipo: filtros.tipo } : {}),
        ...(filtros.desde || filtros.hasta
          ? {
              fechaReporte: {
                ...(filtros.desde ? { gte: diaADate(filtros.desde.slice(0, 10)) } : {}),
                ...(filtros.hasta ? { lte: diaADate(filtros.hasta.slice(0, 10)) } : {}),
              },
            }
          : {}),
      },
      include: INCLUDE_REPORTE,
      orderBy: { createdAt: 'desc' },
    });
    const presentados = await this.presentar(reportes as ReporteCrudo[], true);
    // Las alarmas (paralizaciones pendientes) arriba de todo; el resto, el
    // último enviado primero. sort es estable: conserva ese orden.
    return presentados.sort((a, b) => Number(b.alarma) - Number(a.alarma));
  }

  /**
   * Aprueba con puntaje o desaprueba. También recalifica uno ya calificado.
   * Los movimientos de puntos se reescriben en la MISMA transacción: es el
   * único lugar que los escribe (ADR-027).
   */
  async calificar(id: number, dto: CalificarReporteDto, usuario: Usuario) {
    const r = await this.cargar(id);
    if (r.estado === 'anulado') throw new BadRequestException('El reporte está anulado');
    if (!puedeCalificar({ tipo: r.tipo as TipoReporte, autorCuil: r.autorCuil }, usuario.cuil)) {
      throw new ForbiddenException('No podés calificar tu propio reporte');
    }
    const aprobar = dto.decision === 'aprobar';
    const estado = aprobar ? 'aprobado' : 'desaprobado';
    const puntaje = aprobar ? dto.puntaje! : null;
    const movimientos = movimientosDe({
      tipo: r.tipo as TipoReporte,
      estado,
      autorCuil: r.autorCuil,
      puntaje,
      involucrados: r.involucrados.map((i) => i.cuil),
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.segReporte.update({
        where: { id },
        data: {
          estado,
          puntaje,
          comentarioHys: dto.comentario?.trim() || null,
          calificadoPorCuil: usuario.cuil,
          calificadoEn: new Date(),
        },
      });
      await tx.segMovimientoPuntos.deleteMany({ where: { reporteId: id } });
      if (movimientos.length) {
        await tx.segMovimientoPuntos.createMany({
          data: movimientos.map((m) => ({ reporteId: id, cuil: m.cuil, fecha: r.fechaReporte, puntos: m.puntos })),
        });
      }
      await tx.auditoria.create({
        data: {
          tabla: TABLA, registroId: id, usuarioCuil: usuario.cuil,
          accion: aprobar ? 'aprobar' : 'desaprobar', campo: 'puntaje',
          valorAnterior: r.estado === 'pendiente' ? null : `${r.estado}:${r.puntaje ?? ''}`,
          valorNuevo: `${estado}:${puntaje ?? ''}`,
        },
      });
    });
    return this.detalle(id, usuario);
  }

  /** Vuelve a pendiente un reporte calificado (reclamo o error de HyS): borra
   * sus movimientos y el autor puede corregirlo. */
  async reabrir(id: number, usuario: Usuario) {
    const r = await this.cargar(id);
    if (r.estado !== 'aprobado' && r.estado !== 'desaprobado') {
      throw new BadRequestException('Solo se reabre un reporte aprobado o desaprobado');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.segReporte.update({
        where: { id },
        data: { estado: 'pendiente', puntaje: null, comentarioHys: null, calificadoPorCuil: null, calificadoEn: null },
      });
      await tx.segMovimientoPuntos.deleteMany({ where: { reporteId: id } });
      await tx.auditoria.create({
        data: {
          tabla: TABLA, registroId: id, usuarioCuil: usuario.cuil, accion: 'reabrir',
          campo: 'estado', valorAnterior: `${r.estado}:${r.puntaje ?? ''}`, valorNuevo: 'pendiente',
        },
      });
    });
    return this.detalle(id, usuario);
  }
}
