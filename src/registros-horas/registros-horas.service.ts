import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRegistroHorasDto } from './dto/create-registro-horas.dto';
import { CreateRegistroBatchDto } from './dto/create-registro-batch.dto';
import { UpdateRegistroHorasDto } from './dto/update-registro-horas.dto';
import { ResolverRegistroDto } from './dto/resolver-registro.dto';
import { ResolverLoteDto } from './dto/resolver-lote.dto';
import { CorregirLoteDto } from './dto/corregir-lote.dto';
import { EmpleadosService } from '../empleados/empleados.service';
import { rangoQuincena, quincenaAnterior, quincenasHaciaAtras } from '../common/quincena';
import { duplicadosExactos } from '../common/duplicados';

// Umbral de advertencia (turno largo, revisar) vs. techo imposible (un día no
// tiene más horas que esto — se bloquea la carga en vez de solo avisar).
const UMBRAL_ALERTA_HORAS = 16;
const TECHO_HORAS_IMPOSIBLE = 24;
// Zona de revisión del panel Control general (>13hs/día, heredado del viejo
// tablero Looker). CONVIVE con UMBRAL_ALERTA_HORAS: el ≥16 es la alerta que
// pinta badges; el >13 solo llena una tabla de auditoría fina con tareas y
// observaciones. Decisión del dueño de producto 2026-08-10.
const UMBRAL_CONTROL_DIARIO = 13;
// Horas extra por quincena (régimen jornalizado/fijo), ver ADR-009 — señal
// distinta de la alerta diaria: acá interesa el acumulado del período.
const UMBRAL_HORAS_EXTRA_QUINCENA = 88;

const INCLUDE_BASICO = {
  operario: { select: { cuil: true, apellido_nombre: true } },
  contrato: { select: { id: true, codigo: true, nombre: true } },
  tareas: { include: { tarea: { select: { id: true, nombre: true } } } },
  provincia: { select: { id: true, nombre: true } },
  moviles: { include: { movil: { select: { id: true, identificador: true } } } },
};

@Injectable()
export class RegistrosHorasService {
  constructor(
    private prisma: PrismaService,
    private empleados: EmpleadosService,
  ) {}

  async create(dto: CreateRegistroHorasDto, cargadoPorCuil: string) {
    const habilitado = await this.prisma.contratoHabilitado.findUnique({
      where: {
        usuarioCuil_contratoId: {
          usuarioCuil: cargadoPorCuil,
          contratoId: dto.contratoId,
        },
      },
    });
    if (!habilitado) {
      throw new ForbiddenException('No tenés habilitado ese contrato');
    }

    const horasDelDia = await this.prisma.registroHoras.aggregate({
      where: {
        operarioCuil: dto.operarioCuil,
        fecha: new Date(dto.fecha),
        estado: { not: 'desaprobado' },
      },
      _sum: { horas: true },
    });
    const totalHoras = Number(horasDelDia._sum.horas ?? 0) + Number(dto.horas);
    const alertaHoras = totalHoras >= UMBRAL_ALERTA_HORAS;
    if (totalHoras > TECHO_HORAS_IMPOSIBLE) {
      throw new BadRequestException(
        `Con esta carga, este operario tendría ${totalHoras}hs el ${dto.fecha} entre todos los contratos — no es humanamente posible en un día. Puede haber una carga duplicada en otro contrato o lote.`,
      );
    }

    return this.prisma.registroHoras.create({
      data: {
        loteId: randomUUID(),
        fecha: new Date(dto.fecha),
        operarioCuil: dto.operarioCuil,
        cargadoPorCuil,
        contratoId: dto.contratoId,
        horas: dto.horas,
        provinciaId: dto.provinciaId,
        gpsLat: dto.gpsLat,
        gpsLng: dto.gpsLng,
        alertaHoras,
        observacion: dto.observacion,
        tareas: { create: dto.tareaIds.map((tareaId) => ({ tareaId })) },
        moviles: dto.movilIds?.length
          ? { create: dto.movilIds.map((movilId) => ({ movilId })) }
          : undefined,
      },
      include: INCLUDE_BASICO,
    });
  }

  /**
   * Carga masiva: expande a (N operarios × M líneas) filas en una transacción.
   * Valida que el usuario que carga tenga habilitados TODOS los contratos de las
   * líneas. La alerta >16 hs se calcula por operario/día (existentes no
   * desaprobados + suma de las líneas del batch).
   */
  async createBatch(dto: CreateRegistroBatchDto, cargadoPorCuil: string) {
    const contratoIds = dto.lineas.map((l) => l.contratoId);
    // Una línea por contrato: no se repite el contrato en la misma carga (ADR-002).
    if (new Set(contratoIds).size !== contratoIds.length) {
      throw new BadRequestException('No se puede repetir el contrato en una carga');
    }
    const habilitados = await this.prisma.contratoHabilitado.findMany({
      where: { usuarioCuil: cargadoPorCuil, contratoId: { in: contratoIds } },
      select: { contratoId: true },
    });
    const habilitadosSet = new Set(habilitados.map((h) => h.contratoId));
    const faltantes = contratoIds.filter((id) => !habilitadosSet.has(id));
    if (faltantes.length) {
      throw new ForbiddenException(
        `No tenés habilitados los contratos: ${faltantes.join(', ')}`,
      );
    }

    const fecha = new Date(dto.fecha);
    const horasBatchPorOperario = dto.lineas.reduce(
      (sum, l) => sum + Number(l.horas),
      0,
    );

    // Alerta >=16 hs por operario/día: se calcula ANTES de la transacción
    // (son lecturas) para no agotar el timeout de la transacción interactiva.
    // >24hs (techo imposible) bloquea la carga entera, ninguno se crea.
    // UN groupBy para todos los operarios (fix N+1 2026-08-18: antes era un
    // aggregate por operario — 20 operarios = 20 idas a la BD remota).
    const previasPorOperario = await this.prisma.registroHoras.groupBy({
      by: ['operarioCuil'],
      where: { operarioCuil: { in: dto.operarioCuils }, fecha, estado: { not: 'desaprobado' } },
      _sum: { horas: true },
    });
    const previasMap = new Map(
      previasPorOperario.map((p) => [p.operarioCuil, Number(p._sum.horas ?? 0)]),
    );
    const alertaPorOperario = new Map<string, boolean>();
    const excedidos: string[] = [];
    for (const operarioCuil of dto.operarioCuils) {
      const totalDia = (previasMap.get(operarioCuil) ?? 0) + horasBatchPorOperario;
      alertaPorOperario.set(operarioCuil, totalDia >= UMBRAL_ALERTA_HORAS);
      if (totalDia > TECHO_HORAS_IMPOSIBLE) excedidos.push(operarioCuil);
    }
    if (excedidos.length) {
      throw new BadRequestException(
        `Estos operarios superarían las ${TECHO_HORAS_IMPOSIBLE}hs el ${dto.fecha} entre todos los contratos — no es humanamente posible: ${excedidos.join(', ')}. Puede haber una carga duplicada en otro contrato o lote.`,
      );
    }

    const loteId = randomUUID();

    return this.prisma.$transaction(
      async (tx) => {
        let creados = 0;
        for (const operarioCuil of dto.operarioCuils) {
          const alertaHoras = alertaPorOperario.get(operarioCuil) ?? false;
          for (const linea of dto.lineas) {
            // Sin `include` acá: cada create no necesita las relaciones de
            // vuelta, solo insertar. Se traen todas juntas al final, en una
            // sola query — evita N inserts con 5 joins c/u cuando solo hace
            // falta 1 query con joins al terminar el lote.
            await tx.registroHoras.create({
              data: {
                loteId,
                fecha,
                operarioCuil,
                cargadoPorCuil,
                contratoId: linea.contratoId,
                horas: linea.horas,
                provinciaId: dto.provinciaId,
                gpsLat: dto.gpsLat,
                gpsLng: dto.gpsLng,
                alertaHoras,
                observacion: linea.observacion,
                tareas: { create: linea.tareaIds.map((tareaId) => ({ tareaId })) },
                moviles: dto.movilIds?.length
                  ? { create: dto.movilIds.map((movilId) => ({ movilId })) }
                  : undefined,
              },
            });
            creados++;
          }
        }
        const registros = await tx.registroHoras.findMany({ where: { loteId }, include: INCLUDE_BASICO });
        return { creados, registros };
      },
      { timeout: 30000, maxWait: 10000 },
    );
  }

