import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNovedadDto } from './dto/create-novedad.dto';
import { ResolverNovedadDto } from './dto/resolver-novedad.dto';
import { rangoQuincena } from '../common/quincena';

const INCLUDE_BASICO = {
  operario: { select: { cuil: true, apellido_nombre: true } },
  tipoNovedad: { select: { id: true, nombre: true, requiereAprobacionHys: true } },
  cargadoPor: { select: { cuil: true, email: true } },
};

@Injectable()
export class NovedadesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateNovedadDto, usuario: { cuil: string; rol: string }) {
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

    return this.prisma.novedad.create({
      data: {
        operarioCuil: dto.operarioCuil,
        tipoNovedadId: dto.tipoNovedadId,
        fechaInicio: new Date(dto.fechaInicio),
        fechaFin: dto.fechaFin ? new Date(dto.fechaFin) : null,
        cargadoPorCuil,
        justificacionTexto: dto.justificacionTexto,
        adjuntoUrl: dto.adjuntoUrl,
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

  async resolverHys(id: number, dto: ResolverNovedadDto, aprobadoPorCuil: string) {
    const novedad = await this.prisma.novedad.findUnique({ where: { id } });
    if (!novedad) throw new NotFoundException('Novedad no encontrada');

    return this.prisma.novedad.update({
      where: { id },
      data: {
        estadoHys: dto.estadoHys,
        aprobadoHysPorCuil: aprobadoPorCuil,
        aprobadoHysEn: new Date(),
      },
      include: INCLUDE_BASICO,
    });
  }
}
