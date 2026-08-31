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

  listar() {
    return this.prisma.certificacionAcceso.findMany({
      include: { usuario: { select: { email: true } } },
    });
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
