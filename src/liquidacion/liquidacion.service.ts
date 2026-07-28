import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCategoriaUocraDto,
  UpdateCategoriaUocraDto,
  CreateTarifaCategoriaDto,
  CreateMontoNovedadPlusDto,
  CreateRangoKmDto,
  UpsertPerfilLiquidacionDto,
} from './dto/liquidacion.dto';

@Injectable()
export class LiquidacionService {
  constructor(private prisma: PrismaService) {}

  // ---- Categorías UOCRA ----
  getCategorias() {
    return this.prisma.categoriaUocra.findMany({ orderBy: { nombre: 'asc' } });
  }

  createCategoria(dto: CreateCategoriaUocraDto) {
    return this.prisma.categoriaUocra.create({ data: dto });
  }

  updateCategoria(id: number, dto: UpdateCategoriaUocraDto) {
    return this.prisma.categoriaUocra.update({ where: { id }, data: dto });
  }

  toggleCategoria(id: number, activo: boolean) {
    return this.prisma.categoriaUocra.update({ where: { id }, data: { activo } });
  }

  // ---- Tarifas por categoría (vigentes por mes) ----
  getTarifas(categoriaUocraId?: number) {
    return this.prisma.tarifaCategoriaUocra.findMany({
      where: categoriaUocraId ? { categoriaUocraId } : undefined,
      include: { categoria: { select: { nombre: true } } },
      orderBy: [{ categoriaUocraId: 'asc' }, { vigenteDesde: 'desc' }],
    });
  }

  createTarifa(dto: CreateTarifaCategoriaDto) {
    return this.prisma.tarifaCategoriaUocra.create({
      data: {
        categoriaUocraId: dto.categoriaUocraId,
        vigenteDesde: new Date(dto.vigenteDesde),
        importeHora: dto.importeHora,
      },
    });
  }

  // ---- Monto por día de novedad con plus (vigente por mes) ----
  getMontosNovedadPlus(tipoNovedadId?: number) {
    return this.prisma.montoNovedadPlus.findMany({
      where: tipoNovedadId ? { tipoNovedadId } : undefined,
      include: { tipoNovedad: { select: { nombre: true } } },
      orderBy: [{ tipoNovedadId: 'asc' }, { vigenteDesde: 'desc' }],
    });
  }

  createMontoNovedadPlus(dto: CreateMontoNovedadPlusDto) {
    return this.prisma.montoNovedadPlus.create({
      data: {
        tipoNovedadId: dto.tipoNovedadId,
        vigenteDesde: new Date(dto.vigenteDesde),
        montoPorDia: dto.montoPorDia,
      },
    });
  }

  // ---- Rangos de km "por tantos" (vigentes por mes) ----
  getRangosKm() {
    return this.prisma.rangoKmPorTantos.findMany({
      orderBy: [{ vigenteDesde: 'desc' }, { kmDesde: 'asc' }],
    });
  }

  createRangoKm(dto: CreateRangoKmDto) {
    return this.prisma.rangoKmPorTantos.create({
      data: {
        vigenteDesde: new Date(dto.vigenteDesde),
        kmDesde: dto.kmDesde,
        kmHasta: dto.kmHasta,
        precioPorKm: dto.precioPorKm,
      },
    });
  }

  // ---- Perfiles de liquidación (régimen + categoría por empleado) ----
  getPerfiles() {
    return this.prisma.perfilLiquidacion.findMany({
      include: {
        empleado: { select: { apellido_nombre: true, legajo: true, cargo: true } },
        categoria: { select: { id: true, nombre: true } },
      },
      orderBy: { cuil: 'asc' },
    });
  }

  async upsertPerfil(cuil: string, dto: UpsertPerfilLiquidacionDto) {
    const empleado = await this.prisma.snuempleados.findUnique({ where: { cuil } });
    if (!empleado) throw new NotFoundException('No existe un empleado con ese CUIL');

    return this.prisma.perfilLiquidacion.upsert({
      where: { cuil },
      create: {
        cuil,
        regimen: dto.regimen,
        categoriaUocraId: dto.categoriaUocraId,
        modalidadHoraExtra: dto.modalidadHoraExtra,
      },
      update: {
        regimen: dto.regimen,
        categoriaUocraId: dto.categoriaUocraId,
        modalidadHoraExtra: dto.modalidadHoraExtra,
      },
    });
  }

  async deletePerfil(cuil: string) {
    await this.prisma.perfilLiquidacion.delete({ where: { cuil } });
    return { cuil };
  }
}
