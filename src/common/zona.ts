// ADR-021 §4: NORTE = Salta + Jujuy, SUR = Tucumán (la hoja del Excel se
// llama "TUCUMAN"). Cualquier otro valor (o vacío) = sin zona — alerta,
// nunca una zona por default.
export type Zona = 'norte' | 'sur';
export function zonaDeProvincia(provincia: string | null | undefined): Zona | null {
  const p = (provincia ?? '').trim().toUpperCase();
  if (p === 'SALTA' || p === 'JUJUY') return 'norte';
  if (p === 'TUCUMAN') return 'sur';
  return null;
}
