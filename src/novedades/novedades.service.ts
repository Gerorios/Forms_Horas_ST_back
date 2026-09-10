import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNovedadDto } from './dto/create-novedad.dto';
import { UpdateNovedadDto } from './dto/update-novedad.dto';
import { ResolverNovedadDto } from './dto/resolver-novedad.dto';
import { rangoQuincena } from '../common/quincena';
import { CalculoService } from '../liquidacion/calculo.service';
import { NOVEDAD_ADJUNTO_STORAGE, NovedadAdjuntoStorage } from './storage/novedad-adjunto-storage.interface';

/** Tope de certificados vigentes por novedad. El caso real es un papel, a
 * veces dos (certificado de atención + alta médica); 3 deja margen para el
 * error sin volver el disco del VPS un depósito de fotos. */
export const MAX_ADJUNTOS_POR_NOVEDAD = 3;

const INCLUDE_BASICO = {
  operario: { select: { cuil: true, apellido_nombre: true, legajo: true } },
  tipoNovedad: { select: { id: true, nombre: true, requiereAprobacionHys: true } },
  cargadoPor: { select: { cuil: true, nombreFueraNomina: true } },
  // Solo los vigentes: los dados de baja quedan en la tabla para auditoría,
  // pero no se muestran ni cuentan para el tope.
  adjuntos: {
    where: { eliminadoEn: null },
    select: { id: true, mimetype: true, subidoPorCuil: true, subidoEn: true },
    orderBy: { subidoEn: 'asc' as const },
  },
};

// Snapshot de los campos editables de una novedad, para el before/after de
// Auditoría. Los certificados NO están acá: no se editan por `update` y
// tienen su propia auditoría por archivo (accion adjuntar/quitar-adjunto).
function snapshot(n: {
  operarioCuil: string;
  tipoNovedadId: number;
  fechaInicio: Date;
  fechaFin: Date | null;
  justificacionTexto: string | null;
  estadoHys: string;
}) {
  return {
    operarioCuil: n.operarioCuil,
    tipoNovedadId: n.tipoNovedadId,
    fechaInicio: n.fechaInicio,
    fechaFin: n.fechaFin,
    justificacionTexto: n.justificacionTexto,
    estadoHys: n.estadoHys,
  };
}

/** Fila cruda de `sth_novedades_adjuntos` tal como la trae INCLUDE_BASICO. */
interface AdjuntoCrudo {
  id: number;
  mimetype: string;
  subidoPorCuil: string;
  subidoEn: Date;
}

/** Lo mínimo que necesita una novedad para pasar por `conNombresCargador`. */
interface NovedadPresentable {
  cargadoPor: { cuil: string; nombreFueraNomina: string | null };
  adjuntos?: AdjuntoCrudo[];
  aprobadoHysEn?: Date | null;
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

  /** Nombres para mostrar de quienes subieron certificados. Se resuelve
   * contra snuempleados y, para los que no estén en nómina (típicamente un
   * JefeCuadrilla), cae en `Usuario.nombreFueraNomina` — la consulta extra
   * corre solo si quedó alguno sin resolver. */
  private async mapaNombresSubidores(cuils: string[]): Promise<Map<string, string>> {
    const unicos = [...new Set(cuils)];
    if (unicos.length === 0) return new Map();
    const mapa = await this.mapaNombresPorCuil(unicos);
    const faltantes = unicos.filter((c) => !mapa.get(c));
    if (faltantes.length > 0) {
      const usuarios = await this.prisma.usuario.findMany({
        where: { cuil: { in: faltantes } },
        select: { cuil: true, nombreFueraNomina: true },
      });
      for (const u of usuarios) {
        if (u.nombreFueraNomina) mapa.set(u.cuil, u.nombreFueraNomina);
      }
    }
    return mapa;
  }

