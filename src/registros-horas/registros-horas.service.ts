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
  tarea: { select: { id: true, nombre: true } },
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
        fecha: new Date(dto.fecha),
        operarioCuil: dto.operarioCuil,
        cargadoPorCuil,
        contratoId: dto.contratoId,
        tareaId: dto.tareaId,
        horas: dto.horas,
        provinciaId: dto.provinciaId,
        gpsLat: dto.gpsLat,
        gpsLng: dto.gpsLng,
        alertaHoras,
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
    const contratoIds = [...new Set(dto.lineas.map((l) => l.contratoId))];
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

    return this.prisma.$transaction(
      async (tx) => {
        const registros = [];
        for (const operarioCuil of dto.operarioCuils) {
          const alertaHoras = alertaPorOperario.get(operarioCuil) ?? false;
          for (const linea of dto.lineas) {
            const registro = await tx.registroHoras.create({
              data: {
                fecha,
                operarioCuil,
                cargadoPorCuil,
                contratoId: linea.contratoId,
                tareaId: linea.tareaId,
                horas: linea.horas,
                provinciaId: dto.provinciaId,
                gpsLat: dto.gpsLat,
                gpsLng: dto.gpsLng,
                alertaHoras,
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

  async resolver(id: number, dto: ResolverRegistroDto, aprobadoPorCuil: string) {
    const registro = await this.prisma.registroHoras.findUnique({ where: { id } });
    if (!registro) throw new NotFoundException('Registro no encontrado');
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
        aprobadoPorCuil,
        aprobadoEn: new Date(),
        motivoDesaprobacion: dto.motivoDesaprobacion ?? null,
      },
      include: INCLUDE_BASICO,
    });

    await this.prisma.auditoria.create({
      data: {
        tabla: 'sth_registros_horas',
        registroId: id,
        usuarioCuil: aprobadoPorCuil,
        accion: dto.estado === 'aprobado' ? 'aprobar' : 'desaprobar',
        campo: 'estado',
        valorAnterior: 'pendiente',
        valorNuevo: dto.estado,
      },
    });

    return updated;
  }

  async reabrir(id: number, usuarioCuil: string) {
    const registro = await this.prisma.registroHoras.findUnique({ where: { id } });
    if (!registro) throw new NotFoundException('Registro no encontrado');

    const updated = await this.prisma.registroHoras.update({
      where: { id },
      data: { estado: 'pendiente', aprobadoPorCuil: null, aprobadoEn: null },
      include: INCLUDE_BASICO,
    });

    await this.prisma.auditoria.create({
      data: {
        tabla: 'sth_registros_horas',
        registroId: id,
        usuarioCuil,
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

      const updated = await tx.registroHoras.update({
        where: { id },
        data: {
          fecha,
          contratoId: dto.contratoId ?? undefined,
          tareaId: dto.tareaId ?? undefined,
          horas: dto.horas ?? undefined,
          provinciaId: dto.provinciaId ?? undefined,
          gpsLat: dto.gpsLat ?? undefined,
          gpsLng: dto.gpsLng ?? undefined,
          estado: 'pendiente',
          aprobadoPorCuil: null,
          aprobadoEn: null,
          motivoDesaprobacion: null,
          alertaHoras,
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
            tareaId: registro.tareaId,
          }),
          valorNuevo: JSON.stringify({
            estado: 'pendiente',
            horas: Number(horas),
            contratoId: dto.contratoId ?? registro.contratoId,
            tareaId: dto.tareaId ?? registro.tareaId,
          }),
        },
      });

      return updated;
    }, { timeout: 30000, maxWait: 10000 });
  }
}
