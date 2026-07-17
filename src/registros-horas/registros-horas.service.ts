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

const INCLUDE_BASICO = {
  operario: { select: { cuil: true, apellido_nombre: true } },
  contrato: { select: { id: true, codigo: true, nombre: true } },
  tareas: { include: { tarea: { select: { id: true, nombre: true } } } },
  provincia: { select: { id: true, nombre: true } },
  moviles: { include: { movil: { select: { id: true, identificador: true } } } },
};

@Injectable()
export class RegistrosHorasService {
  constructor(private prisma: PrismaService) {}

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
    const alertaHoras = totalHoras > 16;

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
    const alertaPorOperario = new Map<string, boolean>();
    for (const operarioCuil of dto.operarioCuils) {
      const previas = await this.prisma.registroHoras.aggregate({
        where: { operarioCuil, fecha, estado: { not: 'desaprobado' } },
        _sum: { horas: true },
      });
      const totalDia = Number(previas._sum.horas ?? 0) + horasBatchPorOperario;
      alertaPorOperario.set(operarioCuil, totalDia > 16);
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
      include: { contrato: { select: { jefeContratoCuil: true } } },
    });
    if (!registro) throw new NotFoundException('Registro no encontrado');
    if (
      usuario.rol !== 'Admin' &&
      registro.contrato.jefeContratoCuil !== usuario.cuil
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

  async reabrir(id: number, usuario: { cuil: string; rol: string }) {
    const registro = await this.prisma.registroHoras.findUnique({
      where: { id },
      include: { contrato: { select: { jefeContratoCuil: true } } },
    });
    if (!registro) throw new NotFoundException('Registro no encontrado');
    if (
      usuario.rol !== 'Admin' &&
      registro.contrato.jefeContratoCuil !== usuario.cuil
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
    const alertaHoras = Number(previas._sum.horas ?? 0) + Number(horas) > 16;

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

  async porAprobar(usuario: { cuil: string; rol: string }) {
    // 1) Contratos de los que el usuario es jefe (Admin = todos)
    const contratos = await this.prisma.contrato.findMany({
      where: usuario.rol === 'Admin' ? {} : { jefeContratoCuil: usuario.cuil },
      select: { id: true },
    });
    const misContratoIds = contratos.map((c) => c.id);
    if (misContratoIds.length === 0) return [];

    // 2) Lotes con al menos una fila pendiente en mis contratos
    const lotes = await this.prisma.registroHoras.findMany({
      where: { estado: 'pendiente', contratoId: { in: misContratoIds } },
      select: { loteId: true },
      distinct: ['loteId'],
    });
    if (lotes.length === 0) return [];

    // 3) Todas las filas pendientes de esos lotes (incluye otros contratos = contexto)
    const loteIds = lotes.map((l) => l.loteId);
    const filas = await this.prisma.registroHoras.findMany({
      where: { estado: 'pendiente', loteId: { in: loteIds } },
      include: INCLUDE_BASICO,
      orderBy: [{ fecha: 'desc' }, { loteId: 'asc' }, { operarioCuil: 'asc' }],
    });

    const setIds = new Set(misContratoIds);
    return filas.map((f) => ({ ...f, accionable: setIds.has(f.contratoId) }));
  }
}
