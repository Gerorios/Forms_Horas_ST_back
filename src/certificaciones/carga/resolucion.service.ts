import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Resolución de contrato/ítem/provincia de la carga de certificaciones,
 * portada de app/services/carga.py del portal (ver
 * docs/superpowers/specs/2026-09-02-inventario-carga-portal.md §5).
 *
 * Servicio interno: la autorización (acceso por K, nivel del claim) NO va
 * acá — la aplica CargaService (Task 4), que es quien invoca a este
 * service. Todas las consultas son batch (sin N+1): una fila del Excel
 * nunca dispara una query individual.
 *
 * Normalización de código de ítem para comparar: REPLACE '.'→',' en ambos
 * lados (mismo criterio que items.service.ts y el portal).
 */

const normalizar = (codigo: string): string => (codigo ?? '').replace(/\./g, ',');

export interface MapaMaestro {
  /** clave: item_codigo normalizado (punto→coma); valor: Ks donde el maestro
   * tiene el ítem, en orden de `id_item` ascendente (determinismo). */
  contratosPorItem: Map<string, string[]>;
  existe(codigo: string): boolean;
}

interface IdsResueltos {
  idItem: number | null;
  idContrato: number | null;
  idProvincia: number | null;
  ptosGasnor: string | null;
}

@Injectable()
export class ResolucionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Carga en 1 sola query el maestro de ítems para el conjunto de códigos
   * del archivo, con sus Ks (ordenados por id_item).
   */
  async cargarMaestro(codigos: string[]): Promise<MapaMaestro> {
    const contratosPorItem = new Map<string, string[]>();
    const codigosNorm = [...new Set(codigos.map(normalizar).filter((c) => c !== ''))];

    if (codigosNorm.length > 0) {
      const rows = await this.prisma.$queryRaw<{ item_norm: string; codigo_k: string }[]>(Prisma.sql`
        SELECT REPLACE(di.item_codigo, '.', ',') AS item_norm, dc.codigo_k
        FROM sth_cert_items di
        JOIN sth_cert_contratos dc ON di.id_contrato = dc.id_contrato
        WHERE REPLACE(di.item_codigo, '.', ',') IN (${Prisma.join(codigosNorm)})
        ORDER BY di.id_item
      `);
      for (const r of rows) {
        const lista = contratosPorItem.get(r.item_norm);
        if (lista) lista.push(r.codigo_k);
        else contratosPorItem.set(r.item_norm, [r.codigo_k]);
      }
    }

    return {
      contratosPorItem,
      existe: (codigo: string) => {
        const lista = contratosPorItem.get(normalizar(codigo));
        return !!lista && lista.length > 0;
      },
    };
  }

  /**
   * Regla única de resolución de contrato (preview y carga usan ESTA
   * función):
   * 1. editado por el usuario en el preview → gana siempre
   * 2. maestro (dim_item): si el ítem está en varios contratos, se prefiere
   *    el del archivo si coincide, si no el primero en orden determinista
   *    (por id_item)
   * 3. archivo, solo si el ítem no está en el maestro
   */
  resolverContratoFinal(
    mapa: MapaMaestro,
    itemCodigo: string,
    contratoArchivo: string | null,
    contratoEditado?: string | null,
  ): { contrato: string | null; fuente: 'editado' | 'maestro' | 'archivo' } {
    if (contratoEditado) {
      return { contrato: contratoEditado, fuente: 'editado' };
    }

    const ks = mapa.contratosPorItem.get(normalizar(itemCodigo)) ?? [];
    if (ks.length > 0) {
      if (contratoArchivo && ks.includes(contratoArchivo)) {
        return { contrato: contratoArchivo, fuente: 'maestro' };
      }
      return { contrato: ks[0], fuente: 'maestro' };
    }

    return { contrato: contratoArchivo || null, fuente: 'archivo' };
  }

  /**
   * Resuelve, en batch (3 queries fijas sin importar la cantidad de filas),
   * los ids que necesita el INSERT (Task 4) para cada fila:
   * - id_item: por código+K (contrato ya resuelto por `resolverContratoFinal`);
   *   si el maestro no tiene el ítem en ese K, fallback a cualquier K donde
   *   sí lo tenga, tomando el de MENOR id_item — mejora consciente sobre el
   *   `LIMIT 1` sin `ORDER BY` del portal (no determinista con duplicados).
   * - id_contrato: por código K.
   * - id_provincia: match UPPER=UPPER.
   * - ptos_gasnor: el del archivo si lo trae; si no, el del maestro
   *   (dim_item) del id_item resuelto; si tampoco, null.
   */
  async resolverIds(
    filas: { item_codigo: string; contrato: string | null; provincia: string; ptos_gasnor: string | null }[],
  ): Promise<Map<number, IdsResueltos>> {
    const resultado = new Map<number, IdsResueltos>();
    if (filas.length === 0) return resultado;

    const codigosNorm = [...new Set(filas.map((f) => normalizar(f.item_codigo)).filter((c) => c !== ''))];
    const ks = [...new Set(filas.map((f) => f.contrato).filter((k): k is string => !!k))];
    const provinciasUpper = [
      ...new Set(filas.map((f) => (f.provincia ?? '').trim().toUpperCase()).filter((p) => p !== '')),
    ];

    const [itemsRows, contratosRows, provinciasRows] = await Promise.all([
      codigosNorm.length
        ? this.prisma.$queryRaw<{ id_item: number | bigint; item_norm: string; codigo_k: string; ptos_gasnor: unknown }[]>(
            Prisma.sql`
              SELECT di.id_item, REPLACE(di.item_codigo, '.', ',') AS item_norm, dc.codigo_k, di.ptos_gasnor
              FROM sth_cert_items di
              JOIN sth_cert_contratos dc ON di.id_contrato = dc.id_contrato
              WHERE REPLACE(di.item_codigo, '.', ',') IN (${Prisma.join(codigosNorm)})
              ORDER BY di.id_item
            `,
          )
        : Promise.resolve([]),
      ks.length
        ? this.prisma.$queryRaw<{ id_contrato: number | bigint; codigo_k: string }[]>(
            Prisma.sql`SELECT id_contrato, codigo_k FROM sth_cert_contratos WHERE codigo_k IN (${Prisma.join(ks)})`,
          )
        : Promise.resolve([]),
      provinciasUpper.length
        ? this.prisma.$queryRaw<{ id: number | bigint; provincia: string }[]>(
            Prisma.sql`SELECT id, provincia FROM sth_cert_provincias WHERE UPPER(provincia) IN (${Prisma.join(provinciasUpper)})`,
          )
        : Promise.resolve([]),
    ]);

    // item_norm -> { porK: K -> {idItem, ptosGasnor}, primero: el de menor id_item (rows ya vienen ORDER BY id_item) }
    const itemPorCodigo = new Map<
      string,
      { porK: Map<string, { idItem: number; ptosGasnor: string | null }>; primero: { idItem: number; ptosGasnor: string | null } }
    >();
    for (const r of itemsRows) {
      const idItem = Number(r.id_item);
      const ptos = r.ptos_gasnor === null || r.ptos_gasnor === undefined ? null : String(r.ptos_gasnor);
      let entry = itemPorCodigo.get(r.item_norm);
      if (!entry) {
        entry = { porK: new Map(), primero: { idItem, ptosGasnor: ptos } };
        itemPorCodigo.set(r.item_norm, entry);
      }
      if (!entry.porK.has(r.codigo_k)) entry.porK.set(r.codigo_k, { idItem, ptosGasnor: ptos });
    }

    const idContratoPorK = new Map<string, number>();
    for (const r of contratosRows) idContratoPorK.set(r.codigo_k, Number(r.id_contrato));

    const idProvinciaPorUpper = new Map<string, number>();
    for (const r of provinciasRows) idProvinciaPorUpper.set(r.provincia.toUpperCase(), Number(r.id));

    filas.forEach((f, i) => {
      const entry = itemPorCodigo.get(normalizar(f.item_codigo));
      const match = f.contrato ? entry?.porK.get(f.contrato) : undefined;
      const resuelto = match ?? entry?.primero ?? null;

      const idContrato = f.contrato ? (idContratoPorK.get(f.contrato) ?? null) : null;
      const idProvincia = idProvinciaPorUpper.get((f.provincia ?? '').trim().toUpperCase()) ?? null;

      const ptosDelArchivo = f.ptos_gasnor !== null && f.ptos_gasnor !== undefined && f.ptos_gasnor !== '' ? f.ptos_gasnor : null;
      const ptosGasnor = ptosDelArchivo ?? (resuelto ? resuelto.ptosGasnor : null);

      resultado.set(i, {
        idItem: resuelto ? resuelto.idItem : null,
        idContrato,
        idProvincia,
        ptosGasnor,
      });
    });

    return resultado;
  }
}