  findAll(
    filtros: {
      fecha?: string;
      contratoId?: number;
      estado?: string;
      operarioCuil?: string;
      cargadoPorCuil?: string;
      // Rango server-side (fix de crecimiento 2026-08-18): Mis registros pide
      // la quincena visible en vez de la vida entera del usuario.
      desde?: string;
      hasta?: string;
    },
    usuario: { cuil: string; rol: string },
  ) {
    // Alcance (auditoría 2026-08-18): solo Admin consulta libre. El resto se
    // consulta a SÍ MISMO — como operario (Mis registros) o como cargador
    // (Cargas que hice). El acceso cross-usuario de los jefes vive en
    // porAprobar/paneles, que scopean por contratos habilitados.
    if (usuario.rol !== 'Admin') {
      const pideOtroOperario = filtros.operarioCuil && filtros.operarioCuil !== usuario.cuil;
      const pideOtroCargador = filtros.cargadoPorCuil && filtros.cargadoPorCuil !== usuario.cuil;
      if (pideOtroOperario || pideOtroCargador) {
        throw new ForbiddenException('Solo podés consultar tus propios registros.');
      }
      if (!filtros.operarioCuil && !filtros.cargadoPorCuil) {
        filtros = { ...filtros, operarioCuil: usuario.cuil };
      }
    }
    return this.prisma.registroHoras.findMany({
      where: {
        ...(filtros.fecha
          ? { fecha: new Date(filtros.fecha) }
          : filtros.desde && filtros.hasta
            ? { fecha: { gte: new Date(filtros.desde), lte: new Date(filtros.hasta) } }
            : {}),
        ...(filtros.contratoId ? { contratoId: filtros.contratoId } : {}),
        ...(filtros.estado ? { estado: filtros.estado as any } : {}),
        ...(filtros.operarioCuil ? { operarioCuil: filtros.operarioCuil } : {}),
        ...(filtros.cargadoPorCuil ? { cargadoPorCuil: filtros.cargadoPorCuil } : {}),
      },
      include: INCLUDE_BASICO,
      orderBy: { fecha: 'desc' },
    });
  }

  async resolver(
    id: number,
    dto: ResolverRegistroDto,
    usuario: { cuil: string; rol: string },
  ) {
    const registro = await this.prisma.registroHoras.findUnique({
      where: { id },
      include: { contrato: { select: { jefes: { select: { usuarioCuil: true } } } } },
    });
    if (!registro) throw new NotFoundException('Registro no encontrado');
    if (
      usuario.rol !== 'Admin' &&
      !registro.contrato.jefes.some((j) => j.usuarioCuil === usuario.cuil)
    ) {
      throw new ForbiddenException('No sos jefe del contrato de este registro');
    }
    if (registro.estado !== 'pendiente') {
      throw new BadRequestException('Solo se pueden resolver registros pendientes');
    }
    if (dto.estado === 'desaprobado' && !dto.motivoDesaprobacion) {
      throw new BadRequestException('Se requiere motivo al desaprobar');
    }

    const updated = await this.prisma.registroHoras.update({
      where: { id },
      data: {
        estado: dto.estado,
        aprobadoPorCuil: usuario.cuil,
        aprobadoEn: new Date(),
        motivoDesaprobacion: dto.motivoDesaprobacion ?? null,
      },
      include: INCLUDE_BASICO,
    });

    await this.prisma.auditoria.create({
      data: {
        tabla: 'sth_registros_horas',
        registroId: id,
        usuarioCuil: usuario.cuil,
        accion: dto.estado === 'aprobado' ? 'aprobar' : 'desaprobar',
        campo: 'estado',
        valorAnterior: 'pendiente',
        valorNuevo: dto.estado,
      },
    });

    return updated;
  }

  /**
   * Resuelve en bloque las filas `pendiente` de un lote que pertenecen a los contratos del
   * usuario (o todas si es Admin). El conjunto "accionable" se recalcula siempre server-side —
   * los `ids` del cliente solo intersectan ese conjunto ya autorizado, nunca lo amplían.
   */
  async resolverLote(
    loteId: string,
    dto: ResolverLoteDto,
    usuario: { cuil: string; rol: string },
  ) {
    if (dto.estado === 'desaprobado' && !dto.motivoDesaprobacion) {
      throw new BadRequestException('Se requiere motivo al desaprobar');
    }

    const accionables = await this.prisma.registroHoras.findMany({
      where: {
        loteId,
        estado: 'pendiente',
        contrato:
          usuario.rol === 'Admin'
            ? undefined
            : { jefes: { some: { usuarioCuil: usuario.cuil } } },
      },
      select: { id: true },
    });
    const accionablesIds = new Set(accionables.map((r) => r.id));

    const idsAResolver = dto.ids
      ? dto.ids.filter((id) => accionablesIds.has(id))
      : [...accionablesIds];

    if (idsAResolver.length === 0) {
      throw new BadRequestException('Nada para resolver');
    }

    await this.prisma.registroHoras.updateMany({
      where: { id: { in: idsAResolver } },
      data: {
        estado: dto.estado,
        aprobadoPorCuil: usuario.cuil,
        aprobadoEn: new Date(),
        motivoDesaprobacion: dto.motivoDesaprobacion ?? null,
      },
    });

    await this.prisma.auditoria.createMany({
      data: idsAResolver.map((id) => ({
        tabla: 'sth_registros_horas',
        registroId: id,
        usuarioCuil: usuario.cuil,
        accion: dto.estado === 'aprobado' ? 'aprobar' : 'desaprobar',
        campo: 'estado',
        valorAnterior: 'pendiente',
        valorNuevo: dto.estado,
      })),
    });

    return { resueltos: idsAResolver.length, ids: idsAResolver };
  }

