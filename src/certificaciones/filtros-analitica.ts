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
