import { Prisma } from '@prisma/client';
import { CertClaim } from './accesos.service';

export interface FiltrosAnalitica {
  desde?: string;
  hasta?: string;
  contratos?: string[];
  provincias?: string[];
  tipo?: string;
}

/** Query params repetidos de Nest (`?contratos=A&contratos=B`) llegan como
 * string o string[]; esto los normaliza a lista. */
export function aLista(v: unknown): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

/**
 * Fragmento `AND ...` para anexar a `WHERE 1=1` en las queries de analítica
 * (misma semántica que `_filtros()` del portal FastAPI, con dos correcciones
 * conscientes: bind params en vez de interpolación, y fail-closed — `null` —
 * cuando un nivel `carga` filtra solo por contratos ajenos).
 */
export function condicionesFiltros(f: FiltrosAnalitica, cert: CertClaim): Prisma.Sql | null {
  const conds: Prisma.Sql[] = [];
  if (f.desde) conds.push(Prisma.sql`DATE_FORMAT(fc.fecha, '%Y-%m') >= ${f.desde}`);
  if (f.hasta) conds.push(Prisma.sql`DATE_FORMAT(fc.fecha, '%Y-%m') <= ${f.hasta}`);

  let ks: string[] | null = null;
  if (cert.nivel === 'carga') {
    const propios = cert.ks.map((k) => k.toUpperCase());
    const pedidos = (f.contratos ?? []).map((k) => k.toUpperCase());
    ks = pedidos.length ? pedidos.filter((k) => propios.includes(k)) : propios;
    if (ks.length === 0) return null; // fail-closed: nada visible
  } else if (f.contratos?.length) {
    ks = f.contratos;
  }
  if (ks?.length) conds.push(Prisma.sql`dc.codigo_k IN (${Prisma.join(ks)})`);

  if (f.provincias?.length) conds.push(Prisma.sql`pv.provincia IN (${Prisma.join(f.provincias)})`);
  if (f.tipo === 'OPEX' || f.tipo === 'CAPEX') conds.push(Prisma.sql`fc.tipo = ${f.tipo}`);

  return conds.length ? Prisma.sql` AND ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
}

/** Los filtros de fecha de la analítica son MENSUALES (las certificaciones
 * llevan fecha día 1 del mes y el SQL compara `DATE_FORMAT(fecha,'%Y-%m')`
 * como texto). El front manda el `<input type="date">` completo
 * ('2026-01-01'); si llegara así al SQL, '2026-01' < '2026-01-01' y el mes
 * de inicio quedaba afuera (bug heredado del portal, reporte 2026-09-03).
 * Se recorta a 'YYYY-MM'; lo que no parece una fecha se descarta. */
export function aPeriodoMensual(v: unknown): string | undefined {
  if (v == null) return undefined;
  const m = /^(\d{4}-\d{2})/.exec(String(v).trim());
  return m ? m[1] : undefined;
}

/** Normaliza los query params crudos del controller a `FiltrosAnalitica`. */
export function filtrosDesdeQuery(q: Record<string, unknown>): FiltrosAnalitica {
  return {
    desde: aPeriodoMensual(q.desde),
    hasta: aPeriodoMensual(q.hasta),
    contratos: aLista(q.contratos),
    provincias: aLista(q.provincias),
    tipo: q.tipo ? String(q.tipo) : undefined,
  };
}
