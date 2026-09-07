import { Injectable } from '@nestjs/common';
import { FilaParseada, PeriodoArchivo } from './parser-tipos';
import { Cuadratura } from './validacion';

/**
 * Cache preview→confirmar de certificaciones, portada de app/services/
 * cache.py del portal (docs/superpowers/specs/2026-09-02-inventario-
 * carga-portal.md §1).
 *
 * Fixes conscientes vs el portal:
 * - B16: NUNCA guarda bytes del archivo (el portal los guardaba para
 *   subir a OneDrive, feature ya eliminada — acá no hace falta ni un
 *   momento).
 * - B1: el ownership es por CUIL real (no por un `usuario_id` que en
 *   Horas siempre valía 0, lo que dejaba a cualquier usuario leer/editar
 *   la sesión de cualquier otro). `recuperar` exige `ownerCuil` y
 *   devuelve `null` tanto si la sesión no existe/expiró como si el CUIL
 *   no es el dueño — a propósito: no distingue los dos casos al que
 *   llama, para no filtrar si una sesión ajena existe.
 *
 * Map en memoria (un solo proceso — igual límite que el portal, ya
 * documentado en el inventario B16; no hace falta Redis para esta escala).
 */

const TTL_MS = 30 * 60 * 1000; // 30 minutos

export interface FilaPreview extends FilaParseada {
  rowId: string;
  item_en_maestro: boolean;
  error_detalle: string | null;
  contrato_archivo: string;
  contrato_fuente: 'editado' | 'maestro' | 'archivo';
  contrato_del_maestro: string | null;
  /** No está en la interfaz "producida" del brief tal cual, pero hace
   * falta guardar en algún lado el checkbox de exclusión del paso 3 del
   * frontend (inventario §6) para que `confirmar` lo respete por fila —
   * es la contraparte natural de `EdicionFilaDto.excluida`. */
  excluida: boolean;
  /** Cuadratura calculada en el preview (Task 7/11): cantidad×unitario vs
   * total impreso, con tolerancia de $1. Se recalcula en `confirmar`. */
  cuadratura: Cuadratura;
  /** Siempre `false` en el preview inicial; `confirmar` la usa para levantar
   * el bloqueo por cuadratura de una fila que el usuario confirmó a mano
   * (Task 12 — no se toca acá salvo el tipo). */
  confirmada: boolean;
  /** 'archivo' para toda fila salida del parser; 'manual' para las que
   * agrega el usuario a mano en el preview (Task 9/10, filasManuales). */
  origen: 'archivo' | 'manual';
}

export interface PreviewSession {
  id: string;
  ownerCuil: string;
  archivo: string;
  anio: number;
  mes: number;
  filas: Map<string, FilaPreview>;
  creadaEn: number;
  /** Total declarado por el archivo (cabecera), para controlar la carga
   * contra ese número; `null` si no se pudo leer. */
  total_declarado: number | null;
  /** K que menciona el nombre del archivo (p.ej. "K11.pdf" → "K11"); `null`
   * si el nombre no trae ningún K. */
  k_nombre_archivo: string | null;
  /** Período que declara la cabecera del archivo; `null` si no se detectó. */
  periodo_archivo: PeriodoArchivo | null;
}

@Injectable()
export class PreviewStore {
  private readonly sesiones = new Map<string, PreviewSession>();

  guardar(sesion: PreviewSession): string {
    this.sesiones.set(sesion.id, sesion);
    return sesion.id;
  }

  recuperar(id: string, ownerCuil: string): PreviewSession | null {
    const sesion = this.sesiones.get(id);
    if (!sesion) return null;

    if (Date.now() - sesion.creadaEn > TTL_MS) {
      this.sesiones.delete(id);
      return null;
    }

    if (sesion.ownerCuil !== ownerCuil) return null;

    return sesion;
  }

  limpiar(id: string): void {
    this.sesiones.delete(id);
  }
}
