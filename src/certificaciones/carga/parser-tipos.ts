/**
 * Tipos del parser de carga de certificaciones (etapa 4).
 *
 * Puertos EXACTOS de las interfaces que consumen las tareas siguientes
 * (T2-T6): no cambiar firmas sin coordinar. Ver brief T1 y
 * docs/superpowers/specs/2026-09-02-inventario-carga-portal.md §2.
 */
export interface FilaParseada {
  hoja_origen: string;
  archivo_origen: string;
  item_codigo: string; // fmt_item aplicado (Excel); crudo en PDF
  nombre_contrato: string | null;
  tarea: string | null;
  contrato: string; // upper, K-prefijado, fallback meta.k_gasnor, "" si nada
  unidad_medida: string | null;
  ptos_gasnor: string | null; // STRING numérica normalizada (fmt_num) o null
  tipo: string | null;
  contratista: string | null;
  provincia: string; // .title() o "" (Excel); dict PROVINCIAS en PDF
  region: string; // "Norte" | "Sur" | ""
  cantidades: string | null;
  precio_unitario: string | null;
  total_mes: string | null;
  observaciones: string | null;
  fecha: string; // "YYYY-MM-01" del período de la UI
  nro_np: string | null;
  tiene_error: boolean; // solo "contrato no detectado" (Excel); + provincia vacía (PDF)
  fila_excel: number; // fix B4: fila REAL en el archivo (1-based)
}

export interface ErrorParseo {
  hoja: string;
  fila: number;
  campo: string;
  mensaje: string;
}

export interface ResultadoParseo {
  archivo: string;
  hojas: string[];
  filas: FilaParseada[];
  errores: ErrorParseo[];
  periodo: string;
  total_declarado: number | null;
}