  /**
   * Corrige las horas de una línea (contrato) dentro de un lote pendiente:
   * rechaza todas las filas de esos operarios en esa línea y crea filas
   * nuevas con la hora corregida, ya aprobadas por quien corrige. El vínculo
   * `loteIdOrigen` deja trazabilidad hacia el lote rechazado. Ver ADR-006.
   */
  async corregirLote(
    loteId: string,
    dto: CorregirLoteDto,
    usuario: { cuil: string; rol: string },
  ) {
    const filas = await this.prisma.registroHoras.findMany({
      where: {
        loteId,
        contratoId: dto.contratoId,
        estado: 'pendiente',
        contrato:
          usuario.rol === 'Admin'
            ? undefined
            : { jefes: { some: { usuarioCuil: usuario.cuil } } },
      },
      include: { tareas: true, moviles: true },
    });
    if (filas.length === 0) {
      throw new BadRequestException('Nada para corregir en ese contrato');
    }

    const idsARechazar = filas.map((f) => f.id);
    const nuevoLoteId = randomUUID();
    const ahora = new Date();

    return this.prisma.$transaction(
      async (tx) => {
        await tx.registroHoras.updateMany({
          where: { id: { in: idsARechazar } },
          data: {
            estado: 'desaprobado',
            motivoDesaprobacion: dto.motivo,
            aprobadoPorCuil: usuario.cuil,
            aprobadoEn: ahora,
          },
        });

        // Alerta >=16hs recalculada excluyendo lo desaprobado (las filas recién
        // rechazadas ya no cuentan) — mismo criterio que create(). UN groupBy
        // para todas las filas del lote (fix N+1 2026-08-18).
        const previasLote = await tx.registroHoras.groupBy({
          by: ['operarioCuil', 'fecha'],
          where: {
            operarioCuil: { in: filas.map((f) => f.operarioCuil) },
            fecha: { in: filas.map((f) => f.fecha) },
            estado: { not: 'desaprobado' },
          },
          _sum: { horas: true },
        });
        const previasPorClave = new Map(
          previasLote.map((p) => [`${p.operarioCuil}|${p.fecha.toISOString()}`, Number(p._sum.horas ?? 0)]),
        );

        const nuevas = [];
        for (const original of filas) {
          const totalDia =
            (previasPorClave.get(`${original.operarioCuil}|${original.fecha.toISOString()}`) ?? 0) +
            Number(dto.horasCorregidas);
          if (totalDia > TECHO_HORAS_IMPOSIBLE) {
            throw new BadRequestException(
              `Con esta corrección, ${original.operarioCuil} tendría ${totalDia}hs el día — no es humanamente posible. Puede haber una carga duplicada en otro contrato o lote.`,
            );
          }
          const alertaHoras = totalDia >= UMBRAL_ALERTA_HORAS;

          const nueva = await tx.registroHoras.create({
            data: {
              loteId: nuevoLoteId,
              loteIdOrigen: loteId,
              fecha: original.fecha,
              operarioCuil: original.operarioCuil,
              cargadoPorCuil: original.cargadoPorCuil,
              contratoId: original.contratoId,
              horas: dto.horasCorregidas,
              provinciaId: original.provinciaId,
              gpsLat: original.gpsLat,
              gpsLng: original.gpsLng,
              observacion: original.observacion,
              estado: 'aprobado',
              aprobadoPorCuil: usuario.cuil,
              aprobadoEn: ahora,
              alertaHoras,
              tareas: { create: original.tareas.map((t) => ({ tareaId: t.tareaId })) },
              moviles: original.moviles.length
                ? { create: original.moviles.map((m) => ({ movilId: m.movilId })) }
                : undefined,
            },
            include: INCLUDE_BASICO,
          });
          nuevas.push(nueva);
        }

        await tx.auditoria.createMany({
          data: idsARechazar.map((id) => ({
            tabla: 'sth_registros_horas',
            registroId: id,
            usuarioCuil: usuario.cuil,
            accion: 'desaprobar',
            campo: 'horas',
            valorAnterior: JSON.stringify({ estado: 'pendiente' }),
            valorNuevo: JSON.stringify({
              estado: 'desaprobado',
              motivo: dto.motivo,
              loteIdCorreccion: nuevoLoteId,
            }),
          })),
        });

        return {
          loteIdOrigen: loteId,
          loteId: nuevoLoteId,
          corregidos: nuevas.length,
          registros: nuevas,
        };
      },
      { timeout: 30000, maxWait: 10000 },
    );
  }

  async reabrir(id: number, usuario: { cuil: string; rol: string }) {
    const registro = await this.prisma.registroHoras.findUnique({
      where: { id },
      include: { contrato: { select: { jefes: { select: { usuarioCuil: true } } } } },
    });
    if (!registro) throw new NotFoundException('Registro no encontrado');
    if (
      usuario.rol !== 'Admin' &&
      !registro.contrato.jefes.some((j) => j.usuarioCuil === usuario.cuil)
    ) {
      throw new ForbiddenException('No sos jefe del contrato de este registro');
    }

    const updated = await this.prisma.registroHoras.update({
      where: { id },
      data: { estado: 'pendiente', aprobadoPorCuil: null, aprobadoEn: null },
      include: INCLUDE_BASICO,
    });

    await this.prisma.auditoria.create({
      data: {
        tabla: 'sth_registros_horas',
        registroId: id,
        usuarioCuil: usuario.cuil,
        accion: 'reabrir',
        campo: 'estado',
        valorAnterior: registro.estado,
        valorNuevo: 'pendiente',
      },
    });

    return updated;
  }

