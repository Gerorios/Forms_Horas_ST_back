/**
 * Regla de duplicado EXACTO (pedido del dueño de producto 2026-08-14):
 * dos registros DISTINTOS son duplicados si coinciden operario + fecha +
 * horas + contrato + mismas tareas + mismos móviles. El lote NO participa —
 * la regla anterior (mismo operario+día en >1 lote) marcaba como sospechosos
 * repartos legítimos de un día entre contratos/envíos.
 */
export interface RegistroComparable {
  id: number;
  operarioCuil: string;
  fecha: Date;
  horas: unknown; // Prisma Decimal o number — se normaliza con Number()
  contratoId: number;
  tareas?: { tareaId: number }[];
  moviles?: { movilId: number }[];
}

export function duplicadosExactos(registros: RegistroComparable[]): {
  idsDuplicados: Set<number>;
  cuilesConDuplicado: Set<string>;
} {
  const grupos = new Map<string, RegistroComparable[]>();
  for (const r of registros) {
    const tareas = (r.tareas ?? [])
      .map((t) => t.tareaId)
      .sort((a, b) => a - b)
      .join(',');
    const moviles = (r.moviles ?? [])
      .map((m) => m.movilId)
      .sort((a, b) => a - b)
      .join(',');
    const clave = [
      r.operarioCuil,
      r.fecha.toISOString(),
      Number(r.horas),
      r.contratoId,
      tareas,
      moviles,
    ].join('|');
    const grupo = grupos.get(clave);
    if (grupo) grupo.push(r);
    else grupos.set(clave, [r]);
  }

  const idsDuplicados = new Set<number>();
  const cuilesConDuplicado = new Set<string>();
  for (const grupo of grupos.values()) {
    if (grupo.length > 1) {
      for (const r of grupo) idsDuplicados.add(r.id);
      cuilesConDuplicado.add(grupo[0].operarioCuil);
    }
  }
  return { idsDuplicados, cuilesConDuplicado };
}
