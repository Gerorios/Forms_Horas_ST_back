/**
 * Consenso entre dos lecturas independientes del MISMO ticket (plan
 * 2026-08-18, decisión "máxima precisión"): un campo solo se acepta si ambas
 * lecturas coinciden. Si difieren, el campo va null y queda listado en
 * `camposInseguros` para que la UI lo marque y el operario lo complete.
 *
 * Que dos lecturas coincidan en null es consenso legítimo ("no está en el
 * ticket"), no inseguridad.
 */

const normalizarTexto = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** Dos valores son el mismo dato: números por igualdad exacta, textos normalizados. */
export function mismoValor(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === 'string' && typeof b === 'string') return normalizarTexto(a) === normalizarTexto(b);
  return a === b;
}

export function consensuar<T extends Record<string, unknown>>(
  a: T,
  b: T,
  campos: readonly (keyof T & string)[],
): { valores: Partial<T>; camposInseguros: string[] } {
  const valores: Partial<T> = {};
  const camposInseguros: string[] = [];
  for (const campo of campos) {
    if (mismoValor(a[campo], b[campo])) {
      valores[campo] = a[campo];
    } else {
      valores[campo] = null as T[typeof campo];
      camposInseguros.push(campo);
    }
  }
  return { valores, camposInseguros };
}

/**
 * Verificación aritmética: litros × precio debe dar el monto. Tolerancia de
 * $1 por redondeos del surtidor. Si no cierra, los tres campos son sospechosos
 * (no sabemos cuál se leyó mal).
 */
export const CAMPOS_ARITMETICA = ['litros', 'precioLitro', 'monto'] as const;

export function verificarAritmetica(
  litros: number | null,
  precioLitro: number | null,
  monto: number | null,
): { cierra: boolean; mensaje: string | null } {
  if (litros === null || precioLitro === null || monto === null) return { cierra: true, mensaje: null };
  const calculado = litros * precioLitro;
  if (Math.abs(calculado - monto) <= 1) return { cierra: true, mensaje: null };
  return {
    cierra: false,
    mensaje: `Litros × precio unitario ($ ${calculado.toFixed(2)}) no coincide con el total ($ ${monto.toFixed(2)}).`,
  };
}