  /**
   * Corrige un registro: edita la misma fila, la vuelve a `pendiente`, limpia la
   * aprobación previa y deja auditoría. Puede hacerlo quien lo cargó, o un
   * JefeContrato/Admin sobre cualquiera.
   */
  async update(
    id: number,
    dto: UpdateRegistroHorasDto,
    usuario: { cuil: string; rol: string },
  ) {
    const registro = await this.prisma.registroHoras.findUnique({
      where: { id },
    });
    if (!registro) throw new NotFoundException('Registro no encontrado');

    const esAprobador = usuario.rol === 'JefeContrato' || usuario.rol === 'Admin';
    if (!esAprobador && registro.cargadoPorCuil !== usuario.cuil) {
      throw new ForbiddenException('Solo podés editar registros que cargaste vos');
    }

    if (dto.contratoId && dto.contratoId !== registro.contratoId) {
      const habilitado = await this.prisma.contratoHabilitado.findUnique({
        where: {
          usuarioCuil_contratoId: {
            usuarioCuil: usuario.cuil,
            contratoId: dto.contratoId,
          },
        },
      });
      if (!habilitado) {
        throw new ForbiddenException('No tenés habilitado ese contrato');
      }
    }

    const fecha = dto.fecha ? new Date(dto.fecha) : registro.fecha;
    const horas = dto.horas ?? Number(registro.horas);
    const previas = await this.prisma.registroHoras.aggregate({
      where: {
        operarioCuil: registro.operarioCuil,
        fecha,
        estado: { not: 'desaprobado' },
        id: { not: id },
      },
      _sum: { horas: true },
    });
    const totalDia = Number(previas._sum.horas ?? 0) + Number(horas);
    if (totalDia > TECHO_HORAS_IMPOSIBLE) {
      throw new BadRequestException(
        `Con esta edición, ${registro.operarioCuil} tendría ${totalDia}hs el día — no es humanamente posible. Puede haber una carga duplicada en otro contrato o lote.`,
      );
    }
    const alertaHoras = totalDia >= UMBRAL_ALERTA_HORAS;

    return this.prisma.$transaction(async (tx) => {
      if (dto.movilIds !== undefined) {
        await tx.registroMovil.deleteMany({ where: { registroId: id } });
      }
      if (dto.tareaIds !== undefined) {
        await tx.registroTarea.deleteMany({ where: { registroId: id } });
      }

      const updated = await tx.registroHoras.update({
        where: { id },
        data: {
          fecha,
          contratoId: dto.contratoId ?? undefined,
          horas: dto.horas ?? undefined,
          provinciaId: dto.provinciaId ?? undefined,
          gpsLat: dto.gpsLat ?? undefined,
          gpsLng: dto.gpsLng ?? undefined,
          estado: 'pendiente',
          aprobadoPorCuil: null,
          aprobadoEn: null,
          motivoDesaprobacion: null,
          alertaHoras,
          observacion: dto.observacion ?? undefined,
          ...(dto.tareaIds !== undefined && dto.tareaIds.length
            ? { tareas: { create: dto.tareaIds.map((tareaId) => ({ tareaId })) } }
            : {}),
          ...(dto.movilIds !== undefined
            ? {
                moviles: dto.movilIds.length
                  ? { create: dto.movilIds.map((movilId) => ({ movilId })) }
                  : undefined,
              }
            : {}),
        },
        include: INCLUDE_BASICO,
      });

      await tx.auditoria.create({
        data: {
          tabla: 'sth_registros_horas',
          registroId: id,
          usuarioCuil: usuario.cuil,
          accion: 'editar',
          campo: 'registro',
          valorAnterior: JSON.stringify({
            estado: registro.estado,
            horas: Number(registro.horas),
            contratoId: registro.contratoId,
          }),
          valorNuevo: JSON.stringify({
            estado: 'pendiente',
            horas: Number(horas),
            contratoId: dto.contratoId ?? registro.contratoId,
            ...(dto.tareaIds !== undefined ? { tareaIds: dto.tareaIds } : {}),
          }),
        },
      });

      return updated;
    }, { timeout: 30000, maxWait: 10000 });
  }

  /** Mapa cuil→apellido_nombre para el conjunto de CUILs pedido (empleados en
   * snuempleados). No hay FK física a snuempleados (ADR-008): quien llama
   * decide el fallback (típicamente `nombreFueraNomina`) para los que no
   * aparezcan acá — mismo criterio que admin.service.ts/panel.service.ts. */
  private async mapaNombresPorCuil(cuils: Iterable<string>): Promise<Map<string, string>> {
    const empleados = await this.prisma.snuempleados.findMany({
      where: { cuil: { in: [...new Set(cuils)] } },
      select: { cuil: true, apellido_nombre: true },
    });
    return new Map(empleados.map((e) => [e.cuil, e.apellido_nombre]));
  }

