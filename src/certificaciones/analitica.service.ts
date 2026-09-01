import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CertClaim } from './accesos.service';
import { condicionesFiltros, FiltrosAnalitica } from './filtros-analitica';
import { armarInteranual, InteranualResponse } from './interanual';
import { construirEstadoCargas, CargaLogFila, EstadoCargaContrato } from './estado-cargas';

const num = (x: unknown) => (x == null ? 0 : Number(x));

/**
 * Endpoints de analítica del módulo Certificaciones, portados 1:1 del
 * FastAPI del portal (app/routers/analytics.py) sobre las tablas mudadas
 * sth_cert_* (spec etapa 2). PGN = SUM(cantidades * COALESCE(ptos_gasnor,0)),
 * con ptos_gasnor de la certificación (no del maestro) para calzar con PBI.
 */
@Injectable()
export class AnaliticaService {
  constructor(private readonly prisma: PrismaService) {}

  private exigirClaim(cert: CertClaim | null): CertClaim {
    if (!cert) throw new ForbiddenException('Sin acceso al módulo Certificaciones.');
    return cert;
  }

  // FROM compartido: fact ⋈ contrato ⋈ provincia (INNER, como el portal).
  private readonly fromBase = Prisma.sql`
    FROM sth_cert_certificaciones fc
    JOIN sth_cert_contratos  dc ON fc.id_contrato  = dc.id_contrato
    JOIN sth_cert_provincias pv ON fc.id_provincia = pv.id
  `;

