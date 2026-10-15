import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogoDto } from './dto/config.dto';

export type Catalogo = 'naturalezas' | 'motivos';

/** Naturalezas y motivos de paralización. Los mantiene solo Admin; una
 * entrada en desuso se desactiva, nunca se borra (la siguen apuntando
 * reportes viejos). */
@Injectable()
export class CatalogosSeguridadService {
  constructor(private prisma: PrismaService) {}

  private delegado(catalogo: Catalogo): any {
    return catalogo === 'naturalezas' ? this.prisma.segNaturaleza : this.prisma.segMotivoParalizacion;
  }

  /** Lo que necesita el formulario de cualquier usuario. Los contratos son
   * TODOS los activos, no los habilitados: reportar no es imputar horas. */
  async paraFormulario() {
    const [naturalezas, motivos, contratos] = await Promise.all([
      this.prisma.segNaturaleza.findMany({ where: { activo: true }, select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } }),
      this.prisma.segMotivoParalizacion.findMany({ where: { activo: true }, select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } }),
      this.prisma.contrato.findMany({ where: { activo: true }, select: { id: true, codigo: true, nombre: true }, orderBy: { codigo: 'asc' } }),
    ]);
    return { naturalezas, motivosParalizacion: motivos, contratos };
  }

  listar(catalogo: Catalogo) {
    return this.delegado(catalogo).findMany({ orderBy: { nombre: 'asc' } });
  }

  private async nombreLibre(catalogo: Catalogo, nombre: string, excluirId?: number) {
    const existente = await this.delegado(catalogo).findUnique({ where: { nombre } });
    if (existente && existente.id !== excluirId) throw new BadRequestException(`Ya existe "${nombre}"`);
  }

  async crear(catalogo: Catalogo, dto: CatalogoDto) {
    const nombre = dto.nombre?.trim();
    if (!nombre) throw new BadRequestException('Falta el nombre');
    await this.nombreLibre(catalogo, nombre);
    return this.delegado(catalogo).create({ data: { nombre, activo: dto.activo ?? true } });
  }

  async editar(catalogo: Catalogo, id: number, dto: CatalogoDto) {
    if (!(await this.delegado(catalogo).findUnique({ where: { id } }))) throw new NotFoundException('No encontrado');
    const nombre = dto.nombre?.trim();
    if (nombre) await this.nombreLibre(catalogo, nombre, id);
    return this.delegado(catalogo).update({
      where: { id },
      data: { ...(nombre ? { nombre } : {}), ...(dto.activo !== undefined ? { activo: dto.activo } : {}) },
    });
  }
}
