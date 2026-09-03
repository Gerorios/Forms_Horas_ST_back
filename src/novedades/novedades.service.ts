import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNovedadDto } from './dto/create-novedad.dto';
import { UpdateNovedadDto } from './dto/update-novedad.dto';
import { ResolverNovedadDto } from './dto/resolver-novedad.dto';
import { rangoQuincena } from '../common/quincena';
import { CalculoService } from '../liquidacion/calculo.service';
import { NOVEDAD_ADJUNTO_STORAGE, NovedadAdjuntoStorage } from './storage/novedad-adjunto-storage.interface';

const INCLUDE_BASICO = {
  operario: { select: { cuil: true, apellido_nombre: true, legajo: true } },
  tipoNovedad: { select: { id: true, nombre: true, requiereAprobacionHys: true } },
  cargadoPor: { select: { cuil: true, nombreFueraNomina: true } },
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

  /** Mapa cuil→apellido_nombre para el conjunto de CUILs pedido (empleados en
   * snuempleados). No hay FK física a snuempleados (ADR-008): quien llama
   * decide el fallback (típicamente `nombreFueraNomina`) para los que no
   * aparezcan acá — mismo criterio que registros-horas.service.ts. */
  private async mapaNombresPorCuil(cuils: Iterable<string>): Promise<Map<string, string>> {
    const empleados = await this.prisma.snuempleados.findMany({
      where: { cuil: { in: [...new Set(cuils)] } },
      select: { cuil: true, apellido_nombre: true },
    });
    return new Map(empleados.map((e) => [e.cuil, e.apellido_nombre]));
  }

  /** Reemplaza `cargadoPor` (cuil + nombreFueraNomina "crudos") por el nombre
   * para mostrar. Un email (ej. "10801@st.local") no identifica a nadie en
   * el tiempo — un JefeCuadrilla no tiene otro identificador visible salvo
   * su nombre real (revisión 2026-08-25). */
  private async conNombreCargador<T extends { cargadoPor: { cuil: string; nombreFueraNomina: string | null } }>(
    novedad: T,
  ): Promise<Omit<T, 'cargadoPor'> & { cargadoPor: { cuil: string; nombre: string } }> {
    const mapa = await this.mapaNombresPorCuil([novedad.cargadoPor.cuil]);
    return {
      ...novedad,
      cargadoPor: {
        cuil: novedad.cargadoPor.cuil,
        nombre: mapa.get(novedad.cargadoPor.cuil) ?? novedad.cargadoPor.nombreFueraNomina ?? '',
      },
    };
  }

  /** Misma resolución que `conNombreCargador`, en lote (una sola consulta a
   * snuempleados para toda la lista) — usada por `findAll`. */
  private async conNombresCargador<T extends { cargadoPor: { cuil: string; nombreFueraNomina: string | null } }>(
    novedades: T[],
  ): Promise<(Omit<T, 'cargadoPor'> & { cargadoPor: { cuil: string; nombre: string } })[]> {
    const mapa = await this.mapaNombresPorCuil(novedades.map((n) => n.cargadoPor.cuil));
    return novedades.map((n) => ({
      ...n,
      cargadoPor: {
        cuil: n.cargadoPor.cuil,
        nombre: mapa.get(n.cargadoPor.cuil) ?? n.cargadoPor.nombreFueraNomina ?? '',
      },
    }));
  }

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

    const novedad = await this.prisma.novedad.create({
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
    return this.conNombreCargador(novedad);
  }

  async findAll(
    filtros: {
      operarioCuil?: string;
      estadoHys?: string;
      estado?: string;
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

    const novedades = await this.prisma.novedad.findMany({
      where: {
        ...(filtros.operarioCuil ? { operarioCuil: filtros.operarioCuil } : {}),
        ...(filtros.estadoHys ? { estadoHys: filtros.estadoHys as any } : {}),
        // Sin filtro: devuelve activas y anuladas por igual (mismo criterio que
        // CargasCombustibleService#listar) — el frontend filtra a "activa" por
        // defecto en su propio MultiFiltro, no se hardcodea acá.
        ...(filtros.estado ? { estado: filtros.estado as any } : {}),
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
    return this.conNombresCargador(novedades);
  }

  /**
   * HyS solo puede editar/anular novedades de tipo Ausencia; Admin no tiene
   * restricción de tipo (ver feature editar/anular ausencias 2026-08-19).
   * En `update` se llama DOS veces: sobre el tipo actual y sobre el destino
   * cuando la edición cambia el tipo.
   */
  private verificarAlcanceTipo(tipoNombre: string, usuario: { rol: string }) {
    if (usuario.rol === 'HyS' && tipoNombre !== 'Ausencia') {
      throw new ForbiddenException('HyS solo puede editar/anular novedades de tipo Ausencia');
    }
  }

  /**
   * Edición completa de una novedad (HyS restringido a Ausencia, Admin sin
   * restricción). Igual regla que "corregir" en registros-horas: si ya estaba
   * resuelta por HyS (aprobada/desaprobada), la edición la vuelve a
   * `pendiente` y limpia la resolución previa. Deja auditoría con el snapshot
   * antes/después.
   */
  async update(
    id: number,
    dto: UpdateNovedadDto,
    adjunto: { buffer: Buffer; mimetype: 'image/jpeg' | 'image/png' | 'application/pdf' } | undefined,
    usuario: { cuil: string; rol: string },
  ) {
    const novedad = await this.prisma.novedad.findUnique({ where: { id }, include: { tipoNovedad: true } });
    if (!novedad) throw new NotFoundException('Novedad no encontrada');
    this.verificarAlcanceTipo(novedad.tipoNovedad.nombre, usuario);
    // El alcance vale también sobre el tipo DESTINO: mirando solo el de origen,
    // HyS podía agarrar una Ausencia (que sí puede tocar) y convertirla en otro
    // tipo, escapándose de su restricción — y si el destino tiene generaPlus,
    // eso además pega en la liquidación.
    if (dto.tipoNovedadId && dto.tipoNovedadId !== novedad.tipoNovedadId) {
      const destino = await this.prisma.tipoNovedad.findUnique({ where: { id: dto.tipoNovedadId } });
      if (!destino) throw new NotFoundException('Tipo de novedad no encontrado');
      this.verificarAlcanceTipo(destino.nombre, usuario);
    }
    // Anulada = registro congelado, no se puede seguir editando (mismo
    // criterio que CargasCombustibleService#puedeModificar).
    if (novedad.estado === 'anulada') throw new BadRequestException('La novedad está anulada');

    let adjuntoUrl = novedad.adjuntoUrl;
    if (adjunto) {
      if (novedad.adjuntoUrl) {
        await this.adjuntoStorage.borrar(novedad.adjuntoUrl);
      }
      adjuntoUrl = await this.adjuntoStorage.guardar(adjunto.buffer, adjunto.mimetype);
    }

    const yaResuelta = novedad.estadoHys === 'aprobada' || novedad.estadoHys === 'desaprobada';

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.novedad.update({
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

      await tx.auditoria.create({
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
    });
    return this.conNombreCargador(updated);
  }

  /**
   * Anula una novedad (HyS restringido a Ausencia, Admin sin restricción).
   * Mismo patrón que CargasCombustibleService#anular: transacción con el
   * update de estado y la fila de Auditoria.
   */
  async anular(id: number, motivo: string, usuario: { cuil: string; rol: string }) {
    const novedad = await this.prisma.novedad.findUnique({ where: { id }, include: { tipoNovedad: true } });
    if (!novedad) throw new NotFoundException('Novedad no encontrada');
    this.verificarAlcanceTipo(novedad.tipoNovedad.nombre, usuario);
    if (novedad.estado === 'anulada') throw new BadRequestException('Ya está anulada');

    const anulada = await this.prisma.$transaction(async (tx) => {
      const anulada = await tx.novedad.update({
        where: { id },
        data: {
          estado: 'anulada',
          motivoAnulacion: motivo,
          anuladaPorCuil: usuario.cuil,
          anuladaEn: new Date(),
        },
        include: INCLUDE_BASICO,
      });
      await tx.auditoria.create({
        data: {
          tabla: 'sth_novedades',
          registroId: id,
          usuarioCuil: usuario.cuil,
          accion: 'anular',
          campo: 'estado',
          valorAnterior: 'activa',
          valorNuevo: 'anulada',
        },
      });
      return anulada;
    });
    return this.conNombreCargador(anulada);
  }

  async resolverHys(id: number, dto: ResolverNovedadDto, aprobadoPorCuil: string) {
    const novedad = await this.prisma.novedad.findUnique({ where: { id } });
    if (!novedad) throw new NotFoundException('Novedad no encontrada');
    if (novedad.estado === 'anulada') throw new BadRequestException('La novedad está anulada');

    // pierdePresentismoHys (ADR-022) solo tiene sentido al justificar — para
    // 'desaprobada' se ignora lo que venga en el DTO y queda null, esa
    // siempre pierde presentismo por regla fija (ver CalculoService).
    const pierdePresentismoHys = dto.estadoHys === 'aprobada' ? dto.pierdePresentismoHys : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.novedad.update({
        where: { id },
        data: {
          estadoHys: dto.estadoHys,
          aprobadoHysPorCuil: aprobadoPorCuil,
          aprobadoHysEn: new Date(),
          descargoHys: dto.descargoHys,
          pierdePresentismoHys,
        },
        include: INCLUDE_BASICO,
      });

      await tx.auditoria.create({
        data: {
          tabla: 'sth_novedades',
          registroId: id,
          usuarioCuil: aprobadoPorCuil,
          accion: dto.estadoHys === 'aprobada' ? 'aprobar' : 'desaprobar',
          campo: 'estadoHys',
          valorAnterior: novedad.estadoHys,
          valorNuevo: dto.estadoHys,
        },
      });
      if (dto.estadoHys === 'aprobada') {
        await tx.auditoria.create({
          data: {
            tabla: 'sth_novedades',
            registroId: id,
            usuarioCuil: aprobadoPorCuil,
            accion: 'aprobar',
            campo: 'pierdePresentismoHys',
            valorAnterior: novedad.pierdePresentismoHys == null ? null : String(novedad.pierdePresentismoHys),
            valorNuevo: String(pierdePresentismoHys),
          },
        });
      }

      return updated;
    });
    return this.conNombreCargador(updated);
  }

  /** Reabre una novedad ya resuelta por HyS: vuelve a `pendiente` y limpia la
   * resolución previa (mismo criterio que reabrir en registros-horas). */
  async reabrir(id: number, usuario: { cuil: string; rol: string }) {
    const novedad = await this.prisma.novedad.findUnique({ where: { id } });
    if (!novedad) throw new NotFoundException('Novedad no encontrada');
    if (novedad.estado === 'anulada') throw new BadRequestException('La novedad está anulada');

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.novedad.update({
        where: { id },
        data: {
          estadoHys: 'pendiente',
          aprobadoHysPorCuil: null,
          aprobadoHysEn: null,
          descargoHys: null,
          pierdePresentismoHys: null,
        },
        include: INCLUDE_BASICO,
      });

      await tx.auditoria.create({
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
    });
    return this.conNombreCargador(updated);
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
        // Agregación interna (no filtrable como findAll): una Ausencia
        // anulada nunca debe contarse en el resumen.
        estado: 'activa',
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
