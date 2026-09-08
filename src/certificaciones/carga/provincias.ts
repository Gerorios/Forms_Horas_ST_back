/**
 * Match de provincia contra el maestro `sth_cert_provincias`, ignorando
 * acentos, mayúsculas y espacios de más — NUNCA formatting variants nuevas
 * (regla vinculante del dueño del producto): el maestro guarda los nombres
 * SIN acento y en mayúsculas ('SALTA', 'TUCUMAN'…), pero los PDFs de
 * Naturgy imprimen con acento ('Tucumán'). La fila debe adoptar la
 * ortografía EXACTA del maestro antes de validar/insertar — nunca se crea
 * una provincia nueva por variante de formato.
 */

/**
 * Clave de comparación: NFD + elimina marcas diacríticas (acentos) +
 * mayúsculas + recorta + colapsa espacios internos múltiples en uno solo.
 */
export function claveProvincia(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Devuelve la grafía EXACTA del maestro (`validas`) cuya `claveProvincia`
 * coincide con la de `valor`, o `null` si ninguna matchea.
 */
export function canonizarProvincia(valor: string | null | undefined, validas: string[]): string | null {
  const clave = claveProvincia(valor);
  if (!clave) return null;
  return validas.find((v) => claveProvincia(v) === clave) ?? null;
}