  /** Convierte los adjuntos crudos en la forma que consume el frontend y
   * deriva `certificadoPosteriorAResolucion`: el aviso para HyS de que llegó
   * un papel DESPUÉS de que resolvió. Se deriva de las fechas en vez de
   * guardarse como flag, así se apaga solo cuando HyS vuelve a resolver
   * (`resolverHys` reescribe `aprobadoHysEn`) y no puede quedar pegado. */
  private presentarAdjuntos(
    novedad: { adjuntos?: AdjuntoCrudo[]; aprobadoHysEn?: Date | null },
    nombres: Map<string, string>,
  ) {
    const adjuntos = (novedad.adjuntos ?? []).map((a) => ({
      id: a.id,
      mimetype: a.mimetype,
      subidoPorCuil: a.subidoPorCuil,
      subidoPor: nombres.get(a.subidoPorCuil) ?? '',
      subidoEn: a.subidoEn,
    }));
    const ultimo = adjuntos.reduce<Date | null>(
      (max, a) => (max === null || a.subidoEn > max ? a.subidoEn : max),
      null,
    );
    const resueltaEn = novedad.aprobadoHysEn ?? null;
    return {
      adjuntos,
      certificadoPosteriorAResolucion:
        resueltaEn !== null && ultimo !== null && ultimo > resueltaEn,
    };
  }

  /** Reemplaza `cargadoPor` (cuil + nombreFueraNomina "crudos") por el nombre
   * para mostrar. Un email (ej. "10801@st.local") no identifica a nadie en
   * el tiempo — un JefeCuadrilla no tiene otro identificador visible salvo
   * su nombre real (revisión 2026-08-25). */
  private async conNombreCargador<T extends NovedadPresentable>(novedad: T) {
    return (await this.conNombresCargador([novedad]))[0];
  }

