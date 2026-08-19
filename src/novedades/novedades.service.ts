import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNovedadDto } from './dto/create-novedad.dto';
import { UpdateNovedadDto } from './dto/update-novedad.dto';
import { ResolverNovedadDto } from './dto/resolver-novedad.dto';
import { rangoQuincena } from '../common/quincena';
import { CalculoService } from '../liquidacion/calculo.service';
import { NOVEDAD_ADJUNTO_STORAGE, NovedadAdjuntoStorage } from './storage/novedad-adjunto-storage.interface';

const INCLUDE_BASICO = {
  operario: { select: { cuil: true, apellido_nombre: true } },
  tipoNovedad: { select: { id: true, nombre: true, requiereAprobacionHys: true } },
  cargadoPor: { select: { cuil: true, email: true } },
};

// Snapshot de los campos editables de una novedad, para el before/after de Auditoría.
function snapshot(n: {
  operarioCuil: string;
  tipoNovedadId: number;
  fechaInicio: Date;
  fechaFin: Date | null;
  justificacionTexto: string | null;
  adjuntoUrl: string | null;
  estadoHys: string;
}) {
  return {
    operarioCuil: n.operarioCuil,
    tipoNovedadId: n.tipoNovedadId,
    fechaInicio: n.fechaInicio,
    fechaFin: n.fechaFin,
    justificacionTexto: n.justificacionTexto,
    adjuntoUrl: n.adjuntoUrl,
    estadoHys: n.estadoHys,
  };
}

export interface ResumenAusenciaOperario {
  operarioCuil: string;
  apellidoNombre: string;
  legajo: number;
  diasJustificados: number;
  diasInjustificados: number;
  diasPendientes: number;
}

@Injectable()
export class NovedadesService {
  constructor(
    private prisma: PrismaService,
    private calculo: CalculoService,
    @Inject(NOVEDAD_ADJUNTO_STORAGE) private adjuntoStorage: NovedadAdjuntoStorage,
  ) {}

  async create(
    dto: CreateNovedadDto,
    adjunto: { buffer: Buffer; mimetype: 'image/jpeg' | 'image/png' | 'application/pdf' } | undefined,
    usuario: { cuil: string; rol: string },
  ) {
    const tipo = await this.prisma.tipoNovedad.findUnique({
      where: { id: dto.tipoNovedadId },
    });
    if (!tipo) throw new NotFoundException('Tipo de novedad no encontrado');

    // Solo JefeCuadrilla se restringe a los tipos que le habilitaron (ver
    // ADR-007); Supervisor/JefeContrato/Admin siguen sin restricción.
    if (usuario.rol === 'JefeCuadrilla') {
      const habilitado = await this.prisma.tipoNovedadHabilitado.findUnique({
        where: {
          usuarioCuil_tipoNovedadId: {
            usuarioCuil: usuario.cuil,
            tipoNovedadId: dto.tipoNovedadId,
          },
        },
      });
      if (!habilitado) {
        throw new ForbiddenException('No tenés habilitado ese tipo de novedad');
      }
    }

    const estadoHys = tipo.requiereAprobacionHys ? 'pendiente' : 'no_aplica';
    const cargadoPorCuil = usuario.cuil;

    // El adjunto se guarda en disco recién acá (no antes de validar tipo/permiso)
    // para no dejar archivos huérfanos si la carga termina rechazada.
    const adjuntoUrl = adjunto ? await this.adjuntoStorage.guardar(adjunto.buffer, adjunto.mimetype) : undefined;

    return this.prisma.novedad.create({
      data: {
        operarioCuil: dto.operarioCuil,
        tipoNovedadId: dto.tipoNovedadId,
        fechaInicio: new Date(dto.fechaInicio),
        fechaFin: dto.fechaFin ? new Date(dto.fechaFin) : null,
        cargadoPorCuil,
        justificacionTexto: dto.justificacionTexto,
        adjuntoUrl,
        estadoHys: estadoHys as any,
      },
      include: INCLUDE_BASICO,
    });
  }

