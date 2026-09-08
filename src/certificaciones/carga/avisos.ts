import { AvisoParseo, PeriodoArchivo } from './parser-tipos';

/**
 * Avisos de negocio del preview (Task 11), portados del inventario del
 * portal §2: no bloquean nunca una fila, son cartel/panel informativo.
 * Puros — sin acceso a BD, sin estado.
 */

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** 'YYYY-MM-DD' → 'D/M/AAAA' (sin ceros a la izquierda), para el texto del aviso. */
const dma = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
};

/**
 * Avisa (suave) si el nombre del archivo declara un K distinto de los
 * K resueltos en las filas visibles — típico cuando el archivo de un K se
 * carga sin cambiar el contrato de las filas. `null` si no hay K en el
 * nombre, no hay filas resueltas, o el K del nombre ya es uno de los
 * resueltos.
 */
export function avisoKNombre(kNombre: string | null, ksResueltos: string[], hoja: string): AvisoParseo | null {
  if (!kNombre || ksResueltos.length === 0 || ksResueltos.includes(kNombre)) return null;
  const resueltos = [...new Set(ksResueltos)].join(', ');
  return {
    tipo: 'k_nombre_archivo',
    hoja,
    fila: 0,
    fuerte: false,
    mensaje: `El nombre del archivo dice ${kNombre} y las filas se resolvieron en ${resueltos}. Si la plata va a ${kNombre}, cambiá el contrato en las filas.`,
  };
}

/**
 * Avisa (FUERTE) si el mes/año elegido por el usuario en la UI no coincide
 * con NINGUNO de los dos EXTREMOS del período que declara el archivo.
 *
 * OJO: no es contención dentro del rango — se compara 'YYYY-MM' con
 * `startsWith` contra `desde` y contra `hasta`, nada más. Un período
 * 1/1/2026–31/12/2026 con el usuario eligiendo junio 2026 SÍ avisa, aunque
 * junio caiga dentro del rango: los períodos reales son mensuales (o a lo
 * sumo cruzan dos meses), así que un rango largo es de por sí sospechoso y
 * conviene que la persona lo mire. `null` si el archivo no declara período
 * o si el mes elegido es el de `desde` o el de `hasta`.
 */
export function avisoPeriodo(
  p: PeriodoArchivo | null,
  anio: number,
  mes: number,
  hoja: string,
): AvisoParseo | null {
  if (!p) return null;
  const elegido = `${anio}-${String(mes).padStart(2, '0')}`;
  if (p.hasta.startsWith(elegido) || p.desde.startsWith(elegido)) return null;
  return {
    tipo: 'periodo_archivo',
    hoja,
    fila: 0,
    fuerte: true,
    mensaje: `El archivo dice período ${dma(p.desde)} a ${dma(p.hasta)} y elegiste ${MESES[mes - 1]} ${anio}. Revisá el mes antes de confirmar.`,
  };
}
