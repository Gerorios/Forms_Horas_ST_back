/** Período 1–15 / 16–fin de mes (ver glosario). Reutilizado por liquidación y
 * por el panel de "sin carga" de Jefe de Contrato — misma definición en
 * ambos lados, calculada por fecha, sin tabla ni cierre. */
export function rangoQuincena(anio: number, mes: number, quincena: number): { desde: Date; hasta: Date } {
  const desde = new Date(anio, mes - 1, quincena === 1 ? 1 : 16);
  const hasta = quincena === 1 ? new Date(anio, mes - 1, 15) : new Date(anio, mes, 0);
  return { desde, hasta };
}

/** La quincena inmediata anterior — para comparaciones período contra período. */
export function quincenaAnterior(
  anio: number,
  mes: number,
  quincena: number,
): { anio: number; mes: number; quincena: number } {
  if (quincena === 2) return { anio, mes, quincena: 1 };
  const mesAnterior = mes === 1 ? 12 : mes - 1;
  const anioAnterior = mes === 1 ? anio - 1 : anio;
  return { anio: anioAnterior, mes: mesAnterior, quincena: 2 };
}

/** Las últimas `cantidad` quincenas terminando en la dada, en orden
 * cronológico ascendente — para el histórico del panel Control general. */
export function quincenasHaciaAtras(
  anio: number,
  mes: number,
  quincena: number,
  cantidad: number,
): { anio: number; mes: number; quincena: number }[] {
  const lista = [{ anio, mes, quincena }];
  while (lista.length < cantidad) {
    const prev = quincenaAnterior(lista[0].anio, lista[0].mes, lista[0].quincena);
    lista.unshift(prev);
  }
  return lista;
}

/** Cuántas quincenas corridas congela la foto de días trabajados de un cierre:
 * la cerrada + las 2 anteriores (= "un mes atrás", ADR-024). La regla del
 * feriado mira un mes hacia atrás, así que la hoja necesita ese contexto. */
export const QUINCENAS_DIAS_TRABAJADOS = 3;

/** Rango de fechas (Date LOCAL, como `rangoQuincena`) de la ventana de días
 * trabajados que termina en la quincena dada: desde el 1° día de la más vieja
 * de las `QUINCENAS_DIAS_TRABAJADOS` hasta el último de la cerrada. Única
 * definición: la usan el cierre (para congelar) y el export (para dibujar). */
export function rangoVentanaDiasTrabajados(
  anio: number,
  mes: number,
  quincena: number,
): { desde: Date; hasta: Date } {
  const [primera] = quincenasHaciaAtras(anio, mes, quincena, QUINCENAS_DIAS_TRABAJADOS);
  return {
    desde: rangoQuincena(primera.anio, primera.mes, primera.quincena).desde,
    hasta: rangoQuincena(anio, mes, quincena).hasta,
  };
}

/** Nombres de los meses en minúscula, indexados 0-11 (enero = 0) — para
 * textos de avisos y encabezados de planillas. Única copia del repo. */
export const NOMBRES_MES = [
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

/** Mes 1-12 → nombre con inicial mayúscula: nombreMes(8) === 'Agosto'. */
export function nombreMes(mes: number): string {
  const nombre = NOMBRES_MES[mes - 1];
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}

/** "a,b,c" → ['a','b','c']. undefined/vacío → undefined (= sin filtro).
 * Para listas de CUILs u otros ids no numéricos en query params. */
export function parseLista(valor?: string): string[] | undefined {
  if (!valor) return undefined;
  const items = valor
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return items.length > 0 ? items : undefined;
}

/** "1,2,30" → [1, 2, 30]. undefined/vacío/sin números → undefined (= sin filtro). */
export function parseIds(valor?: string): number[] | undefined {
  if (!valor) return undefined;
  const ids = valor
    .split(',')
    .map((t) => Number(t.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ids.length > 0 ? ids : undefined;
}
