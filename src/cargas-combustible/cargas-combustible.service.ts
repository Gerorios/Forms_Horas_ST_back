import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TICKET_STORAGE, TicketStorage } from './storage/ticket-storage.interface';
import { CreateCargaCombustibleDto } from './dto/create-carga-combustible.dto';
import { UpdateCargaCombustibleDto } from './dto/update-carga-combustible.dto';
import { FiltroCargasDto } from './dto/filtro-cargas.dto';

const TABLA_AUDITORIA = 'sth_cargas_combustible';

@Injectable()
export class CargasCombustibleService {
  constructor(
    private prisma: PrismaService,
    @Inject(TICKET_STORAGE) private storage: TicketStorage,
  ) {}

  private async validarTareasHabilitadas(tareaIds: number[], cuil: string): Promise<void> {
    const tareas = await this.prisma.tareaCatalogo.findMany({ where: { id: { in: tareaIds } }, select: { id: true, contratoId: true } });
    if (tareas.length !== tareaIds.length) throw new BadRequestException('Alguna tarea no existe');
    const habilitados = await this.prisma.contratoHabilitado.findMany({ where: { usuarioCuil: cuil }, select: { contratoId: true } });
    const set = new Set(habilitados.map((h) => h.contratoId));
    if (tareas.some((t) => !set.has(t.contratoId))) throw new ForbiddenException('Tarea de un contrato no habilitado');
  }

  async crear(dto: CreateCargaCombustibleDto, foto: { buffer: Buffer; mimetype: string }, cuil: string) {
    await this.validarTareasHabilitadas(dto.tareaIds, cuil);
    if (foto.mimetype !== 'image/jpeg' && foto.mimetype !== 'image/png') throw new BadRequestException('La foto debe ser JPEG o PNG');
    const fotoPath = await this.storage.guardar(foto.buffer, foto.mimetype);
    return this.prisma.$transaction(async (tx) => {
      const carga = await tx.cargaCombustible.create({
        data: {
          fechaCarga: new Date(dto.fechaCarga), cargadoPorCuil: cuil, movilId: dto.movilId,
          litros: dto.litros, monto: dto.monto, km: dto.km, medioPago: dto.medioPago,
          nroComprobante: dto.nroComprobante, estacionId: dto.estacionId,
          tipoCombustibleId: dto.tipoCombustibleId, provinciaId: dto.provinciaId,
          observaciones: dto.observaciones, fotoPath,
          tareas: { createMany: { data: dto.tareaIds.map((tareaId) => ({ tareaId })) } },
        },
      });
      await tx.auditoria.create({ data: { tabla: TABLA_AUDITORIA, registroId: carga.id, usuarioCuil: cuil, accion: 'crear' } });
      return carga;
    });
  }

  async ultimoKm(movilId: number) {
    const ultima = await this.prisma.cargaCombustible.findFirst({
      where: { movilId, estado: 'activa' },
      orderBy: [{ fechaCarga: 'desc' }, { id: 'desc' }],
      select: { km: true, fechaCarga: true },
    });
    return ultima ? { km: ultima.km, fechaCarga: ultima.fechaCarga } : { km: null, fechaCarga: null };
  }

  private readonly includeDetalle = {
    movil: { select: { id: true, identificador: true } },
    estacion: { select: { id: true, nombre: true } },
    tipoCombustible: { select: { id: true, nombre: true } },
    provincia: { select: { id: true, nombre: true } },
    tareas: { include: { tarea: { select: { id: true, nombre: true, contrato: { select: { id: true, codigo: true } } } } } },
  } as const;

  private async whereAlcance(usuario: { cuil: string; rol: string }) {
    if (usuario.rol === 'Admin') return {};
    if (usuario.rol === 'JefeContrato') {
      const contratos = await this.prisma.contratoJefe.findMany({ where: { usuarioCuil: usuario.cuil }, select: { contratoId: true } });
      return { tareas: { some: { tarea: { contratoId: { in: contratos.map((c) => c.contratoId) } } } } };
    }
    return { cargadoPorCuil: usuario.cuil };
  }

  async listar(filtro: FiltroCargasDto, usuario: { cuil: string; rol: string }) {
    const alcance = await this.whereAlcance(usuario);
    return this.prisma.cargaCombustible.findMany({
      where: {
        ...alcance,
        ...(filtro.desde || filtro.hasta ? { fechaCarga: { ...(filtro.desde && { gte: new Date(filtro.desde) }), ...(filtro.hasta && { lte: new Date(filtro.hasta) }) } } : {}),
        ...(filtro.movilId !== undefined && { movilId: filtro.movilId }),
        ...(filtro.estado && { estado: filtro.estado }),
      },
      include: this.includeDetalle,
      orderBy: [{ fechaCarga: 'desc' }, { id: 'desc' }],
    });
  }