  async porAprobar(
    usuario: { cuil: string; rol: string },
    estadoQuery?: string,
    filtros?: {
      contratoId?: number;
      operarioCuil?: string;
      cargadoPorCuil?: string;
      fecha?: string;
      // Rango server-side (fix de crecimiento 2026-08-18): aprobados/rechazados
      // crecen sin techo; el front pide la quincena visible en vez de todo el
      // histórico y filtrar en cliente.
      desde?: string;
      hasta?: string;
    },
  ) {
    const ESTADOS_VALIDOS = ['pendiente', 'aprobado', 'desaprobado'] as const;
    const estado = (estadoQuery ?? 'pendiente') as (typeof ESTADOS_VALIDOS)[number];
    if (!ESTADOS_VALIDOS.includes(estado)) {
      throw new BadRequestException('estado inválido');
    }

    // 1) Contratos de los que el usuario es jefe (Admin = todos). El filtro de
    // contrato se resuelve acá, intersectando con "mis contratos" — nunca deja
    // filtrar por un contrato ajeno.
    const contratos = await this.prisma.contrato.findMany({
      where:
        usuario.rol === 'Admin'
          ? {}
          : { jefes: { some: { usuarioCuil: usuario.cuil } } },
      select: { id: true },
    });
    let misContratoIds = contratos.map((c) => c.id);
    if (filtros?.contratoId) {
      misContratoIds = misContratoIds.filter((id) => id === filtros.contratoId);
    }
    if (misContratoIds.length === 0) return [];

    // 2) Lotes con al menos una fila que matchee el estado + filtros, en mis
    // contratos. Los filtros deciden qué LOTES entran (no recortan filas
    // dentro de un lote que ya calificó — el contexto completo del envío
    // sigue mostrándose igual que antes, ver ADR-004).
    const lotes = await this.prisma.registroHoras.findMany({
      where: {
        estado,
        contratoId: { in: misContratoIds },
        ...(filtros?.operarioCuil ? { operarioCuil: filtros.operarioCuil } : {}),
        ...(filtros?.cargadoPorCuil ? { cargadoPorCuil: filtros.cargadoPorCuil } : {}),
        ...(filtros?.fecha
          ? { fecha: new Date(filtros.fecha) }
          : filtros?.desde && filtros?.hasta
            ? { fecha: { gte: new Date(filtros.desde), lte: new Date(filtros.hasta) } }
            : {}),
      },
      select: { loteId: true },
      distinct: ['loteId'],
    });
    if (lotes.length === 0) return [];

    // 3) Todas las filas de esos lotes en el mismo estado (incluye otros contratos = contexto)
    const loteIds = lotes.map((l) => l.loteId);
    const filas = await this.prisma.registroHoras.findMany({
      where: { estado, loteId: { in: loteIds } },
      include: {
        ...INCLUDE_BASICO,
        cargadoPor: { select: { cuil: true, email: true, nombreFueraNomina: true } },
        aprobadoPor: { select: { cuil: true, email: true, nombreFueraNomina: true } },
      },
      orderBy: [{ fecha: 'desc' }, { loteId: 'asc' }, { operarioCuil: 'asc' }],
    });

    const setIds = new Set(misContratoIds);

    // Auditoría: nombre para mostrar de quien cargó/aprobó. snuempleados no
    // tiene FK física (ADR-008): se resuelve a mano, con fallback a
    // nombreFueraNomina — mismo criterio que admin.service.ts.
    const cuilsUsuarios = new Set<string>();
    for (const f of filas) {
      cuilsUsuarios.add(f.cargadoPorCuil);
      if (f.aprobadoPorCuil) cuilsUsuarios.add(f.aprobadoPorCuil);
    }
    const nombrePorCuil = await this.mapaNombresPorCuil(cuilsUsuarios);
    const nombreUsuario = (u: { cuil: string; nombreFueraNomina: string | null }) =>
      nombrePorCuil.get(u.cuil) ?? u.nombreFueraNomina ?? '';

    // Total real de horas del operario ese día, cruzando TODOS los contratos y
    // lotes (no solo los de este jefe) — reemplaza el string fijo que hoy
    // pinta el frontend. Se recalcula acá en vez de confiar en el
    // `alertaHoras` grabado al momento de cargar, que queda desactualizado si
    // una carga posterior en OTRO lote sube el total del día (ver glosario,
    // "Ideas a futuro — Duplicación de horas entre contratos"). De paso se
    // detectan duplicados EXACTOS (regla 2026-08-14, src/common/duplicados.ts).
    const operarioCuils = [...new Set(filas.map((f) => f.operarioCuil))];
    const fechas = [...new Set(filas.map((f) => f.fecha.toISOString()))].map((s) => new Date(s));
    const filasDelDia = await this.prisma.registroHoras.findMany({
      where: {
        operarioCuil: { in: operarioCuils },
        fecha: { in: fechas },
        estado: { not: 'desaprobado' },
      },
      select: {
        id: true,
        operarioCuil: true,
        fecha: true,
        horas: true,
        contratoId: true,
        tareas: { select: { tareaId: true } },
        moviles: { select: { movilId: true } },
      },
    });
    const clave = (operarioCuil: string, fecha: Date) => `${operarioCuil}_${fecha.toISOString()}`;
    const totalPorClave = new Map<string, number>();
    for (const r of filasDelDia) {
      const k = clave(r.operarioCuil, r.fecha);
      totalPorClave.set(k, (totalPorClave.get(k) ?? 0) + Number(r.horas));
    }
    const { idsDuplicados } = duplicadosExactos(filasDelDia);

    return filas.map((f) => {
      const k = clave(f.operarioCuil, f.fecha);
      return {
        ...f,
        accionable: setIds.has(f.contratoId),
        cargadoPor: { cuil: f.cargadoPor.cuil, nombre: nombreUsuario(f.cargadoPor) },
        aprobadoPor: f.aprobadoPor
          ? { cuil: f.aprobadoPor.cuil, nombre: nombreUsuario(f.aprobadoPor) }
          : null,
        totalHorasDia: totalPorClave.get(k) ?? Number(f.horas),
        duplicadoCruzado: idsDuplicados.has(f.id),
      };
    });
  }

  /**
   * Panel general del Jefe de Contrato: resumen por operario de la quincena,
   * scopeado a "mis contratos" (mismo criterio que porAprobar). Pensado para
   * el control que antes se hacía por el tablero de Looker antes del cierre
   * de quincena.
   */
  async resumenOperarios(
    usuario: { cuil: string; rol: string },
    anio: number,
    mes: number,
    quincena: number,
    filtros: { contratoIds?: number[]; provinciaIds?: number[] } = {},
  ) {
    const { desde, hasta } = rangoQuincena(anio, mes, quincena);

    const contratos = await this.prisma.contrato.findMany({
      where:
        usuario.rol === 'Admin'
          ? {}
          : { jefes: { some: { usuarioCuil: usuario.cuil } } },
      select: { id: true },
    });
    const misContratoIds = contratos.map((c) => c.id);
    if (misContratoIds.length === 0) return [];

    // Filtros del panel: los contratos pedidos se intersecan con "mis
    // contratos" (nunca amplían el scope); la provincia achica el agregado
    // principal y el de la quincena anterior, pero NO la alerta cruzada.
    const contratoIdsEfectivos = filtros.contratoIds
      ? misContratoIds.filter((id) => filtros.contratoIds!.includes(id))
      : misContratoIds;
    if (contratoIdsEfectivos.length === 0) return [];
    const filtroProvincia = filtros.provinciaIds ? { provinciaId: { in: filtros.provinciaIds } } : {};

    const filas = await this.prisma.registroHoras.findMany({
      where: { contratoId: { in: contratoIdsEfectivos }, ...filtroProvincia, fecha: { gte: desde, lte: hasta } },
      select: { operarioCuil: true, horas: true, estado: true },
    });

    type Acumulado = {
      totalHoras: number;
      pendiente: number;
      aprobado: number;
      desaprobado: number;
      horasAprobadas: number;
    };
    const porOperario = new Map<string, Acumulado>();
    for (const f of filas) {
      let acc = porOperario.get(f.operarioCuil);
      if (!acc) {
        acc = { totalHoras: 0, pendiente: 0, aprobado: 0, desaprobado: 0, horasAprobadas: 0 };
        porOperario.set(f.operarioCuil, acc);
      }
      if (f.estado !== 'desaprobado') acc.totalHoras += Number(f.horas);
      if (f.estado === 'aprobado') acc.horasAprobadas += Number(f.horas);
      acc[f.estado as 'pendiente' | 'aprobado' | 'desaprobado'] += 1;
    }

    const cuils = [...porOperario.keys()];
    const empleados = await this.prisma.snuempleados.findMany({
      where: { cuil: { in: cuils } },
      select: { cuil: true, apellido_nombre: true },
    });
    const nombrePorCuil = new Map(empleados.map((e) => [e.cuil, e.apellido_nombre]));

    // Duplicado exacto (regla 2026-08-14, src/common/duplicados.ts): igual
    // criterio que porAprobar, pero acá se mira TODA la quincena y CRUZANDO
    // todos los contratos (no solo los míos) — si no, un jefe con un solo
    // contrato nunca vería la señal de que hay un clon cargado en otro lado.
    const filasQuincenaCompleta = await this.prisma.registroHoras.findMany({
      where: { operarioCuil: { in: cuils }, fecha: { gte: desde, lte: hasta }, estado: { not: 'desaprobado' } },
      select: {
        id: true,
        operarioCuil: true,
        fecha: true,
        horas: true,
        contratoId: true,
        tareas: { select: { tareaId: true } },
        moviles: { select: { movilId: true } },
      },
    });
    const conAlertaCruzada = duplicadosExactos(filasQuincenaCompleta).cuilesConDuplicado;

    // Horas aprobadas de la quincena anterior, mismo scope de "mis
    // contratos" (comparable con lo de arriba) — para ver si le estoy
    // aprobando de golpe mucho más (o algo por primera vez) a alguien, señal
    // de un posible duplicado que el control diario no agarró.
    const anterior = quincenaAnterior(anio, mes, quincena);
    const { desde: desdeAnt, hasta: hastaAnt } = rangoQuincena(anterior.anio, anterior.mes, anterior.quincena);
    const filasAnteriores = await this.prisma.registroHoras.findMany({
      where: {
        contratoId: { in: contratoIdsEfectivos },
        ...filtroProvincia,
        fecha: { gte: desdeAnt, lte: hastaAnt },
        estado: 'aprobado',
      },
      select: { operarioCuil: true, horas: true },
    });
    const horasAprobadasAnteriorPorCuil = new Map<string, number>();
    for (const f of filasAnteriores) {
      horasAprobadasAnteriorPorCuil.set(
        f.operarioCuil,
        (horasAprobadasAnteriorPorCuil.get(f.operarioCuil) ?? 0) + Number(f.horas),
      );
    }

    return cuils
      .map((cuil) => {
        const acc = porOperario.get(cuil)!;
        const horasAprobadasAnterior = horasAprobadasAnteriorPorCuil.get(cuil) ?? 0;
        return {
          cuil,
          apellido_nombre: nombrePorCuil.get(cuil) ?? '',
          ...acc,
          superaHorasExtra: acc.totalHoras > UMBRAL_HORAS_EXTRA_QUINCENA,
          tieneAlertaCruzada: conAlertaCruzada.has(cuil),
          horasAprobadasAnterior,
          deltaHorasAprobadas: acc.horasAprobadas - horasAprobadasAnterior,
        };
      })
      .sort((a, b) => a.apellido_nombre.localeCompare(b.apellido_nombre));
  }

