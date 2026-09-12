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

/**
 * La zona con la que una persona sale en el Excel: la excepción de su perfil
 * si tiene una, y si no la que le corresponde por provincia.
 *
 * La excepción existe para casos que la provincia no explica (2026-09-11: un
 * empleado de Santiago del Estero que, por acuerdo, se liquida en la hoja de
 * Tucumán). Se decidió una excepción por persona en vez de mapear la
 * provincia entera, porque no vale para todos los de esa provincia.
 *
 * Es el ÚNICO lugar donde se resuelve la zona: el cálculo la deja resuelta en
 * la fila y el panel, los cierres y el Excel la leen de ahí. Si alguien
 * vuelve a llamar a `zonaDeProvincia` por su cuenta, se saltea la excepción.
 */
export function zonaDePerfil(
  provincia: string | null | undefined,
  zonaOverride: Zona | null | undefined,
): Zona | null {
  return zonaOverride ?? zonaDeProvincia(provincia);
}
