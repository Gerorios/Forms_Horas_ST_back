import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContratoDto, UpdateContratoDto } from './dto/contrato.dto';
import { CreateTareaDto, UpdateTareaDto, CreateMovilDto, CreateProvinciaDto, CreateTipoNovedadDto, ToggleActivoDto } from './dto/catalogo.dto';
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

  updateTarea(id: number, dto: UpdateTareaDto) {
    return this.prisma.tareaCatalogo.update({ where: { id }, data: dto });
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
        rolId: true,
        rol: { select: { nombre: true } },
        empleado: { select: { apellido_nombre: true } },
        contratosHabilitados: {
          select: { contratoId: true, contrato: { select: { codigo: true } } },
        },
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

  async createUsuariosMasivo(cuils: string[]) {
    const rolOperario = await this.prisma.rol.findUnique({ where: { nombre: 'Operario' } });
    if (!rolOperario) throw new NotFoundException('No existe el rol Operario');

    const creados: { cuil: string; apellido_nombre: string; email: string; password: string }[] = [];
    const omitidos: { cuil: string; motivo: string }[] = [];

    for (const cuil of cuils) {
      const yaExiste = await this.prisma.usuario.findUnique({ where: { cuil } });
      if (yaExiste) {
        omitidos.push({ cuil, motivo: 'ya tiene usuario' });
        continue;
      }
      const emp = await this.prisma.snuempleados.findUnique({
        where: { cuil },
        select: { legajo: true, apellido_nombre: true, activo: true, borrado: true },
      });
      if (!emp || emp.activo !== 'S' || emp.borrado === 'S') {
        omitidos.push({ cuil, motivo: 'empleado inexistente o inactivo' });
        continue;
      }
      const email = await this.generarEmail(emp.legajo, cuil);
      const password = this.generarPassword();
      const passwordHash = await bcrypt.hash(password, 10);
      await this.prisma.usuario.create({
        data: { cuil, email, passwordHash, rolId: rolOperario.id },
      });
      creados.push({ cuil, apellido_nombre: emp.apellido_nombre, email, password });
    }
    return { creados, omitidos };
  }

  private async generarEmail(legajo: number, cuil: string): Promise<string> {
    const base = legajo && legajo > 0 ? String(legajo) : cuil;
    let email = `${base}@st.local`;
    let n = 1;
    while (await this.prisma.usuario.findUnique({ where: { email } })) {
      email = `${base}-${n}@st.local`;
      n++;
    }
    return email;
  }

  private generarPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let p = '';
    for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
    return p;
  }
}
