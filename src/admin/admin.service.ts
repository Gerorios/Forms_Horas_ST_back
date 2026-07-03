import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContratoDto, UpdateContratoDto } from './dto/contrato.dto';
import { CreateTareaDto, CreateMovilDto, CreateProvinciaDto, CreateTipoNovedadDto, ToggleActivoDto } from './dto/catalogo.dto';
import { CreateUsuarioDto, UpdateUsuarioDto } from './dto/usuario.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  getRoles() {
    return this.prisma.rol.findMany({ orderBy: { nombre: 'asc' } });
  }

  getContratos() {
    return this.prisma.contrato.findMany({
      include: { jefeContrato: { select: { cuil: true, email: true } } },
      orderBy: { codigo: 'asc' },
    });
  }

  createContrato(dto: CreateContratoDto) {
    return this.prisma.contrato.create({ data: dto });
  }

  updateContrato(id: number, dto: UpdateContratoDto) {
    return this.prisma.contrato.update({ where: { id }, data: dto });
  }

  getTareas(contratoId?: number) {
    return this.prisma.tareaCatalogo.findMany({
      where: { ...(contratoId ? { contratoId } : {}) },
      include: { contrato: { select: { codigo: true } } },
      orderBy: { nombre: 'asc' },
    });
  }

  createTarea(dto: CreateTareaDto) {
    return this.prisma.tareaCatalogo.create({ data: dto });
  }

  toggleTarea(id: number, dto: ToggleActivoDto) {
    return this.prisma.tareaCatalogo.update({ where: { id }, data: { activo: dto.activo } });
  }

  getMoviles() {
    return this.prisma.movil.findMany({ orderBy: { identificador: 'asc' } });
  }

  createMovil(dto: CreateMovilDto) {
    return this.prisma.movil.create({ data: dto });
  }

  toggleMovil(id: number, dto: ToggleActivoDto) {
    return this.prisma.movil.update({ where: { id }, data: { activo: dto.activo } });
  }

  getProvincias() {
    return this.prisma.provincia.findMany({ orderBy: { nombre: 'asc' } });
  }

  createProvincia(dto: CreateProvinciaDto) {
    return this.prisma.provincia.create({ data: dto });
  }

  getTiposNovedad() {
    return this.prisma.tipoNovedad.findMany({ orderBy: { nombre: 'asc' } });
  }

  createTipoNovedad(dto: CreateTipoNovedadDto) {
    return this.prisma.tipoNovedad.create({ data: dto });
  }

  toggleTipoNovedad(id: number, dto: ToggleActivoDto) {
    return this.prisma.tipoNovedad.update({ where: { id }, data: { activo: dto.activo } });
  }

  getUsuarios() {
    return this.prisma.usuario.findMany({
      select: {
        cuil: true,
        email: true,
        activo: true,
        rol: { select: { nombre: true } },
        empleado: { select: { apellido_nombre: true } },
        contratosHabilitados: { include: { contrato: { select: { codigo: true } } } },
      },
      orderBy: { cuil: 'asc' },
    });
  }

  async createUsuario(dto: CreateUsuarioDto) {
    const existe = await this.prisma.usuario.findUnique({ where: { cuil: dto.cuil } });
    if (existe) throw new ConflictException('Ya existe un usuario con ese CUIL');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.usuario.create({
      data: {
        cuil: dto.cuil,
        email: dto.email,
        passwordHash,
        rolId: dto.rolId,
        contratosHabilitados: dto.contratosIds?.length
          ? { create: dto.contratosIds.map((contratoId) => ({ contratoId })) }
          : undefined,
      },
    });
  }

  async updateUsuario(cuil: string, dto: UpdateUsuarioDto) {
    const { password, contratosIds, ...rest } = dto;
    const data: any = { ...rest };
    if (password) data.passwordHash = await bcrypt.hash(password, 10);

    if (contratosIds !== undefined) {
      await this.prisma.contratoHabilitado.deleteMany({ where: { usuarioCuil: cuil } });
      if (contratosIds.length) {
        await this.prisma.contratoHabilitado.createMany({
          data: contratosIds.map((contratoId) => ({ usuarioCuil: cuil, contratoId })),
        });
      }
    }

    return this.prisma.usuario.update({ where: { cuil }, data });
  }
}
