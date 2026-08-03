/** Período 1–15 / 16–fin de mes (ver glosario). Reutilizado por liquidación y
 * por el panel de "sin carga" de Jefe de Contrato — misma definición en
 * ambos lados, calculada por fecha, sin tabla ni cierre. */
export function rangoQuincena(anio: number, mes: number, quincena: number): { desde: Date; hasta: Date } {
  const desde = new Date(anio, mes - 1, quincena === 1 ? 1 : 16);
  const hasta = quincena === 1 ? new Date(anio, mes - 1, 15) : new Date(anio, mes, 0);
  return { desde, hasta };
}