  private async puedeVer(carga: { cargadoPorCuil: string; tareas: { tarea?: { contrato?: { id: number } | null } | null }[] }, usuario: { cuil: string; rol: string }) {
    if (usuario.rol === 'Admin') return true;
    if (usuario.rol === 'JefeContrato') {
      const contratos = await this.prisma.contratoJefe.findMany({ where: { usuarioCuil: usuario.cuil }, select: { contratoId: true } });
      const set = new Set(contratos.map((c) => c.contratoId));
      return carga.tareas.some((t) => t.tarea?.contrato && set.has(t.tarea.contrato.id));
    }
    return carga.cargadoPorCuil === usuario.cuil;
  }

  async detalle(id: number, usuario: { cuil: string; rol: string }) {
    const carga = await this.prisma.cargaCombustible.findUnique({ where: { id }, include: this.includeDetalle });
    if (!carga) throw new NotFoundException('Carga de combustible no encontrada');
    if (!(await this.puedeVer(carga as any, usuario))) throw new ForbiddenException();
    return carga;
  }

  async ticket(id: number, usuario: { cuil: string; rol: string }) {
    const carga = await this.detalle(id, usuario);
    return this.storage.leer(carga.fotoPath);
  }

  private puedeModificar(carga: { cargadoPorCuil: string; estado: string }, usuario: { cuil: string; rol: string }) {
    if (carga.estado !== 'activa') throw new BadRequestException('La carga está anulada');
    if (usuario.rol !== 'Admin' && carga.cargadoPorCuil !== usuario.cuil) throw new ForbiddenException();
  }

  async editar(id: number, dto: UpdateCargaCombustibleDto, foto: { buffer: Buffer; mimetype: string } | undefined, usuario: { cuil: string; rol: string }) {
    const carga = await this.prisma.cargaCombustible.findUnique({ where: { id }, include: { tareas: true } });
    if (!carga) throw new NotFoundException('Carga de combustible no encontrada');
    this.puedeModificar(carga, usuario);
    if (dto.tareaIds) await this.validarTareasHabilitadas(dto.tareaIds, usuario.rol === 'Admin' ? carga.cargadoPorCuil : usuario.cuil);

    const data: Record<string, unknown> = {};
    for (const campo of ['movilId', 'litros', 'monto', 'km', 'medioPago', 'nroComprobante', 'estacionId', 'tipoCombustibleId', 'provinciaId', 'observaciones'] as const) {
      if (dto[campo] !== undefined) data[campo] = dto[campo];
    }
    if (dto.fechaCarga !== undefined) data.fechaCarga = new Date(dto.fechaCarga);
    if (foto) {
      if (foto.mimetype !== 'image/jpeg' && foto.mimetype !== 'image/png') throw new BadRequestException('La foto debe ser JPEG o PNG');
      data.fotoPath = await this.storage.guardar(foto.buffer, foto.mimetype); // la anterior se conserva como respaldo
    }
    if (dto.tareaIds) data.tareas = { deleteMany: {}, createMany: { data: dto.tareaIds.map((tareaId) => ({ tareaId })) } };

    const valorAnterior: Record<string, unknown> = {};
    const valorNuevo: Record<string, unknown> = {};
    for (const key of Object.keys(data)) {
      if (key === 'tareas') continue;
      valorAnterior[key] = (carga as Record<string, unknown>)[key];
      valorNuevo[key] = data[key];
    }
    if (dto.tareaIds) {
      valorAnterior.tareaIds = carga.tareas.map((t) => t.tareaId);
      valorNuevo.tareaIds = dto.tareaIds;
    }

    return this.prisma.$transaction(async (tx) => {
      const actualizada = await tx.cargaCombustible.update({ where: { id }, data });
      await tx.auditoria.create({ data: {
        tabla: TABLA_AUDITORIA, registroId: id, usuarioCuil: usuario.cuil, accion: 'editar',
        valorAnterior: JSON.stringify(valorAnterior),
        valorNuevo: JSON.stringify(valorNuevo),
      }});
      return actualizada;
    });
  }

  async anular(id: number, motivo: string, usuario: { cuil: string; rol: string }) {
    const carga = await this.prisma.cargaCombustible.findUnique({ where: { id }, include: { tareas: true } });
    if (!carga) throw new NotFoundException('Carga de combustible no encontrada');
    this.puedeModificar(carga, usuario);
    return this.prisma.$transaction(async (tx) => {
      const anulada = await tx.cargaCombustible.update({ where: { id }, data: {
        estado: 'anulada', motivoAnulacion: motivo, anuladaPorCuil: usuario.cuil, anuladaEn: new Date(),
      }});
      await tx.auditoria.create({ data: {
        tabla: TABLA_AUDITORIA, registroId: id, usuarioCuil: usuario.cuil, accion: 'anular',
        campo: 'estado', valorAnterior: 'activa', valorNuevo: 'anulada',
      }});
      return anulada;
    });
  }
}
