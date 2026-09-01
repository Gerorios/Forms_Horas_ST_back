import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CertClaim { nivel: string; ks: string[]; inc: boolean }

@Injectable()
export class AccesosService {
  constructor(private readonly prisma: PrismaService) {}

  async obtenerAcceso(cuil: string): Promise<CertClaim | null> {
    const acceso = await this.prisma.certificacionAcceso.findUnique({ where: { cuil } });
    if (!acceso) return null;
    let ks: string[] = [];
    if (acceso.nivel === 'carga') {
      const filas = await this.prisma.certificacionContratoHabilitado.findMany({
        where: { cuil }, include: { contrato: true },
      });
      ks = filas.map((f) => f.contrato.codigo);
    }
    return { nivel: acceso.nivel, ks, inc: acceso.verIncidencia };
  }

  /** Accesos con nombre para mostrar (snuempleados → nombreFueraNomina →
   * email, mismo criterio que novedades.service) y sus contratos K. */
  async listar() {
    const accesos = await this.prisma.certificacionAcceso.findMany({
      include: { usuario: { select: { email: true, nombreFueraNomina: true } } },
    });
    const cuils = accesos.map((a) => a.cuil);
    const [habilitados, empleados] = await Promise.all([
      this.prisma.certificacionContratoHabilitado.findMany({
        where: { cuil: { in: cuils } },
        include: { contrato: { select: { id: true, codigo: true } } },
      }),
      this.prisma.snuempleados.findMany({
        where: { cuil: { in: cuils } },
        select: { cuil: true, apellido_nombre: true },
      }),
    ]);
    const nombrePorCuil = new Map(empleados.map((e) => [e.cuil, e.apellido_nombre]));
    const contratosPorCuil = new Map<string, { id: number; codigo: string }[]>();
    for (const h of habilitados) {
      const lista = contratosPorCuil.get(h.cuil) ?? [];
      lista.push({ id: h.contrato.id, codigo: h.contrato.codigo });
      contratosPorCuil.set(h.cuil, lista);
    }
    return accesos.map((a) => ({
      cuil: a.cuil,
      nivel: a.nivel,
      verIncidencia: a.verIncidencia,
      nombre: nombrePorCuil.get(a.cuil) ?? a.usuario.nombreFueraNomina ?? a.usuario.email,
      contratos: contratosPorCuil.get(a.cuil) ?? [],
    }));
  }

  async upsert(cuil: string, dto: { nivel: string; verIncidencia: boolean; contratoIds: number[] }) {
    await this.prisma.$transaction([
      this.prisma.certificacionAcceso.upsert({
        where: { cuil },
        update: { nivel: dto.nivel, verIncidencia: dto.verIncidencia },
        create: { cuil, nivel: dto.nivel, verIncidencia: dto.verIncidencia },
      }),
      this.prisma.certificacionContratoHabilitado.deleteMany({ where: { cuil } }),
      this.prisma.certificacionContratoHabilitado.createMany({
        data: dto.contratoIds.map((contratoId) => ({ cuil, contratoId })),
      }),
    ]);
  }

  async eliminar(cuil: string) {
    await this.prisma.$transaction([
      this.prisma.certificacionContratoHabilitado.deleteMany({ where: { cuil } }),
      this.prisma.certificacionAcceso.delete({ where: { cuil } }),
    ]);
  }
}
