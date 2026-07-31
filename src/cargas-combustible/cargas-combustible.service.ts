import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TICKET_STORAGE, TicketStorage } from './storage/ticket-storage.interface';
import { CreateCargaCombustibleDto } from './dto/create-carga-combustible.dto';

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
      await tx.auditoria.create({ data: { tabla: 'sth_cargas_combustible', registroId: carga.id, usuarioCuil: cuil, accion: 'crear' } });
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
}