  findAll(
    filtros: {
      operarioCuil?: string;
      estadoHys?: string;
      periodo?: { anio: number; mes: number; quincena: number };
    },
    usuario: { cuil: string; rol: string },
  ) {
    // Sin período: todas (sin acotar por fecha). Con período: novedades que
    // SE SUPERPONEN con la quincena (no solo las que arrancan ahí) — mismo
    // criterio que ya usa CalculoService para el motor de liquidación.
    const rango = filtros.periodo
      ? rangoQuincena(filtros.periodo.anio, filtros.periodo.mes, filtros.periodo.quincena)
      : null;

    return this.prisma.novedad.findMany({
      where: {
        ...(filtros.operarioCuil ? { operarioCuil: filtros.operarioCuil } : {}),
        ...(filtros.estadoHys ? { estadoHys: filtros.estadoHys as any } : {}),
        // JefeCuadrilla puede cargar (ver ADR-007) pero solo ve lo que él mismo
        // cargó, no el listado completo — mismo criterio que "Cargas que hice"
        // para horas (ADR-001). El resto de los roles con acceso ven todo.
        ...(usuario.rol === 'JefeCuadrilla' ? { cargadoPorCuil: usuario.cuil } : {}),
        ...(rango
          ? {
              fechaInicio: { lte: rango.hasta },
              OR: [{ fechaFin: { gte: rango.desde } }, { fechaFin: null, fechaInicio: { gte: rango.desde } }],
            }
          : {}),
      },
      include: INCLUDE_BASICO,
      orderBy: { fechaInicio: 'desc' },
    });
  }

  /**
   * Edición completa de una novedad (Admin). Igual regla que "corregir" en
   * registros-horas: si ya estaba resuelta por HyS (aprobada/desaprobada), la
   * edición la vuelve a `pendiente` y limpia la resolución previa. Deja
   * auditoría con el snapshot antes/después.
   */
  async update(
    id: number,
    dto: UpdateNovedadDto,
    adjunto: { buffer: Buffer; mimetype: 'image/jpeg' | 'image/png' | 'application/pdf' } | undefined,
    usuario: { cuil: string; rol: string },
  ) {
    const novedad = await this.prisma.novedad.findUnique({ where: { id } });
    if (!novedad) throw new NotFoundException('Novedad no encontrada');

    let adjuntoUrl = novedad.adjuntoUrl;
    if (adjunto) {
      if (novedad.adjuntoUrl) {
        await this.adjuntoStorage.borrar(novedad.adjuntoUrl);
      }
      adjuntoUrl = await this.adjuntoStorage.guardar(adjunto.buffer, adjunto.mimetype);
    }

    const yaResuelta = novedad.estadoHys === 'aprobada' || novedad.estadoHys === 'desaprobada';

    const updated = await this.prisma.novedad.update({
      where: { id },
      data: {
        operarioCuil: dto.operarioCuil ?? undefined,
        tipoNovedadId: dto.tipoNovedadId ?? undefined,
        fechaInicio: dto.fechaInicio ? new Date(dto.fechaInicio) : undefined,
        fechaFin: dto.fechaFin ? new Date(dto.fechaFin) : undefined,
        justificacionTexto: dto.justificacionTexto ?? undefined,
        adjuntoUrl,
        ...(yaResuelta
          ? { estadoHys: 'pendiente' as any, aprobadoHysPorCuil: null, aprobadoHysEn: null, descargoHys: null }
          : {}),
      },
      include: INCLUDE_BASICO,
    });

    await this.prisma.auditoria.create({
      data: {
        tabla: 'sth_novedades',
        registroId: id,
        usuarioCuil: usuario.cuil,
        accion: 'editar',
        campo: 'novedad',
        valorAnterior: JSON.stringify(snapshot(novedad)),
        valorNuevo: JSON.stringify(snapshot(updated)),
      },
    });

    return updated;
  }

  async resolverHys(id: number, dto: ResolverNovedadDto, aprobadoPorCuil: string) {
    const novedad = await this.prisma.novedad.findUnique({ where: { id } });
    if (!novedad) throw new NotFoundException('Novedad no encontrada');

    return this.prisma.novedad.update({
      where: { id },
      data: {
        estadoHys: dto.estadoHys,
        aprobadoHysPorCuil: aprobadoPorCuil,
        aprobadoHysEn: new Date(),
        descargoHys: dto.descargoHys,
      },
      include: INCLUDE_BASICO,
    });
  }

