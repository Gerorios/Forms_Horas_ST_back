import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CertClaim } from './accesos.service';
import { CrearItemDto, ActualizarItemDto } from './dto/item.dto';

export interface ItemCert {
  id_item: number;
  item_codigo: string;
  codigo_k: string;
  grupo: string | null;
  subgrupo: string | null;
  tarea: string;
  frecuencia: string | null;
  contratista: string | null;
  ptos_gasnor: number | null;
  unidad_medida: string | null;
  tipo: string | null;
  contrato_nombre: string | null;
}

const escaparLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

/**
 * ABM del maestro de ítems (portado de app/routers/items.py del portal).
 * Solo nivel admin del claim cert. Fixes conscientes vs el portal: sin
 * LIMIT 500, LIKE escapado, tarea obligatoria (la columna es NOT NULL).
 */
@Injectable()
export class ItemsService {
  constructor(private readonly prisma: PrismaService) {}

  private exigirAdminItems(cert: CertClaim | null): void {
    if (!cert || cert.nivel !== 'admin') {
      throw new ForbiddenException('El maestro de ítems es solo para nivel admin.');
    }
  }

  async listar(f: { codigoK?: string; buscar?: string }, cert: CertClaim | null): Promise<ItemCert[]> {
    this.exigirAdminItems(cert);
    const conds: Prisma.Sql[] = [];
    if (f.codigoK) conds.push(Prisma.sql`dc.codigo_k = ${f.codigoK.toUpperCase()}`);
    if (f.buscar) {
      const patron = `%${escaparLike(f.buscar)}%`;
      conds.push(Prisma.sql`(di.item_codigo LIKE ${patron} OR di.tarea LIKE ${patron})`);
    }
    const where = conds.length ? Prisma.sql` AND ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT di.id_item, di.item_codigo, dc.codigo_k,
             di.grupo, di.subgrupo, di.tarea, di.frecuencia, di.contratista,
             di.ptos_gasnor, di.unidad_medida, di.tipo, di.contrato_nombre
      FROM sth_cert_items di
      JOIN sth_cert_contratos dc ON di.id_contrato = dc.id_contrato
      WHERE 1=1 ${where}
      ORDER BY dc.codigo_k, di.item_codigo
    `);
    return rows.map((r) => ({
      ...r,
      id_item: Number(r.id_item),
      ptos_gasnor: r.ptos_gasnor == null ? null : Number(r.ptos_gasnor),
    }));
  }

  private async resolverContrato(codigoK: string): Promise<{ id_contrato: number; codigo_k: string }> {
    const contrato = await this.prisma.certContratoErp.findFirst({
      where: { codigo_k: codigoK.toUpperCase() },
      select: { id_contrato: true, codigo_k: true },
    });
    if (!contrato) throw new BadRequestException(`Contrato ${codigoK} no encontrado`);
    return contrato;
  }

  /** Unicidad normalizada punto≡coma dentro del contrato (regla del portal),
   * excluyendo opcionalmente el propio ítem (para el caso "mover de contrato"). */
  private async existeDuplicado(itemCodigo: string, idContrato: number, exceptoId = 0): Promise<boolean> {
    const filas = await this.prisma.$queryRaw<{ id_item: number }[]>(Prisma.sql`
      SELECT id_item FROM sth_cert_items
      WHERE REPLACE(item_codigo, '.', ',') = REPLACE(${itemCodigo}, '.', ',')
        AND id_contrato = ${idContrato} AND id_item != ${exceptoId}
      LIMIT 1
    `);
    return filas.length > 0;
  }

  async crear(dto: CrearItemDto, cert: CertClaim | null): Promise<{ mensaje: string }> {
    this.exigirAdminItems(cert);
    const contrato = await this.resolverContrato(dto.codigo_k);
    if (await this.existeDuplicado(dto.item_codigo, contrato.id_contrato)) {
      throw new BadRequestException(`El ítem ${dto.item_codigo} ya existe en ${contrato.codigo_k}`);
    }
    await this.prisma.certItem.create({
      data: {
        item_codigo: dto.item_codigo.trim(),
        id_contrato: contrato.id_contrato,
        tarea: dto.tarea,
        grupo: dto.grupo ?? null,
        subgrupo: dto.subgrupo ?? null,
        frecuencia: dto.frecuencia ?? null,
        contratista: dto.contratista ?? null,
        ptos_gasnor: dto.ptos_gasnor ?? null,
        unidad_medida: dto.unidad_medida ?? null,
        tipo: dto.tipo ?? null,
        contrato_nombre: dto.contrato_nombre ?? null,
      },
    });
    return { mensaje: `Ítem ${dto.item_codigo} creado en ${contrato.codigo_k}` };
  }

  async actualizar(idItem: number, dto: ActualizarItemDto, cert: CertClaim | null): Promise<{ mensaje: string }> {
    this.exigirAdminItems(cert);
    const item = await this.prisma.certItem.findUnique({ where: { id_item: idItem } });
    if (!item) throw new NotFoundException('Ítem no encontrado');

    const data: Record<string, unknown> = {};
    const CAMPOS = ['tarea', 'grupo', 'subgrupo', 'frecuencia', 'contratista', 'ptos_gasnor', 'unidad_medida', 'tipo', 'contrato_nombre'] as const;
    for (const campo of CAMPOS) {
      if (dto[campo] !== undefined) data[campo] = dto[campo]; // null = borrar; ausente = no tocar
    }
    if (dto.codigo_k !== undefined) {
      const contrato = await this.resolverContrato(dto.codigo_k);
      if (contrato.id_contrato !== item.id_contrato &&
          (await this.existeDuplicado(item.item_codigo, contrato.id_contrato, idItem))) {
        throw new BadRequestException(`El ítem ${item.item_codigo} ya existe en ${contrato.codigo_k}`);
      }
      data.id_contrato = contrato.id_contrato;
    }
    if (Object.keys(data).length === 0) return { mensaje: 'Sin cambios' };
    await this.prisma.certItem.update({ where: { id_item: idItem }, data });
    return { mensaje: 'Ítem actualizado' };
  }

  async eliminar(idItem: number, cert: CertClaim | null): Promise<{ mensaje: string }> {
    this.exigirAdminItems(cert);
    const item = await this.prisma.certItem.findUnique({ where: { id_item: idItem } });
    if (!item) throw new NotFoundException('Ítem no encontrado');
    const [fila] = await this.prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) c FROM sth_cert_certificaciones WHERE id_item = ${idItem}
    `);
    const enUso = Number(fila.c);
    if (enUso > 0) {
      throw new BadRequestException(`No se puede eliminar: el ítem tiene ${enUso} certificaciones cargadas`);
    }
    await this.prisma.certItem.delete({ where: { id_item: idItem } });
    return { mensaje: 'Ítem eliminado' };
  }
}
