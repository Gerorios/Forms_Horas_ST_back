import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ROL_HYS } from './reglas';
import { mapaNombres } from './nombres';

/** Inspectores: usuarios que, sin ser HyS, cargan inspecciones porque HyS
 * los habilitó uno por uno (CONTEXT.md, "Inspector"; ADR-027 2026-10-08). */
@Injectable()
export class InspectoresService {
  constructor(private prisma: PrismaService) {}

  async listar() {
    const filas = await this.prisma.segInspector.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        cuil: true,
        createdAt: true,
        habilitadoPorCuil: true,
        usuario: { select: { email: true, activo: true, rol: { select: { nombre: true } } } },
      },
    });
    const nombres = await mapaNombres(this.prisma, filas.flatMap((f) => [f.cuil, f.habilitadoPorCuil]));
    return filas.map((f) => ({
      cuil: f.cuil,
      nombre: nombres.get(f.cuil) ?? f.usuario.email,
      rol: f.usuario.rol.nombre,
      activo: f.usuario.activo,
      habilitadoPor: nombres.get(f.habilitadoPorCuil) ?? '',
      habilitadoEn: f.createdAt,
    }));
  }

  async habilitar(cuil: string, porCuil: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { cuil },
      select: { cuil: true, rol: { select: { nombre: true } } },
    });
    if (!usuario) throw new BadRequestException('Esa persona no tiene usuario en el sistema: primero hay que darla de alta');
    if (usuario.rol.nombre === ROL_HYS) throw new BadRequestException('HyS ya puede cargar inspecciones sin habilitarla');
    if (await this.prisma.segInspector.findUnique({ where: { cuil } })) {
      throw new BadRequestException('Ya está habilitada como inspector');
    }
    await this.prisma.segInspector.create({ data: { cuil, habilitadoPorCuil: porCuil } });
    return this.listar();
  }

  /** Quitar la habilitación no toca sus inspecciones ya cargadas. */
  async deshabilitar(cuil: string) {
    if (!(await this.prisma.segInspector.findUnique({ where: { cuil } }))) {
      throw new NotFoundException('No está habilitada como inspector');
    }
    await this.prisma.segInspector.delete({ where: { cuil } });
    return this.listar();
  }
}