  /** Reabre una novedad ya resuelta por HyS: vuelve a `pendiente` y limpia la
   * resolución previa (mismo criterio que reabrir en registros-horas). */
  async reabrir(id: number, usuario: { cuil: string; rol: string }) {
    const novedad = await this.prisma.novedad.findUnique({ where: { id } });
    if (!novedad) throw new NotFoundException('Novedad no encontrada');

    const updated = await this.prisma.novedad.update({
      where: { id },
      data: { estadoHys: 'pendiente', aprobadoHysPorCuil: null, aprobadoHysEn: null, descargoHys: null },
      include: INCLUDE_BASICO,
    });

    await this.prisma.auditoria.create({
      data: {
        tabla: 'sth_novedades',
        registroId: id,
        usuarioCuil: usuario.cuil,
        accion: 'reabrir',
        campo: 'estadoHys',
        valorAnterior: novedad.estadoHys,
        valorNuevo: 'pendiente',
      },
    });

    return updated;
  }

  async obtenerAdjunto(
    id: number,
    usuario: { cuil: string; rol: string },
  ): Promise<{ buffer: Buffer; mimetype: string }> {
    const novedad = await this.prisma.novedad.findUnique({
      where: { id },
      select: { adjuntoUrl: true, cargadoPorCuil: true },
    });
    if (!novedad || !novedad.adjuntoUrl) {
      throw new NotFoundException('La novedad no tiene adjunto');
    }
    // Mismo alcance que el listado (findAll): el JefeCuadrilla solo ve lo que
    // él cargó. Sin esto, con el id en la URL podía leer el certificado médico
    // de cualquier novedad — los ids son secuenciales (revisión 2026-08-19).
    if (usuario.rol === 'JefeCuadrilla' && novedad.cargadoPorCuil !== usuario.cuil) {
      throw new ForbiddenException('No podés ver el adjunto de una novedad que no cargaste.');
    }
    return this.adjuntoStorage.leer(novedad.adjuntoUrl);
  }

  /**
   * Resumen de Ausencias de la quincena por operario, para la pantalla de
   * HyS (relabeleada en el frontend como "justificada/injustificada", pero el
   * estado on-the-wire sigue siendo aprobada/desaprobada/pendiente/no_aplica —
   * ver EstadoHys). Los días se clipean al rango de la quincena con el mismo
   * `diasClip` que usa el motor de liquidación.
   */
  async resumenAusencias(anio: number, mes: number, quincena: number): Promise<ResumenAusenciaOperario[]> {
    const { desde, hasta } = rangoQuincena(anio, mes, quincena);

    const novedades = await this.prisma.novedad.findMany({
      where: {
        tipoNovedad: { nombre: 'Ausencia' },
        fechaInicio: { lte: hasta },
        OR: [{ fechaFin: { gte: desde } }, { fechaFin: null, fechaInicio: { gte: desde } }],
      },
      include: { operario: { select: { apellido_nombre: true, legajo: true } } },
    });

    const porOperario = new Map<string, ResumenAusenciaOperario>();
    for (const n of novedades) {
      let acc = porOperario.get(n.operarioCuil);
      if (!acc) {
        acc = {
          operarioCuil: n.operarioCuil,
          apellidoNombre: n.operario.apellido_nombre,
          legajo: n.operario.legajo,
          diasJustificados: 0,
          diasInjustificados: 0,
          diasPendientes: 0,
        };
        porOperario.set(n.operarioCuil, acc);
      }

      const dias = this.calculo.diasClip(n.fechaInicio, n.fechaFin, desde, hasta);
      if (n.estadoHys === 'aprobada') {
        acc.diasJustificados += dias;
      } else if (n.estadoHys === 'desaprobada') {
        acc.diasInjustificados += dias;
      } else {
        // pendiente | no_aplica
        acc.diasPendientes += dias;
      }
    }

    return [...porOperario.values()];
  }
}
