import { FilaParseada } from './parser-tipos';

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

/**
 * Fila cargable: ítem en maestro + contrato K + provincia válida (match
 * UPPER contra las provincias activas) + cantidad != 0 + total_mes
 * presente (0 es válido; solo debe parsear). El unitario puede faltar.
 * `detalle` une las faltas con "; " usando los textos exactos del portal.
 */
export function revalidarFila(
  f: FilaParseada,
  opts: { itemExiste: boolean; provinciasValidas: string[] },
): { tieneError: boolean; detalle: string | null } {
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
  } else {
    const validasUpper = new Set(opts.provinciasValidas.map((p) => p.trim().toUpperCase()));
    if (!validasUpper.has(provincia.toUpperCase())) {
      faltas.push(`Provincia '${provincia}' inválida`);
    }
  }

  const cant = num(f.cantidades);
  if (cant === null || cant === 0) {
    faltas.push('Falta cantidad');
  }

  if (num(f.total_mes) === null) {
    faltas.push('Falta total mes');
  }

  if (faltas.length > 0) {
    return { tieneError: true, detalle: faltas.join('; ') };
  }
  return { tieneError: false, detalle: null };
}

/** Todo se muestra en el preview salvo las filas de plantilla. */
export function filtrarVisiblesPreview(filas: FilaParseada[]): FilaParseada[] {
  return filas.filter((f) => !esFilaPlantilla(f));
}
