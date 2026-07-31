/**
 * Transform seguro para campos de tipo array que llegan como JSON string
 * (p.ej. multipart/form-data). Si el string es JSON malformado, devuelve el
 * valor original sin parsear para que class-validator lo rechace con un error
 * de validación (isArray) en lugar de que JSON.parse lance una excepción no
 * controlada.
 */
export function parseJsonArraySeguro({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
