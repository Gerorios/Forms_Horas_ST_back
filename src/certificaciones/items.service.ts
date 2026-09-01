import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CertClaim } from './accesos.service';

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
}
