import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContratoDto, UpdateContratoDto } from './dto/contrato.dto';
import { CreateTareaDto, UpdateTareaDto, CreateMovilDto, UpdateMovilDto, CreateProvinciaDto, UpdateProvinciaDto, CreateTipoNovedadDto, UpdateTipoNovedadDto, ToggleActivoDto } from './dto/catalogo.dto';
import { CreateUsuarioDto, UpdateUsuarioDto } from './dto/usuario.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  getRoles() {
    return this.prisma.rol.findMany({ orderBy: { nombre: 'asc' } });
  }

  async getContratos() {
    const contratos = await this.prisma.contrato.findMany({
      include: { jefes: { select: { usuarioCuil: true } } },
      orderBy: { codigo: 'asc' },
    });
    return contratos.map(({ jefes, ...c }) => ({
      ...c,
      jefesCuils: jefes.map((j) => j.usuarioCuil),
    }));
  }

  createContrato(dto: CreateContratoDto) {
    return this.prisma.contrato.create({ data: dto });
  }

  async updateContrato(id: number, dto: UpdateContratoDto) {
    const { jefesCuils, ...rest } = dto;

    if (jefesCuils !== undefined) {
      await this.prisma.contratoJefe.deleteMany({ where: { contratoId: id } });
      if (jefesCuils.length) {
        await this.prisma.contratoJefe.createMany({
          data: jefesCuils.map((usuarioCuil) => ({ contratoId: id, usuarioCuil })),
        });
      }
    }

    return this.prisma.contrato.update({ where: { id }, data: rest });
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

  updateMovil(id: number, dto: UpdateMovilDto) {
    return this.prisma.movil.update({ where: { id }, data: dto });
  }

  async createMovilesMasivo(identificadores: string[]) {
    // Se recorta espacios y se dedupe antes de comparar, para no tratar como
    // duplicado algo que solo difiere en espacios en blanco.
    const limpios = [...new Set(identificadores.map((i) => i.trim()).filter(Boolean))];

    const existentes = await this.prisma.movil.findMany({
      where: { identificador: { in: limpios } },
      select: { identificador: true },
    });
    const existentesSet = new Set(existentes.map((e) => e.identificador));

    const creados = limpios.filter((i) => !existentesSet.has(i));
    const omitidos = limpios.filter((i) => existentesSet.has(i));

    if (creados.length) {
      await this.prisma.movil.createMany({
        data: creados.map((identificador) => ({ identificador })),
      });
    }

    return { creados, omitidos };
  }

  getProvincias() {
    return this.prisma.provincia.findMany({ orderBy: { nombre: 'asc' } });
  }

  createProvincia(dto: CreateProvinciaDto) {
    return this.prisma.provincia.create({ data: dto });
  }

  updateProvincia(id: number, dto: UpdateProvinciaDto) {
    return this.prisma.provincia.update({ where: { id }, data: dto });
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

  updateTipoNovedad(id: number, dto: UpdateTipoNovedadDto) {
    return this.prisma.tipoNovedad.update({ where: { id }, data: dto });
  }

  async getUsuarios() {
    const usuarios = await this.prisma.usuario.findMany({
      select: {
        cuil: true,
        email: true,
        activo: true,
        rolId: true,
        nombreFueraNomina: true,
        rol: { select: { nombre: true } },
        contratosHabilitados: {
          select: { contratoId: true, contrato: { select: { codigo: true } } },
        },
        contratosComoJefe: {
          select: { contrato: { select: { id: true, codigo: true } } },
        },
        tiposNovedadHabilitados: {
          select: { tipoNovedadId: true, tipoNovedad: { select: { nombre: true } } },
        },
      },
      orderBy: { cuil: 'asc' },
    });

    // snuempleados no tiene FK física (ver ADR-008): se resuelve el nombre a
    // mano, con fallback a nombreFueraNomina para usuarios sin empleado real.
    const empleados = await this.prisma.snuempleados.findMany({
      where: { cuil: { in: usuarios.map((u) => u.cuil) } },
      select: { cuil: true, apellido_nombre: true },
    });
    const nombrePorCuil = new Map(empleados.map((e) => [e.cuil, e.apellido_nombre]));

    return usuarios.map(({ nombreFueraNomina, contratosComoJefe, ...u }) => ({
      ...u,
      contratosComoJefe: contratosComoJefe.map((cj) => cj.contrato),
      empleado: { apellido_nombre: nombrePorCuil.get(u.cuil) ?? nombreFueraNomina ?? '' },
    }));
  }

  async createUsuario(dto: CreateUsuarioDto) {
    const existe = await this.prisma.usuario.findUnique({ where: { cuil: dto.cuil } });
    if (existe) throw new ConflictException('Ya existe un usuario con ese CUIL');

    if (!dto.nombreFueraNomina) {
      const empleado = await this.prisma.snuempleados.findUnique({ where: { cuil: dto.cuil } });
      if (!empleado) {
        throw new BadRequestException(
          'No existe un empleado con ese CUIL. Si la persona no está en la nómina, completá su nombre.',
        );
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const usuario = await this.prisma.usuario.create({
      data: {
        cuil: dto.cuil,
        email: dto.email,
        passwordHash,
        rolId: dto.rolId,
        nombreFueraNomina: dto.nombreFueraNomina,
        contratosHabilitados: dto.contratosIds?.length
          ? { create: dto.contratosIds.map((contratoId) => ({ contratoId })) }
          : undefined,
        tiposNovedadHabilitados: dto.tiposNovedadIds?.length
          ? { create: dto.tiposNovedadIds.map((tipoNovedadId) => ({ tipoNovedadId })) }
          : undefined,
      },
    });

    if (dto.contratosJefeIds?.length) {
      await this.prisma.contratoJefe.createMany({
        data: dto.contratosJefeIds.map((contratoId) => ({ contratoId, usuarioCuil: dto.cuil })),
      });
    }

    return usuario;
  }

  async updateUsuario(cuil: string, dto: UpdateUsuarioDto) {
    const { password, contratosIds, contratosJefeIds, tiposNovedadIds, ...rest } = dto;
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

    if (tiposNovedadIds !== undefined) {
      await this.prisma.tipoNovedadHabilitado.deleteMany({ where: { usuarioCuil: cuil } });
      if (tiposNovedadIds.length) {
        await this.prisma.tipoNovedadHabilitado.createMany({
          data: tiposNovedadIds.map((tipoNovedadId) => ({ usuarioCuil: cuil, tipoNovedadId })),
        });
      }
    }

    if (contratosJefeIds !== undefined) {
      // Set completo de contratos de los que este usuario es Jefe (M:N, ver
      // ADR-012): solo toca filas de este cuil, sin afectar a otros jefes del
      // mismo contrato.
      await this.prisma.contratoJefe.deleteMany({ where: { usuarioCuil: cuil } });
      if (contratosJefeIds.length) {
        await this.prisma.contratoJefe.createMany({
          data: contratosJefeIds.map((contratoId) => ({ contratoId, usuarioCuil: cuil })),
        });
      }
    }

    return this.prisma.usuario.update({ where: { cuil }, data });
  }

  async resetearPassword(cuil: string) {
    const passwordHash = await bcrypt.hash(cuil, 10);
    await this.prisma.usuario.update({ where: { cuil }, data: { passwordHash } });
    return { cuil, password: cuil };
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
      const password = cuil;
      const passwordHash = await bcrypt.hash(password, 10);
      await this.prisma.usuario.create({
        data: { cuil, email, passwordHash, rolId: rolOperario.id },
      });
      creados.push({ cuil, apellido_nombre: emp.apellido_nombre, email, password });
    }
    return { creados, omitidos };
  }

  // --- Estaciones de servicio (ADR-013) ---
  getEstacionesServicio() {
    return this.prisma.estacionServicio.findMany({ orderBy: { nombre: 'asc' } });
  }
  crearEstacionServicio(dto: { nombre: string; localidad?: string }) {
    return this.prisma.estacionServicio.create({ data: { nombre: dto.nombre, localidad: dto.localidad } });
  }
  actualizarEstacionServicio(id: number, dto: { nombre?: string; localidad?: string }) {
    return this.prisma.estacionServicio.update({ where: { id }, data: dto });
  }
  toggleEstacionServicio(id: number, activo: boolean) {
    return this.prisma.estacionServicio.update({ where: { id }, data: { activo } });
  }
  // --- Tipos de combustible (ADR-013) ---
  getTiposCombustible() {
    return this.prisma.tipoCombustible.findMany({ orderBy: { nombre: 'asc' } });
  }
  crearTipoCombustible(dto: { nombre: string }) {
    return this.prisma.tipoCombustible.create({ data: { nombre: dto.nombre } });
  }
  actualizarTipoCombustible(id: number, dto: { nombre?: string }) {
    return this.prisma.tipoCombustible.update({ where: { id }, data: dto });
  }
  toggleTipoCombustible(id: number, activo: boolean) {
    return this.prisma.tipoCombustible.update({ where: { id }, data: { activo } });
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
}
