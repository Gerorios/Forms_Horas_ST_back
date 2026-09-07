/**
 * fechas.ts — parseo de fechas D/M/A (formato con el que Naturgy escribe el
 * período a certificar en la cabecera del PDF/Excel: "1/8/2026").
 *
 * Vive en su propio módulo (y no dentro de parser-pdf.ts) porque T6 (Excel)
 * también lo necesita para el mismo campo de cabecera.
 */
function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * 'D/M/AAAA' (día y mes sin cero a la izquierda opcionales) → 'AAAA-MM-DD'.
 * `null` si el formato no matchea o si día/mes están fuera de rango
 * (no valida días por mes: 31/2/2026 no matchea por rango de día > 31, pero
 * 30/2/2026 pasa el chequeo de rango — no hay calendario real acá).
 */
export function parsearFechaDMA(s: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${m[3]}-${pad2(mo)}-${pad2(d)}`;
}
