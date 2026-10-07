import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PeriodoDto, RangoDto } from './dto/config.dto';
import { dateADia, diaADate, hoyAr, seSuperponen } from './reglas';

export interface Rango {
  /** Período guardado del que sale el rango; null = rango libre o sin período. */
  periodo: { id: number; nombre: string; desde: string; hasta: string } | null;
  /** Bordes incluidos, 'YYYY-MM-DD'. null = sin límite. */
  desde: string | null;
  hasta: string | null;
}

/** Períodos de medición que define HyS (CONTEXT.md, "Período"): con nombre,
 * sin superponerse, con huecos permitidos. El actual es el que contiene hoy. */
@Injectable()
export class PeriodosService {
  constructor(private prisma: PrismaService) {}

  private presentar(p: { id: number; nombre: string; desde: Date; hasta: Date }) {
    return { id: p.id, nombre: p.nombre, desde: dateADia(p.desde), hasta: dateADia(p.hasta) };
  }

  async listar() {
    const periodos = await this.prisma.segPeriodo.findMany({ orderBy: { desde: 'desc' } });
    const hoy = hoyAr();
    return periodos.map((p) => {
      const v = this.presentar(p);
      return { ...v, actual: v.desde <= hoy && hoy <= v.hasta };
    });
  }

  async actual() {
    const hoy = diaADate(hoyAr());
    const p = await this.prisma.segPeriodo.findFirst({ where: { desde: { lte: hoy }, hasta: { gte: hoy } } });
    return p ? this.presentar(p) : null;
  }

  /** Rango de una consulta: el período pedido, o desde/hasta libres (solo si
   * `permitirLibre`), o el período actual. Sin período actual, sin límites. */
  async resolverRango(q: RangoDto, permitirLibre: boolean): Promise<Rango> {
    if (q.periodoId) {
      const p = await this.prisma.segPeriodo.findUnique({ where: { id: q.periodoId } });
      if (!p) throw new NotFoundException('Período no encontrado');
      const v = this.presentar(p);
      return { periodo: v, desde: v.desde, hasta: v.hasta };
    }
    if (permitirLibre && (q.desde || q.hasta)) {
      const desde = q.desde?.slice(0, 10) ?? null;
      const hasta = q.hasta?.slice(0, 10) ?? null;
      if (desde && hasta && hasta < desde) throw new BadRequestException('El rango termina antes de empezar');
      return { periodo: null, desde, hasta };
    }
    const actual = await this.actual();
    return actual ? { periodo: actual, desde: actual.desde, hasta: actual.hasta } : { periodo: null, desde: null, hasta: null };
  }

  private async validar(dto: PeriodoDto, excluirId?: number) {
    const desde = dto.desde.slice(0, 10);
    const hasta = dto.hasta.slice(0, 10);
    if (hasta < desde) throw new BadRequestException('El período termina antes de empezar');
    const otros = await this.prisma.segPeriodo.findMany({ where: excluirId ? { id: { not: excluirId } } : {} });
    const choca = otros.map((p) => this.presentar(p)).find((p) => seSuperponen(p, { desde, hasta }));
    if (choca) {
      throw new BadRequestException(
        `Se superpone con "${choca.nombre}" (${choca.desde} a ${choca.hasta}): un reporte caería en dos rankings`,
      );
    }
    const mismoNombre = otros.find((p) => p.nombre.trim().toLowerCase() === dto.nombre.trim().toLowerCase());
    if (mismoNombre) throw new BadRequestException('Ya existe un período con ese nombre');
    return { nombre: dto.nombre.trim(), desde: diaADate(desde), hasta: diaADate(hasta) };
  }

  async crear(dto: PeriodoDto, cuil: string) {
    const data = await this.validar(dto);
    return this.presentar(await this.prisma.segPeriodo.create({ data: { ...data, creadoPorCuil: cuil } }));
  }

  async editar(id: number, dto: PeriodoDto) {
    if (!(await this.prisma.segPeriodo.findUnique({ where: { id } }))) throw new NotFoundException('Período no encontrado');
    const data = await this.validar(dto, id);
    return this.presentar(await this.prisma.segPeriodo.update({ where: { id }, data }));
  }

  /** Borrar un período no toca ningún punto: los movimientos tienen fecha,
   * no período. */
  async borrar(id: number) {
    if (!(await this.prisma.segPeriodo.findUnique({ where: { id } }))) throw new NotFoundException('Período no encontrado');
    await this.prisma.segPeriodo.delete({ where: { id } });
    return { ok: true };
  }
}