  /** Misma resolución que `conNombreCargador`, en lote (una sola consulta a
   * snuempleados para toda la lista) — usada por `findAll`. */
  private async conNombresCargador<T extends NovedadPresentable>(novedades: T[]) {
    const mapa = await this.mapaNombresPorCuil(novedades.map((n) => n.cargadoPor.cuil));
    const nombresSubidores = await this.mapaNombresSubidores(
      novedades.flatMap((n) => (n.adjuntos ?? []).map((a) => a.subidoPorCuil)),
    );
    return novedades.map((n) => ({
      ...n,
      ...this.presentarAdjuntos(n, nombresSubidores),
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
    const path = adjunto ? await this.adjuntoStorage.guardar(adjunto.buffer, adjunto.mimetype) : undefined;

    const novedad = await this.prisma.novedad.create({
      data: {
        operarioCuil: dto.operarioCuil,
        tipoNovedadId: dto.tipoNovedadId,
        fechaInicio: new Date(dto.fechaInicio),
        fechaFin: dto.fechaFin ? new Date(dto.fechaFin) : null,
        cargadoPorCuil,
        justificacionTexto: dto.justificacionTexto,
        estadoHys: estadoHys as any,
        // El certificado que venga con la carga entra como el primero de la
        // lista de adjuntos.
        ...(path && adjunto
          ? { adjuntos: { create: [{ path, mimetype: adjunto.mimetype, subidoPorCuil: cargadoPorCuil }] } }
          : {}),
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
   *
   * NO toca los certificados: desde 2026-09-10 se suben y se quitan por
   * `agregarAdjunto`/`quitarAdjunto`, que es el único camino y no cambia el
   * estado de la novedad. Antes, editar con un archivo lo reemplazaba y
   * borraba el anterior del disco, sin vuelta atrás.
   */
  async update(
    id: number,
    dto: UpdateNovedadDto,
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
          // Reabrir por edición deja la novedad igual que reabrir(): sin
          // pierdePresentismoHys, que por ADR-022 solo tiene valor cuando
          // estadoHys='aprobada'. Sin limpiarlo, el booleano sobrevivía a la
          // reapertura y CalculoService seguía leyéndolo — una decisión de
          // presentismo (20% del básico) tomada sobre una novedad que ya
          // había vuelto a 'pendiente'.
          ...(yaResuelta
            ? {
                estadoHys: 'pendiente' as any,
                aprobadoHysPorCuil: null,
                aprobadoHysEn: null,
                descargoHys: null,
                pierdePresentismoHys: null,
              }
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

  /** Mismo alcance que el listado (findAll): el JefeCuadrilla solo alcanza lo
   * que él cargó. Sin esto, con el id en la URL podía leer el certificado
   * médico de cualquier novedad — los ids son secuenciales (revisión
   * 2026-08-19). Vale para ver, agregar y quitar por igual: si podés ver la
   * novedad, podés ponerle el papel. */
  private verificarAlcanceNovedad(
    novedad: { cargadoPorCuil: string },
    usuario: { cuil: string; rol: string },
  ) {
    if (usuario.rol === 'JefeCuadrilla' && novedad.cargadoPorCuil !== usuario.cuil) {
      throw new ForbiddenException('No podés acceder a los certificados de una novedad que no cargaste.');
    }
  }

  async obtenerAdjunto(
    id: number,
    adjuntoId: number,
    usuario: { cuil: string; rol: string },
  ): Promise<{ buffer: Buffer; mimetype: string }> {
    const novedad = await this.prisma.novedad.findUnique({
      where: { id },
      select: { cargadoPorCuil: true },
    });
    if (!novedad) throw new NotFoundException('Novedad no encontrada');
    this.verificarAlcanceNovedad(novedad, usuario);

    // El adjunto tiene que pertenecer a ESTA novedad: sin el filtro por
    // novedadId, un id de adjunto adivinado servía para leer el certificado
    // de cualquier otra desde una novedad que sí se puede ver.
    const adjunto = await this.prisma.novedadAdjunto.findFirst({
      where: { id: adjuntoId, novedadId: id, eliminadoEn: null },
      select: { path: true },
    });
    if (!adjunto) throw new NotFoundException('Certificado no encontrado');

    return this.adjuntoStorage.leer(adjunto.path);
  }

  /**
   * Agrega un certificado a una novedad ya cargada — el caso real: el operario
   * pide permiso, el supervisor carga la novedad ese día, y el papel llega
   * cuando vuelve del médico.
   *
   * NO cambia el estado de HyS: ni reabre, ni aprueba, ni desaprueba. Si el
   * certificado llega después de que HyS resolvió, el aviso viaja como
   * `certificadoPosteriorAResolucion` y la decisión de reabrir sigue siendo
   * de HyS (`reabrir`).
   */
  async agregarAdjunto(
    id: number,
    archivo: { buffer: Buffer; mimetype: 'image/jpeg' | 'image/png' | 'application/pdf' },
    usuario: { cuil: string; rol: string },
  ) {
    const novedad = await this.prisma.novedad.findUnique({
      where: { id },
      select: { id: true, cargadoPorCuil: true, estado: true },
    });
    if (!novedad) throw new NotFoundException('Novedad no encontrada');
    this.verificarAlcanceNovedad(novedad, usuario);
    // Anulada = registro congelado, mismo criterio que `update`.
    if (novedad.estado === 'anulada') throw new BadRequestException('La novedad está anulada');

    const vigentes = await this.prisma.novedadAdjunto.count({
      where: { novedadId: id, eliminadoEn: null },
    });
    if (vigentes >= MAX_ADJUNTOS_POR_NOVEDAD) {
      throw new BadRequestException(
        `Llegaste al máximo de ${MAX_ADJUNTOS_POR_NOVEDAD} certificados para esta novedad.`,
      );
    }

    // Se escribe en disco recién después de validar permiso, estado y tope,
    // para no dejar archivos huérfanos cuando la subida termina rechazada.
    const path = await this.adjuntoStorage.guardar(archivo.buffer, archivo.mimetype);

    await this.prisma.$transaction(async (tx) => {
      const creado = await tx.novedadAdjunto.create({
        data: { novedadId: id, path, mimetype: archivo.mimetype, subidoPorCuil: usuario.cuil },
      });
      await tx.auditoria.create({
        data: {
          tabla: 'sth_novedades_adjuntos',
          registroId: creado.id,
          usuarioCuil: usuario.cuil,
          accion: 'adjuntar',
          campo: 'certificado',
          valorAnterior: null,
          valorNuevo: JSON.stringify({ novedadId: id, path, mimetype: archivo.mimetype }),
        },
      });
    });

    return this.detalle(id);
  }

  /**
   * Quita un certificado. Por defecto es baja LÓGICA: la fila queda con
   * `eliminadoEn` y el archivo se conserva, así un reemplazo por error se
   * puede recuperar.
   *
   * `definitivo` (solo Admin) además borra el archivo del disco: es la salida
   * para el certificado subido en la novedad equivocada, que es dato de salud
   * de otra persona y no puede quedar recuperable.
   */
  async quitarAdjunto(
    id: number,
    adjuntoId: number,
    usuario: { cuil: string; rol: string },
    definitivo = false,
  ) {
    const novedad = await this.prisma.novedad.findUnique({
      where: { id },
      select: { cargadoPorCuil: true, estado: true, estadoHys: true },
    });
    if (!novedad) throw new NotFoundException('Novedad no encontrada');
    this.verificarAlcanceNovedad(novedad, usuario);

    const adjunto = await this.prisma.novedadAdjunto.findFirst({
      where: { id: adjuntoId, novedadId: id, eliminadoEn: null },
      select: { id: true, path: true, subidoPorCuil: true },
    });
    if (!adjunto) throw new NotFoundException('Certificado no encontrado');

    const esAdmin = usuario.rol === 'Admin';

    if (definitivo && !esAdmin) {
      throw new ForbiddenException('Solo un Admin puede borrar un certificado definitivamente.');
    }

    if (!esAdmin) {
      // Resuelta = la prueba que respalda la decisión de HyS queda congelada.
      // El Admin es la única puerta para tocarla, y queda auditado.
      const resuelta = novedad.estadoHys === 'aprobada' || novedad.estadoHys === 'desaprobada';
      if (resuelta) {
        throw new BadRequestException(
          'La novedad ya fue resuelta por HyS: sus certificados no se pueden quitar.',
        );
      }
      if (novedad.estado === 'anulada') throw new BadRequestException('La novedad está anulada');
      // Quien lo subió puede sacar lo suyo; HyS puede sacar cualquiera.
      if (usuario.rol !== 'HyS' && adjunto.subidoPorCuil !== usuario.cuil) {
        throw new ForbiddenException('Solo podés quitar los certificados que subiste vos.');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.novedadAdjunto.update({
        where: { id: adjunto.id },
        data: { eliminadoEn: new Date(), eliminadoPorCuil: usuario.cuil },
      });
      await tx.auditoria.create({
        data: {
          tabla: 'sth_novedades_adjuntos',
          registroId: adjunto.id,
          usuarioCuil: usuario.cuil,
          accion: definitivo ? 'borrar_adjunto' : 'quitar_adjunto',
          campo: 'certificado',
          valorAnterior: JSON.stringify({ novedadId: id, path: adjunto.path }),
          valorNuevo: null,
        },
      });
    });

    // Fuera de la transacción a propósito: si el unlink falla, la baja lógica
    // ya quedó firme y el archivo huérfano es un problema de disco, no de
    // datos. Al revés (borrar el archivo y que falle el commit) dejaría una
    // fila viva apuntando a un archivo que ya no está.
    if (definitivo) {
      await this.adjuntoStorage.borrar(adjunto.path);
    }

    return this.detalle(id);
  }

  /** Novedad completa, con la lista de certificados vigentes ya presentada
   * — es lo que devuelven agregar/quitar para que el frontend repinte sin
   * volver a pedir el listado entero. */
  private async detalle(id: number) {
    const novedad = await this.prisma.novedad.findUnique({
      where: { id },
      include: INCLUDE_BASICO,
    });
    if (!novedad) throw new NotFoundException('Novedad no encontrada');
    return this.conNombreCargador(novedad);
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
