/**
 * Regla única de montos en TEXTO para certificaciones de Naturgy (decisión
 * 2026-09-07, CONTEXT.md "Regla de montos en texto"): el punto es SIEMPRE
 * separador de miles y la coma SIEMPRE decimal. Sin heurística por forma:
 * "400.012" son cuatrocientos mil doce, "1.5" son quince. Si algún día
 * viniera al estilo inglés, la cuadratura por fila lo delata.
 *
 * Aplica a texto de PDF y a celdas de TEXTO de Excel. Las celdas numéricas
 * de Excel ya traen el valor real y no pasan por acá.
 */
const BLOQUE_NUM_RE = /[+-]?[\d.,]+/;
const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

export function parsearMontoTexto(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const sinMoneda = s.replace(/\$/g, '').trim();
  const m = sinMoneda.match(BLOQUE_NUM_RE);
  if (!m) return null;
  let bloque = m[0].replace(/^[.,]+/, '').replace(/[.,]+$/, '');
  if (!/\d/.test(bloque)) return null;
  bloque = bloque.replace(/\./g, '').replace(/,/g, '.');
  if (!FLOAT_RE.test(bloque)) return null;
  const n = Number(bloque);
  if (!Number.isFinite(n)) return null;
  return bloque;
}

export function montoANumero(s: string | null | undefined): number | null {
  const t = parsearMontoTexto(s);
  return t === null ? null : Number(t);
}
