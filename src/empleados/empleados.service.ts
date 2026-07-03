import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmpleadosService {
  constructor(private prisma: PrismaService) {}

  findActivos(q?: string) {
    return this.prisma.snuempleados.findMany({
      where: {
        activo: 'S',
        borrado: { not: 'S' },
        ...(q ? { apellido_nombre: { contains: q } } : {}),
      },
      select: {
        cuil: true,
        apellido_nombre: true,
        legajo: true,
        cargo: true,
        seccion: true,
        categoria: true,
      },
      orderBy: { apellido_nombre: 'asc' },
    });
  }

  findOne(cuil: string) {
    return this.prisma.snuempleados.findUnique({ where: { cuil } });
  }
}
