import { FilaParseada } from './parser-tipos';
import { canonizarProvincia } from './provincias';

/**
 * Reglas de cargabilidad de filas de certificación, portadas 1:1 de
 * app/services/validacion.py del portal (ver
 * docs/superpowers/specs/2026-09-02-inventario-carga-portal.md §4).
 *
 * La cargabilidad nunca es un veredicto congelado del parser: se recalcula
 * acá cada vez que hace falta (preview, edición, confirmación), ignorando
 * el flag `tiene_error` que traiga la fila.
 *
 * Puro — sin acceso a BD. La resolución de contrato/ítem/provincia vive en
 * resolucion.service.ts.
 */

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/**
 * Fila de plantilla (ruido, se oculta del preview sin aviso): sin cantidad
 * ni total con plata. El unitario solo NO cuenta como contenido — los
 * archivos de Naturgy traen el catálogo completo de ítems con precio
 * unitario y cantidad 0, y eso no es nada certificado.
 */
export function esFilaPlantilla(f: { cantidades: string | null; total_mes: string | null }): boolean {
  const cant = num(f.cantidades);
  const total = num(f.total_mes);
  return (cant === null || cant === 0) && (total === null || total === 0);
}

/** Tolerancia de cuadratura, en pesos (CONTEXT.md "Fila que cuadra"). */
export const TOLERANCIA_CUADRATURA = 1;

export interface Cuadratura {
  calculado: number | null;
  impreso: number | null;
  diferencia: number | null;
  cuadra: boolean;
  sugerencia_cantidad: string | null;
}

/**
 * Fila que cuadra (CONTEXT.md, decisión vinculante): |cantidad × unitario −
 * total| ≤ $1. Ninguna de las tres cifras manda sola; sin unitario no hay
 * cuadratura posible (cuadra=false).
 *
 * Convención de signo de `diferencia`: total_mes − calculado (puede ser
 * negativa si lo impreso es menor que lo calculado). El mensaje de error en
 * `revalidarFila` muestra su valor ABSOLUTO — lo que importa para la
 * persona que revisa es la magnitud del desajuste, no si sobra o falta.
 */
export function cuadraturaFila(f: {
  cantidades: string | null;
  precio_unitario: string | null;
  total_mes: string | null;
}): Cuadratura {
  const cant = num(f.cantidades);
  const unit = num(f.precio_unitario);
  const total = num(f.total_mes);
  if (cant === null || unit === null || total === null) {
    return { calculado: null, impreso: total, diferencia: null, cuadra: false, sugerencia_cantidad: null };
  }

  const calculado = Math.round(cant * unit * 100) / 100;
  const diferencia = Math.round((total - calculado) * 100) / 100;
  const cuadra = Math.abs(diferencia) <= TOLERANCIA_CUADRATURA;

  let sugerenciaCantidad: string | null = null;
  if (!cuadra && unit > 0) {
    const cantidadEquivalente = total / unit;
    const entero = Math.round(cantidadEquivalente);
    if (entero >= 1 && Math.abs(cantidadEquivalente - entero) <= 0.01 && entero !== cant) {
      sugerenciaCantidad = String(entero);
    }
  }

  return { calculado, impreso: total, diferencia, cuadra, sugerencia_cantidad: sugerenciaCantidad };
}

const fmt2 = (n: number) => n.toFixed(2);

/**
 * Fila cargable: ítem en maestro + contrato K + provincia válida (match
 * sin acentos/mayúsculas/espacios de más contra las provincias activas,
 * ver `canonizarProvincia`) + cantidad != 0 + total_mes
 * presente (0 es válido; solo debe parsear) + fila que cuadra (Task 7,
 * CONTEXT.md). `detalle` une las faltas con "; " usando los textos exactos
 * del portal. La cuadratura solo se evalúa si no hay ninguna otra falta
 * (una fila sin cantidad ya está bloqueada por 'Falta cantidad'; no se
 * duplican mensajes). `opts.confirmada` levanta ÚNICAMENTE el bloqueo por
 * cuadratura — nunca las demás faltas.
 */
export function revalidarFila(
  f: FilaParseada,
  opts: { itemExiste: boolean; provinciasValidas: string[]; confirmada?: boolean },
): { tieneError: boolean; detalle: string | null; cuadratura: Cuadratura } {
  const faltas: string[] = [];

  if (!opts.itemExiste) {
    faltas.push(`Ítem ${f.item_codigo ?? '?'} no encontrado en el maestro`);
  }

  if (!(f.contrato ?? '').trim()) {
    faltas.push('Falta contrato K');
  }

  const provincia = (f.provincia ?? '').trim();
  if (!provincia) {
    faltas.push('Falta provincia');
  } else if (canonizarProvincia(provincia, opts.provinciasValidas) === null) {
    faltas.push(`Provincia '${provincia}' inválida`);
  }

  const cant = num(f.cantidades);
  if (cant === null || cant === 0) {
    faltas.push('Falta cantidad');
  }

  if (num(f.total_mes) === null) {
    faltas.push('Falta total mes');
  }

  const cuadratura = cuadraturaFila(f);
  if (faltas.length === 0 && !cuadratura.cuadra && !opts.confirmada) {
    if (num(f.precio_unitario) === null) {
      faltas.push('Falta $ unitario (no se puede cuadrar)');
    } else {
      faltas.push(
        `No cuadra: ${f.cantidades} × ${f.precio_unitario} = ${fmt2(cuadratura.calculado!)}, impreso ${f.total_mes} (dif. $ ${fmt2(Math.abs(cuadratura.diferencia!))})`,
      );
    }
  }

  if (faltas.length > 0) {
    return { tieneError: true, detalle: faltas.join('; '), cuadratura };
  }
  return { tieneError: false, detalle: null, cuadratura };
}

/** Todo se muestra en el preview salvo las filas de plantilla. */
export function filtrarVisiblesPreview(filas: FilaParseada[]): FilaParseada[] {
  return filas.filter((f) => !esFilaPlantilla(f));
}
