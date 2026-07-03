import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CatalogosService {
  constructor(private prisma: PrismaService) {}

  getTareas(contratoId: number) {
    return this.prisma.tareaCatalogo.findMany({
      where: { contratoId, activo: true },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });
  }

  getProvincias() {
    return this.prisma.provincia.findMany({
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });
  }

  getMoviles() {
    return this.prisma.movil.findMany({
      where: { activo: true },
      select: { id: true, identificador: true, descripcion: true },
      orderBy: { identificador: 'asc' },
    });
  }
}
