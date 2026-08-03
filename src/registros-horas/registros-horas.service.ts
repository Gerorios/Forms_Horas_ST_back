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
import { rangoQuincena } from '../common/quincena';

// Umbral de advertencia (turno largo, revisar) vs. techo imposible (un día no
// tiene más horas que esto — se bloquea la carga en vez de solo avisar).
const UMBRAL_ALERTA_HORAS = 16;
const TECHO_HORAS_IMPOSIBLE = 24;
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
    const alertaHoras = totalHoras > UMBRAL_ALERTA_HORAS;
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

    // Alerta >16 hs por operario/día: se calcula ANTES de la transacción
    // (son lecturas) para no agotar el timeout de la transacción interactiva.
    // >24hs (techo imposible) bloquea la carga entera, ninguno se crea.
    const alertaPorOperario = new Map<string, boolean>();
    const excedidos: string[] = [];
    for (const operarioCuil of dto.operarioCuils) {
      const previas = await this.prisma.registroHoras.aggregate({
        where: { operarioCuil, fecha, estado: { not: 'desaprobado' } },
        _sum: { horas: true },
      });
      const totalDia = Number(previas._sum.horas ?? 0) + horasBatchPorOperario;
      alertaPorOperario.set(operarioCuil, totalDia > UMBRAL_ALERTA_HORAS);
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
        const registros = [];
        for (const operarioCuil of dto.operarioCuils) {
          const alertaHoras = alertaPorOperario.get(operarioCuil) ?? false;
          for (const linea of dto.lineas) {
            const registro = await tx.registroHoras.create({
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
              include: INCLUDE_BASICO,
            });
            registros.push(registro);
          }
        }
        return { creados: registros.length, registros };
      },
      { timeout: 30000, maxWait: 10000 },
    );
  }

  findAll(filtros: {
    fecha?: string;
    contratoId?: number;
    estado?: string;
    operarioCuil?: string;
    cargadoPorCuil?: string;
  }) {
    return this.prisma.registroHoras.findMany({
      where: {
        ...(filtros.fecha ? { fecha: new Date(filtros.fecha) } : {}),
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

        const nuevas = [];
        for (const original of filas) {
          // Alerta >16hs recalculada excluyendo lo desaprobado (la fila que
          // acabamos de rechazar ya no cuenta) — mismo criterio que create().
          const previas = await tx.registroHoras.aggregate({
            where: {
              operarioCuil: original.operarioCuil,
              fecha: original.fecha,
              estado: { not: 'desaprobado' },
            },
            _sum: { horas: true },
          });
          const totalDia = Number(previas._sum.horas ?? 0) + Number(dto.horasCorregidas);
          if (totalDia > TECHO_HORAS_IMPOSIBLE) {
            throw new BadRequestException(
              `Con esta corrección, ${original.operarioCuil} tendría ${totalDia}hs el día — no es humanamente posible. Puede haber una carga duplicada en otro contrato o lote.`,
            );
          }
          const alertaHoras = totalDia > UMBRAL_ALERTA_HORAS;

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
    const alertaHoras = totalDia > UMBRAL_ALERTA_HORAS;

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

  async porAprobar(
    usuario: { cuil: string; rol: string },
    estadoQuery?: string,
    filtros?: { contratoId?: number; operarioCuil?: string; cargadoPorCuil?: string; fecha?: string },
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
        ...(filtros?.fecha ? { fecha: new Date(filtros.fecha) } : {}),
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
    const empleados = await this.prisma.snuempleados.findMany({
      where: { cuil: { in: [...cuilsUsuarios] } },
      select: { cuil: true, apellido_nombre: true },
    });
    const nombrePorCuil = new Map(empleados.map((e) => [e.cuil, e.apellido_nombre]));
    const nombreUsuario = (u: { cuil: string; nombreFueraNomina: string | null }) =>
      nombrePorCuil.get(u.cuil) ?? u.nombreFueraNomina ?? '';

    // Total real de horas del operario ese día, cruzando TODOS los contratos y
    // lotes (no solo los de este jefe) — reemplaza el string fijo que hoy
    // pinta el frontend. Se recalcula acá en vez de confiar en el
    // `alertaHoras` grabado al momento de cargar, que queda desactualizado si
    // una carga posterior en OTRO lote sube el total del día (ver glosario,
    // "Ideas a futuro — Duplicación de horas entre contratos"). De paso se
    // arma el set de loteIds por operario+fecha: más de uno es la señal de
    // duplicación cruzada (mismo operario/día repartido en envíos distintos).
    const operarioCuils = [...new Set(filas.map((f) => f.operarioCuil))];
    const fechas = [...new Set(filas.map((f) => f.fecha.toISOString()))].map((s) => new Date(s));
    const filasDelDia = await this.prisma.registroHoras.findMany({
      where: {
        operarioCuil: { in: operarioCuils },
        fecha: { in: fechas },
        estado: { not: 'desaprobado' },
      },
      select: { operarioCuil: true, fecha: true, horas: true, loteId: true },
    });
    const clave = (operarioCuil: string, fecha: Date) => `${operarioCuil}_${fecha.toISOString()}`;
    const totalPorClave = new Map<string, number>();
    const lotesPorClave = new Map<string, Set<string>>();
    for (const r of filasDelDia) {
      const k = clave(r.operarioCuil, r.fecha);
      totalPorClave.set(k, (totalPorClave.get(k) ?? 0) + Number(r.horas));
      if (!lotesPorClave.has(k)) lotesPorClave.set(k, new Set());
      lotesPorClave.get(k)!.add(r.loteId);
    }

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
        duplicadoCruzado: (lotesPorClave.get(k)?.size ?? 1) > 1,
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

    const filas = await this.prisma.registroHoras.findMany({
      where: { contratoId: { in: misContratoIds }, fecha: { gte: desde, lte: hasta } },
      select: { operarioCuil: true, horas: true, estado: true },
    });

    type Acumulado = {
      totalHoras: number;
      pendiente: number;
      aprobado: number;
      desaprobado: number;
    };
    const porOperario = new Map<string, Acumulado>();
    for (const f of filas) {
      let acc = porOperario.get(f.operarioCuil);
      if (!acc) {
        acc = { totalHoras: 0, pendiente: 0, aprobado: 0, desaprobado: 0 };
        porOperario.set(f.operarioCuil, acc);
      }
      if (f.estado !== 'desaprobado') acc.totalHoras += Number(f.horas);
      acc[f.estado as 'pendiente' | 'aprobado' | 'desaprobado'] += 1;
    }

    const cuils = [...porOperario.keys()];
    const empleados = await this.prisma.snuempleados.findMany({
      where: { cuil: { in: cuils } },
      select: { cuil: true, apellido_nombre: true },
    });
    const nombrePorCuil = new Map(empleados.map((e) => [e.cuil, e.apellido_nombre]));

    return cuils
      .map((cuil) => {
        const acc = porOperario.get(cuil)!;
        return {
          cuil,
          apellido_nombre: nombrePorCuil.get(cuil) ?? '',
          ...acc,
          superaHorasExtra: acc.totalHoras > UMBRAL_HORAS_EXTRA_QUINCENA,
        };
      })
      .sort((a, b) => a.apellido_nombre.localeCompare(b.apellido_nombre));
  }

  /**
   * Empleados activos (snuempleados) sin ningún RegistroHoras en la quincena
   * — sin importar contrato ni estado (un rechazo también cuenta como "algo
   * se cargó"; acá interesa la ausencia total). No se scopea a "mis
   * contratos": la ausencia de carga no le pertenece a ningún contrato en
   * particular, y como los operarios son multidisciplinarios no hay un
   * padrón fijo por contrato — se comparte entre todos los Jefes de
   * Contrato y Admin para que cualquiera pueda notarlo y coordinar.
   */
  async sinCarga(anio: number, mes: number, quincena: number) {
    const { desde, hasta } = rangoQuincena(anio, mes, quincena);
    const [activos, conCarga] = await Promise.all([
      this.empleados.findActivos(),
      this.prisma.registroHoras.findMany({
        where: { fecha: { gte: desde, lte: hasta } },
        select: { operarioCuil: true },
        distinct: ['operarioCuil'],
      }),
    ]);
    const cuilsConCarga = new Set(conCarga.map((c) => c.operarioCuil));
    return activos
      .filter((e) => !cuilsConCarga.has(e.cuil))
      .map((e) => ({
        cuil: e.cuil,
        apellido_nombre: e.apellido_nombre,
        legajo: e.legajo,
        cargo: e.cargo,
      }));
  }
}