  /**
   * Empleados activos (snuempleados) con régimen "jornalizado" sin ningún
   * RegistroHoras en la quincena — sin importar contrato ni estado (un
   * rechazo también cuenta como "algo se cargó"; acá interesa la ausencia
   * total). No se scopea a "mis contratos": la ausencia de carga no le
   * pertenece a ningún contrato en particular, y como los operarios son
   * multidisciplinarios no hay un padrón fijo por contrato — se comparte
   * entre todos los Jefes de Contrato y Admin para que cualquiera pueda
   * notarlo y coordinar.
   *
   * Solo jornalizados: el resto de los regímenes (fijo, fijo_105,
   * mensualizado, por_tantos) cobra un monto fijo o por otro criterio que no
   * depende de las horas cargadas — que no carguen es, a lo sumo,
   * estadístico, no algo que alguien tenga que salir a corregir.
   */
  async sinCarga(anio: number, mes: number, quincena: number) {
    const { desde, hasta } = rangoQuincena(anio, mes, quincena);
    const [activos, conCarga, jornalizados] = await Promise.all([
      this.empleados.findActivos(),
      this.prisma.registroHoras.findMany({
        where: { fecha: { gte: desde, lte: hasta } },
        select: { operarioCuil: true },
        distinct: ['operarioCuil'],
      }),
      this.prisma.perfilLiquidacion.findMany({
        where: { regimen: 'jornalizado' },
        select: { cuil: true },
      }),
    ]);
    const cuilsJornalizados = new Set(jornalizados.map((p) => p.cuil));
    const cuilsConCarga = new Set(conCarga.map((c) => c.operarioCuil));
    const sinCarga = activos.filter((e) => cuilsJornalizados.has(e.cuil) && !cuilsConCarga.has(e.cuil));

    // Última carga histórica (fuera de esta quincena, en cualquier contrato)
    // de cada uno — distingue "nunca cargó nada" (recién ingresado, sin
    // contrato asignado todavía) de "dejó de reportar de repente" (venía
    // cargando y esta quincena no hay nada, señal más urgente).
    const ultimas = await this.prisma.registroHoras.groupBy({
      by: ['operarioCuil'],
      where: { operarioCuil: { in: sinCarga.map((e) => e.cuil) } },
      _max: { fecha: true },
    });
    const ultimaPorCuil = new Map(ultimas.map((u) => [u.operarioCuil, u._max.fecha]));

    return sinCarga.map((e) => ({
      cuil: e.cuil,
      apellido_nombre: e.apellido_nombre,
      legajo: e.legajo,
      cargo: e.cargo,
      ultimaCarga: ultimaPorCuil.get(e.cuil)?.toISOString().slice(0, 10) ?? null,
    }));
  }

  /** Histórico de horas (pendientes + aprobadas) por quincena calendario, 24
   * quincenas (12 meses) terminando en la seleccionada — la vista "Horas Por
   * Quincena" del viejo tablero Looker, scopeada a mis contratos. */
  async historicoQuincenas(
    usuario: { cuil: string; rol: string },
    anio: number,
    mes: number,
    quincena: number,
    filtros: { contratoIds?: number[]; provinciaIds?: number[]; operarioCuils?: string[] } = {},
  ) {
    const contratos = await this.prisma.contrato.findMany({
      where:
        usuario.rol === 'Admin' ? {} : { jefes: { some: { usuarioCuil: usuario.cuil } } },
      select: { id: true },
    });
    const misContratoIds = contratos.map((c) => c.id);
    const contratoIdsEfectivos = filtros.contratoIds
      ? misContratoIds.filter((id) => filtros.contratoIds!.includes(id))
      : misContratoIds;
    const quincenas = quincenasHaciaAtras(anio, mes, quincena, 24);
    if (contratoIdsEfectivos.length === 0)
      return quincenas.map((q) => ({ ...q, horas: 0 }));

    const { desde } = rangoQuincena(quincenas[0].anio, quincenas[0].mes, quincenas[0].quincena);
    const { hasta } = rangoQuincena(anio, mes, quincena);
    const filas = await this.prisma.registroHoras.findMany({
      where: {
        contratoId: { in: contratoIdsEfectivos },
        ...(filtros.provinciaIds ? { provinciaId: { in: filtros.provinciaIds } } : {}),
        ...(filtros.operarioCuils ? { operarioCuil: { in: filtros.operarioCuils } } : {}),
        fecha: { gte: desde, lte: hasta },
        estado: { not: 'desaprobado' },
      },
      select: { fecha: true, horas: true },
    });

    const acum = new Map<string, number>();
    for (const f of filas) {
      const q = f.fecha.getDate() <= 15 ? 1 : 2;
      const k = `${f.fecha.getFullYear()}-${f.fecha.getMonth() + 1}-${q}`;
      acum.set(k, (acum.get(k) ?? 0) + Number(f.horas));
    }
    return quincenas.map((q) => ({
      ...q,
      horas: Math.round((acum.get(`${q.anio}-${q.mes}-${q.quincena}`) ?? 0) * 100) / 100,
    }));
  }

