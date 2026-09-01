export interface CargaLogFila {
  contrato: string | null;
  periodo: string;
  usuario_nombre: string | null;
  cargado_en: Date | null;
  filas_cargadas: number | null;
  estado: string | null;
}

export interface EstadoCargaContrato {
  contrato: string;
  periodo: string;
  cargado: boolean;
  usuario: string | null;
  cargado_en: string | null;
  filas_cargadas: number | null;
  estado: string | null;
}

const fechaISO = (d: Date | null): string | null => {
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Grilla contrato × período (2025-01..mes actual, descendente) marcando qué
 * quincena de carga existe en el log. Calcada del portal, con un fix
 * consciente: cargado_en sale como fecha YYYY-MM-DD de verdad (el split("T")
 * del portal no cortaba nada y salía con hora). */
export function construirEstadoCargas(
  contratosVisibles: string[],
  cargas: CargaLogFila[],
  hoy: Date,
): EstadoCargaContrato[] {
  const visibles = new Set(contratosVisibles);
  const cargados = new Map<string, EstadoCargaContrato>();
  for (const c of cargas) {
    for (const k of (c.contrato ?? '').split(',').map((x) => x.trim())) {
      if (!k || !visibles.has(k)) continue;
      const clave = `${k}__${c.periodo}`;
      if (cargados.has(clave)) continue; // primera gana (entrada ya ordenada periodo DESC)
      cargados.set(clave, {
        contrato: k,
        periodo: c.periodo,
        cargado: true,
        usuario: c.usuario_nombre,
        cargado_en: fechaISO(c.cargado_en),
        filas_cargadas: c.filas_cargadas,
        estado: c.estado,
      });
    }
  }

  const periodos: string[] = [];
  for (let a = 2025, m = 1; a < hoy.getFullYear() || (a === hoy.getFullYear() && m <= hoy.getMonth() + 1); ) {
    periodos.push(`${a}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      a += 1;
    }
  }

  const resultado: EstadoCargaContrato[] = [];
  for (const periodo of [...periodos].reverse()) {
    const esActual = periodo === `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    if (esActual && hoy.getDate() < 10) continue; // regla del día 10
    for (const contrato of contratosVisibles) {
      resultado.push(
        cargados.get(`${contrato}__${periodo}`) ?? {
          contrato,
          periodo,
          cargado: false,
          usuario: null,
          cargado_en: null,
          filas_cargadas: null,
          estado: null,
        },
      );
    }
  }
  return resultado;
}
