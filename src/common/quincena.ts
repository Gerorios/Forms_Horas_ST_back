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

/** "1,2,30" → [1, 2, 30]. undefined/vacío/sin números → undefined (= sin filtro). */
export function parseIds(valor?: string): number[] | undefined {
  if (!valor) return undefined;
  const ids = valor
    .split(',')
    .map((t) => Number(t.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ids.length > 0 ? ids : undefined;
}