  /** Detalle plano de la quincena (la tabla "Detalle Diario" del Looker):
   * una fila por registro, con contrato y nombre resueltos.
   *
   * QUINCENA COMPLETA POR PERSONA (decisión 2026-08-19, corregida el mismo
   * día): mis contratos deciden qué OPERARIOS entran (los que tienen al menos
   * una fila mía en la quincena), y de cada uno se muestra TODA su quincena —
   * incluidos los días que cargó entero en un contrato ajeno, los "registros
   * sueltos". Las filas de otros jefes van marcadas con `esMiContrato: false`.
   *
   * Primero el criterio fue por DÍA (el día entraba si tenía una fila mía),
   * pero así los jefes no veían los días en que la persona estuvo con otro
   * contrato — que es justo lo que necesitan para entender dónde estuvo.
   * Es solo visualización: aprobar sigue scopeado. */
  async detalleDiario(
    usuario: { cuil: string; rol: string },
    anio: number,
    mes: number,
    quincena: number,
    filtros: { contratoIds?: number[]; provinciaIds?: number[]; operarioCuils?: string[] } = {},
  ) {
    const contratos = await this.prisma.contrato.findMany({
      where:
        usuario.rol === 'Admin' ? {} : { jefes: { some: { usuarioCuil: usuario.cuil } } },
      select: { id: true },
    });
    const misContratoIds = contratos.map((c) => c.id);
    const contratoIdsEfectivos = filtros.contratoIds
      ? misContratoIds.filter((id) => filtros.contratoIds!.includes(id))
      : misContratoIds;
    if (contratoIdsEfectivos.length === 0) return [];

    const { desde, hasta } = rangoQuincena(anio, mes, quincena);
    // Se traen TODAS las filas de la quincena (el filtro de contrato/provincia
    // no recorta acá: decide más abajo qué operarios entran). El de operario sí
    // va en el query, porque acota de qué personas hablamos.
    const filas = await this.prisma.registroHoras.findMany({
      where: {
        ...(filtros.operarioCuils ? { operarioCuil: { in: filtros.operarioCuils } } : {}),
        fecha: { gte: desde, lte: hasta },
      },
      select: {
        id: true, fecha: true, contratoId: true, operarioCuil: true, horas: true, estado: true,
        observacion: true, provinciaId: true, createdAt: true, aprobadoEn: true,
        contrato: { select: { codigo: true } },
        operario: { select: { apellido_nombre: true } },
        tareas: { select: { tarea: { select: { nombre: true } } } },
        cargadoPor: { select: { cuil: true, nombreFueraNomina: true } },
        aprobadoPor: { select: { cuil: true, nombreFueraNomina: true } },
      },
      orderBy: { fecha: 'desc' },
    });

    // Auditoría: nombre para mostrar de quien cargó/aprobó cada fila, mismo
    // criterio que porAprobar (snuempleados con fallback a nombreFueraNomina).
    const cuilsAuditoria = new Set<string>();
    for (const f of filas) {
      cuilsAuditoria.add(f.cargadoPor.cuil);
      if (f.aprobadoPor) cuilsAuditoria.add(f.aprobadoPor.cuil);
    }
    const nombrePorCuilAuditoria = await this.mapaNombresPorCuil(cuilsAuditoria);
    const nombreUsuarioAuditoria = (u: { cuil: string; nombreFueraNomina: string | null }) =>
      nombrePorCuilAuditoria.get(u.cuil) ?? u.nombreFueraNomina ?? '';

    // OJO: "mío" se juzga contra TODOS mis contratos, no contra los filtrados.
    // Si soy jefe de K5/K8 y filtro por K5, las filas de K8 siguen siendo mías
    // (solo las filtré de la vista): marcarlas "otro contrato" sería mentir.
    const mios = new Set(misContratoIds);
    const delFiltro = new Set(contratoIdsEfectivos);
    // Un OPERARIO entra si tiene al menos una fila en mis contratos filtrados
    // — y en la provincia filtrada, si hay filtro. Una vez adentro se muestra
    // toda su quincena, incluidos los días 100% de contratos ajenos.
    const operariosQueEntran = new Set<string>();
    for (const f of filas) {
      if (
        delFiltro.has(f.contratoId) &&
        (!filtros.provinciaIds || filtros.provinciaIds.includes(f.provinciaId))
      ) {
        operariosQueEntran.add(f.operarioCuil);
      }
    }

    // Se devuelve AGRUPADO por operario-día (decisión 2026-08-19: mismo
    // formato desplegable que la tabla de +13hs, que ya se usaba y gusta).
    // Las desaprobadas aparecen en el detalle pero no suman al total, igual
    // que en controlDiario.
    type DiaDetalle = {
      operarioCuil: string;
      operarioNombre: string;
      fecha: string;
      totalHoras: number;
      contratos: string[];
      registros: {
        id: number;
        contratoId: number;
        contratoCodigo: string;
        horas: number;
        estado: string;
        tareas: string[];
        observacion: string | null;
        esMiContrato: boolean;
        cargadoPorNombre: string;
        cargadoEn: string;
        aprobadoPorNombre: string | null;
        aprobadoEn: string | null;
      }[];
    };
    const dias = new Map<string, DiaDetalle>();
    for (const f of filas) {
      if (!operariosQueEntran.has(f.operarioCuil)) continue;
      const clave = `${f.operarioCuil}|${f.fecha.toISOString()}`;
      let d = dias.get(clave);
      if (!d) {
        d = {
          operarioCuil: f.operarioCuil,
          operarioNombre: f.operario.apellido_nombre,
          fecha: f.fecha.toISOString().slice(0, 10),
          totalHoras: 0,
          contratos: [],
          registros: [],
        };
        dias.set(clave, d);
      }
      if (f.estado !== 'desaprobado') d.totalHoras += Number(f.horas);
      if (!d.contratos.includes(f.contrato.codigo)) d.contratos.push(f.contrato.codigo);
      d.registros.push({
        id: f.id,
        contratoId: f.contratoId,
        contratoCodigo: f.contrato.codigo,
        horas: Number(f.horas),
        estado: f.estado,
        tareas: f.tareas.map((t) => t.tarea.nombre),
        observacion: f.observacion ?? null,
        /** false = registro de otro jefe: contexto de la jornada, no accionable. */
        esMiContrato: mios.has(f.contratoId),
        cargadoPorNombre: nombreUsuarioAuditoria(f.cargadoPor),
        cargadoEn: f.createdAt.toISOString(),
        aprobadoPorNombre: f.aprobadoPor ? nombreUsuarioAuditoria(f.aprobadoPor) : null,
        aprobadoEn: f.aprobadoEn ? f.aprobadoEn.toISOString() : null,
      });
    }

    return [...dias.values()]
      .map((d) => ({ ...d, totalHoras: Math.round(d.totalHoras * 100) / 100 }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.operarioNombre.localeCompare(b.operarioNombre));
  }

  /** Zona de revisión del panel Control general: operarios con más de
   * UMBRAL_CONTROL_DIARIO horas sumadas en un mismo día. NO es la alerta
   * (esa sigue siendo ≥16hs/día, ver alertaHoras): es una tabla de
   * auditoría fina para mirar qué tareas hizo y qué observaciones dejó
   * quien metió una jornada larga. Decisión 2026-08-10: conviven ambos
   * umbrales — el 13 viene del viejo tablero Looker.
   *
   * El total del día cruza TODOS los contratos (mismo espíritu que la
   * alerta cruzada: 7+7 en dos contratos = 14, tiene que aparecer). Los
   * filtros de contrato/provincia solo deciden qué días ENTRAN (al menos
   * una fila del día en ese scope); el total y el detalle muestran todo.
   * Suman pendientes + aprobadas; las rechazadas no cuentan para el total
   * pero sí aparecen en el detalle (la historia completa del día). */
  async controlDiario(
    usuario: { cuil: string; rol: string },
    anio: number,
    mes: number,
    quincena: number,
    filtros: { contratoIds?: number[]; provinciaIds?: number[]; operarioCuils?: string[] } = {},
  ) {
    const contratos = await this.prisma.contrato.findMany({
      where:
        usuario.rol === 'Admin' ? {} : { jefes: { some: { usuarioCuil: usuario.cuil } } },
      select: { id: true },
    });
    const misContratoIds = contratos.map((c) => c.id);
    const contratoIdsEfectivos = filtros.contratoIds
      ? misContratoIds.filter((id) => filtros.contratoIds!.includes(id))
      : misContratoIds;
    if (contratoIdsEfectivos.length === 0) return [];

    const { desde, hasta } = rangoQuincena(anio, mes, quincena);
    // Totales por operario-día, SIN filtrar por contrato/provincia (el total
    // cruza todo); el filtro de operario sí va en el query.
    const filas = await this.prisma.registroHoras.findMany({
      where: {
        fecha: { gte: desde, lte: hasta },
        estado: { not: 'desaprobado' },
        ...(filtros.operarioCuils ? { operarioCuil: { in: filtros.operarioCuils } } : {}),
      },
      select: { operarioCuil: true, fecha: true, horas: true, contratoId: true, provinciaId: true },
    });

    type Dia = { operarioCuil: string; fecha: Date; total: number; entra: boolean };
    const porDia = new Map<string, Dia>();
    for (const f of filas) {
      const k = `${f.operarioCuil}|${f.fecha.toISOString()}`;
      let d = porDia.get(k);
      if (!d) {
        d = { operarioCuil: f.operarioCuil, fecha: f.fecha, total: 0, entra: false };
        porDia.set(k, d);
      }
      d.total += Number(f.horas);
      // El día entra si al menos una fila cae en mis contratos filtrados
      // (y en la provincia filtrada, si hay filtro de provincia).
      if (
        contratoIdsEfectivos.includes(f.contratoId) &&
        (!filtros.provinciaIds || filtros.provinciaIds.includes(f.provinciaId))
      )
        d.entra = true;
    }

    const superan = [...porDia.values()].filter((d) => d.entra && d.total > UMBRAL_CONTROL_DIARIO);
    if (superan.length === 0) return [];

    // Detalle completo de esos días (incluye rechazadas, sin filtro de
    // contrato/provincia): se trae por cuil+fecha y se cruza en memoria.
    const detalle = await this.prisma.registroHoras.findMany({
      where: {
        operarioCuil: { in: [...new Set(superan.map((d) => d.operarioCuil))] },
        fecha: { in: [...new Set(superan.map((d) => d.fecha.toISOString()))].map((f) => new Date(f)) },
      },
      select: {
        id: true, operarioCuil: true, fecha: true, horas: true, estado: true, observacion: true,
        createdAt: true, aprobadoEn: true,
        contrato: { select: { codigo: true } },
        operario: { select: { apellido_nombre: true } },
        tareas: { select: { tarea: { select: { nombre: true } } } },
        cargadoPor: { select: { cuil: true, nombreFueraNomina: true } },
        aprobadoPor: { select: { cuil: true, nombreFueraNomina: true } },
      },
    });
    const detallePorDia = new Map<string, typeof detalle>();
    for (const f of detalle) {
      const k = `${f.operarioCuil}|${f.fecha.toISOString()}`;
      if (!detallePorDia.has(k)) detallePorDia.set(k, []);
      detallePorDia.get(k)!.push(f);
    }

    // Auditoría: nombre para mostrar de quien cargó/aprobó, mismo criterio
    // que detalleDiario/porAprobar.
    const cuilsAuditoriaControl = new Set<string>();
    for (const f of detalle) {
      cuilsAuditoriaControl.add(f.cargadoPor.cuil);
      if (f.aprobadoPor) cuilsAuditoriaControl.add(f.aprobadoPor.cuil);
    }
    const nombrePorCuilControl = await this.mapaNombresPorCuil(cuilsAuditoriaControl);
    const nombreUsuarioControl = (u: { cuil: string; nombreFueraNomina: string | null }) =>
      nombrePorCuilControl.get(u.cuil) ?? u.nombreFueraNomina ?? '';

    return superan
      .map((d) => {
        const filasDia = detallePorDia.get(`${d.operarioCuil}|${d.fecha.toISOString()}`) ?? [];
        return {
          operarioCuil: d.operarioCuil,
          operarioNombre: filasDia[0]?.operario.apellido_nombre ?? '',
          fecha: d.fecha.toISOString().slice(0, 10),
          totalHoras: Math.round(d.total * 100) / 100,
          contratos: [...new Set(filasDia.map((f) => f.contrato.codigo))].sort(),
          registros: filasDia.map((f) => ({
            id: f.id,
            contratoCodigo: f.contrato.codigo,
            horas: Number(f.horas),
            estado: f.estado,
            tareas: f.tareas.map((t) => t.tarea.nombre),
            observacion: f.observacion ?? null,
            cargadoPorNombre: nombreUsuarioControl(f.cargadoPor),
            cargadoEn: f.createdAt.toISOString(),
            aprobadoPorNombre: f.aprobadoPor ? nombreUsuarioControl(f.aprobadoPor) : null,
            aprobadoEn: f.aprobadoEn ? f.aprobadoEn.toISOString() : null,
          })),
        };
      })
      .sort((a, b) => b.totalHoras - a.totalHoras || b.fecha.localeCompare(a.fecha));
  }

  /** Contratos del jefe (o todos los activos para Admin) — opciones del filtro
   * por contrato del panel Control general. */
  async misContratos(usuario: { cuil: string; rol: string }) {
    return this.prisma.contrato.findMany({
      where: {
        activo: true,
        ...(usuario.rol === 'Admin' ? {} : { jefes: { some: { usuarioCuil: usuario.cuil } } }),
      },
      select: { id: true, codigo: true, nombre: true },
      orderBy: { codigo: 'asc' },
    });
  }
}
