import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CertClaim } from './accesos.service';

const num = (x: unknown) => (x == null ? 0 : Number(x));
const fechaISO = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

@Injectable()
export class ResumenService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resumen por período × contrato × tipo (portado de /certificaciones/resumen
   * del portal). LIMIT 200 como el original — el filtro de período lo hace el
   * frontend client-side; si el volumen crece, agregar filtro server-side. */
  async resumen(cert: CertClaim | null) {
    if (!cert) throw new ForbiddenException('Sin acceso al módulo Certificaciones.');
    let filtro = Prisma.empty;
    if (cert.nivel === 'carga') {
      if (cert.ks.length === 0) return []; // fix: el portal generaba IN () inválido
      filtro = Prisma.sql`AND dc.codigo_k IN (${Prisma.join(cert.ks)})`;
    }
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT DATE_FORMAT(fc.fecha, '%Y-%m') AS periodo,
             dc.codigo_k AS contrato,
             fc.tipo,
             COUNT(*) AS lineas,
             SUM(fc.total_mes) AS monto_total
      FROM sth_cert_certificaciones fc
      JOIN sth_cert_contratos dc ON fc.id_contrato = dc.id_contrato
      WHERE 1=1 ${filtro}
      GROUP BY periodo, dc.codigo_k, fc.tipo
      ORDER BY periodo DESC, dc.codigo_k
      LIMIT 200
    `);
    return rows.map((r) => ({
      periodo: r.periodo, contrato: r.contrato, tipo: r.tipo,
      lineas: num(r.lineas), monto_total: num(r.monto_total),
    }));
  }

  /** Consumo del presupuesto Naturgy vigente por contrato. Solo niveles
   * admin/lectura (el portal exigía gerente|admin; carga → 403). */
  async presupuesto(cert: CertClaim | null) {
    if (!cert || cert.nivel === 'carga') {
      throw new ForbiddenException('Sin acceso al presupuesto por contrato.');
    }
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT dc.codigo_k AS contrato,
             dc.descripcion AS descripcion,
             dp.periodo_desde, dp.periodo_hasta, dp.monto_presupuesto,
             COALESCE(SUM(fc.total_mes), 0) AS consumido
      FROM sth_cert_presupuestos dp
      JOIN sth_cert_contratos dc ON dp.id_contrato = dc.id_contrato
      LEFT JOIN sth_cert_certificaciones fc
             ON fc.id_contrato = dp.id_contrato
            AND fc.fecha BETWEEN dp.periodo_desde AND dp.periodo_hasta
      WHERE dp.activo = 1
      GROUP BY dc.codigo_k, dc.descripcion, dp.periodo_desde, dp.periodo_hasta, dp.monto_presupuesto
      ORDER BY (COALESCE(SUM(fc.total_mes), 0) / dp.monto_presupuesto) DESC
    `);
    return rows.map((r) => {
      const monto = num(r.monto_presupuesto);
      const consumido = num(r.consumido);
      return {
        contrato: r.contrato, descripcion: r.descripcion,
        periodo_desde: fechaISO(r.periodo_desde), periodo_hasta: fechaISO(r.periodo_hasta),
        monto_presupuesto: monto, consumido,
        pct: monto ? Math.round((consumido / monto) * 1000) / 10 : 0,
      };
    });
  }
}