  async evolucionMensual(f: FiltrosAnalitica, certIn: CertClaim | null) {
    const cert = this.exigirClaim(certIn);
    const cond = condicionesFiltros(f, cert);
    if (cond === null) return [];
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT DATE_FORMAT(fc.fecha, '%Y-%m') AS periodo,
             SUM(fc.total_mes) AS monto_total,
             SUM(fc.cantidades * COALESCE(fc.ptos_gasnor, 0)) AS pgn_total
      ${this.fromBase}
      WHERE 1=1 ${cond}
      GROUP BY periodo ORDER BY periodo ASC
    `);
    return rows.map((r) => ({ periodo: r.periodo, monto_total: num(r.monto_total), pgn_total: num(r.pgn_total) }));
  }

  async porContratoMes(f: FiltrosAnalitica, certIn: CertClaim | null) {
    const cert = this.exigirClaim(certIn);
    const cond = condicionesFiltros(f, cert);
    if (cond === null) return [];
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT DATE_FORMAT(fc.fecha, '%Y-%m') AS periodo,
             dc.codigo_k AS contrato,
             SUM(fc.total_mes) AS monto_total,
             SUM(fc.cantidades * COALESCE(fc.ptos_gasnor, 0)) AS pgn_total
      ${this.fromBase}
      WHERE 1=1 ${cond}
      GROUP BY periodo, dc.codigo_k
      ORDER BY periodo ASC, dc.codigo_k
    `);
    return rows.map((r) => ({
      periodo: r.periodo, contrato: r.contrato,
      monto_total: num(r.monto_total), pgn_total: num(r.pgn_total),
    }));
  }

  async porProvincia(f: FiltrosAnalitica, certIn: CertClaim | null) {
    const cert = this.exigirClaim(certIn);
    const cond = condicionesFiltros(f, cert);
    if (cond === null) return [];
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT pv.provincia,
             SUM(fc.total_mes) AS monto_total,
             SUM(fc.cantidades * COALESCE(fc.ptos_gasnor, 0)) AS pgn_total,
             COUNT(*) AS lineas
      ${this.fromBase}
      WHERE 1=1 ${cond}
      GROUP BY pv.provincia
      ORDER BY monto_total DESC
    `);
    return rows.map((r) => ({
      provincia: r.provincia,
      monto_total: num(r.monto_total), pgn_total: num(r.pgn_total), lineas: num(r.lineas),
    }));
  }

  async topItems(f: FiltrosAnalitica, certIn: CertClaim | null, limite = 10) {
    const cert = this.exigirClaim(certIn);
    const cond = condicionesFiltros(f, cert);
    if (cond === null) return [];
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT di.item_codigo,
             LEFT(fc.tarea, 60) AS tarea,
             dc.codigo_k AS contrato,
             SUM(fc.total_mes) AS monto_total,
             SUM(fc.cantidades * COALESCE(fc.ptos_gasnor, 0)) AS pgn_total
      FROM sth_cert_certificaciones fc
      JOIN sth_cert_items      di ON fc.id_item      = di.id_item
      JOIN sth_cert_contratos  dc ON fc.id_contrato  = dc.id_contrato
      JOIN sth_cert_provincias pv ON fc.id_provincia = pv.id
      WHERE 1=1 ${cond}
      GROUP BY di.item_codigo, fc.tarea, dc.codigo_k
      ORDER BY monto_total DESC
      LIMIT ${limite}
    `);
    return rows.map((r) => ({
      item_codigo: r.item_codigo, tarea: r.tarea, contrato: r.contrato,
      monto_total: num(r.monto_total), pgn_total: num(r.pgn_total),
    }));
  }

  async interanual(f: FiltrosAnalitica, certIn: CertClaim | null): Promise<InteranualResponse> {
    const cert = this.exigirClaim(certIn);
    const cond = condicionesFiltros({ ...f, desde: undefined, hasta: undefined }, cert);
    if (cond === null) return { anio_actual: null, anio_anterior: null, meses: [] };
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT YEAR(fc.fecha) AS anio, MONTH(fc.fecha) AS mes,
             SUM(fc.total_mes) AS monto_total,
             SUM(fc.cantidades * COALESCE(fc.ptos_gasnor, 0)) AS pgn_total
      ${this.fromBase}
      WHERE YEAR(fc.fecha) IN (YEAR(CURDATE()), YEAR(CURDATE()) - 1) ${cond}
      GROUP BY anio, mes
      ORDER BY mes ASC, anio ASC
    `);
    return armarInteranual(rows.map((r) => ({ ...r, anio: Number(r.anio), mes: Number(r.mes) })));
  }

  async contratos(certIn: CertClaim | null): Promise<string[]> {
    const cert = this.exigirClaim(certIn);
    if (cert.nivel === 'carga') return cert.ks; // como el portal: directo del claim
    const rows = await this.prisma.$queryRaw<{ codigo_k: string }[]>(
      Prisma.sql`SELECT codigo_k FROM sth_cert_contratos ORDER BY codigo_k`,
    );
    return rows.map((r) => r.codigo_k);
  }

  async provincias(certIn: CertClaim | null): Promise<string[]> {
    this.exigirClaim(certIn);
    const rows = await this.prisma.$queryRaw<{ provincia: string }[]>(
      Prisma.sql`SELECT provincia FROM sth_cert_provincias WHERE activo = 1 ORDER BY provincia`,
    );
    return rows.map((r) => r.provincia);
  }

  async estadoCargas(certIn: CertClaim | null): Promise<EstadoCargaContrato[]> {
    const cert = this.exigirClaim(certIn);
    const todosRows = await this.prisma.$queryRaw<{ codigo_k: string }[]>(
      Prisma.sql`SELECT codigo_k FROM sth_cert_contratos ORDER BY codigo_k`,
    );
    let todos = todosRows.map((r) => r.codigo_k);
    if (cert.nivel === 'carga') {
      const propios = new Set(cert.ks.map((k) => k.toUpperCase()));
      todos = todos.filter((k) => propios.has(k.toUpperCase()));
    }
    const cargas = await this.prisma.$queryRaw<CargaLogFila[]>(
      Prisma.sql`
      SELECT contrato, periodo, usuario_nombre, cargado_en, filas_cargadas, estado
      FROM sth_cert_cargas_log
      WHERE periodo >= '2025-01' AND estado != 'error'
      ORDER BY periodo DESC, contrato
    `,
    );
    return construirEstadoCargas(todos, cargas, new Date());
  }
}
