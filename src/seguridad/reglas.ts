/**
 * Reglas puras de Autogestión de la Seguridad (ADR-027). Sin Prisma ni Nest:
 * todo lo que decide quién recibe puntos, qué campos pide cada tipo, cómo se
 * arma el ranking y cuál es el punto del mapa vive acá y se testea solo.
 * Vocabulario: CONTEXT.md, sección "Autogestión de la Seguridad".
 */

export type TipoReporte = 'aviso_riesgo' | 'incidente' | 'paralizacion' | 'propuesta_mejora' | 'inspeccion';

export const TIPOS_REPORTE: TipoReporte[] = [
  'aviso_riesgo',
  'incidente',
  'paralizacion',
  'propuesta_mejora',
  'inspeccion',
];

/** El único tipo que resta puntos: lo cargan HyS y los inspectores. */
export const TIPO_INSPECCION: TipoReporte = 'inspeccion';
export const ROL_HYS = 'HyS';

export const PUNTAJE_MAXIMO = 10;
export const MAX_FOTOS_POR_GRUPO = 3;

/** Campos que dependen del tipo. Los comunes (fecha, provincia, actividad,
 * ubicación, descripción, fotos) los piden todos. */
interface CamposDelTipo {
  naturaleza: boolean;
  motivoParalizacion: boolean;
  controlRiesgo: boolean;
  /** Involucrados: 'no' (no se cargan), 'opcional' u 'obligatorio'. */
  involucrados: 'no' | 'opcional' | 'obligatorio';
  fotosControl: boolean;
  /** Punto GPS del reporte ("Tomar mi ubicación"). En la paralización es
   * obligatorio: hay que saber de qué obra se trata (2026-10-08). */
  puntoGps: 'obligatorio' | 'opcional';
}

export const CAMPOS_POR_TIPO: Record<TipoReporte, CamposDelTipo> = {
  aviso_riesgo: { naturaleza: true, motivoParalizacion: false, controlRiesgo: true, involucrados: 'opcional', fotosControl: true, puntoGps: 'opcional' },
  incidente: { naturaleza: true, motivoParalizacion: false, controlRiesgo: true, involucrados: 'opcional', fotosControl: true, puntoGps: 'opcional' },
  paralizacion: { naturaleza: false, motivoParalizacion: true, controlRiesgo: true, involucrados: 'opcional', fotosControl: true, puntoGps: 'obligatorio' },
  // Una idea: no hay riesgo, ni control, ni personas en la situación.
  propuesta_mejora: { naturaleza: false, motivoParalizacion: false, controlRiesgo: false, involucrados: 'no', fotosControl: false, puntoGps: 'opcional' },
  // Mismo formulario que el aviso; los involucrados son quienes pierden puntos.
  inspeccion: { naturaleza: true, motivoParalizacion: false, controlRiesgo: true, involucrados: 'obligatorio', fotosControl: true, puntoGps: 'opcional' },
};

export interface CamposReporte {
  tipo: TipoReporte;
  naturalezaId?: number | null;
  motivoParalizacionId?: number | null;
  controlRiesgo?: string | null;
  involucrados?: string[] | null;
  /** Si trae el punto GPS propio (latitud y longitud). */
  tienePunto?: boolean;
}

/** Errores de forma según el tipo (vacío = válido). No mira catálogos ni la
 * base: eso lo hace el servicio. */
export function erroresDeCampos(c: CamposReporte): string[] {
  const reglas = CAMPOS_POR_TIPO[c.tipo];
  if (!reglas) return ['Tipo de reporte inválido'];
  const errores: string[] = [];
  const tiene = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
  const involucrados = c.involucrados ?? [];

  if (reglas.naturaleza && !tiene(c.naturalezaId)) errores.push('Falta la naturaleza del riesgo');
  if (!reglas.naturaleza && tiene(c.naturalezaId)) errores.push('Este tipo de reporte no lleva naturaleza');
  if (reglas.motivoParalizacion && !tiene(c.motivoParalizacionId)) errores.push('Falta el motivo de la paralización');
  if (!reglas.motivoParalizacion && tiene(c.motivoParalizacionId)) errores.push('Este tipo de reporte no lleva motivo de paralización');
  if (reglas.controlRiesgo && !tiene(c.controlRiesgo)) errores.push('Falta lo que hiciste para controlar el riesgo');
  if (!reglas.controlRiesgo && tiene(c.controlRiesgo)) errores.push('Una propuesta de mejora no lleva control del riesgo');
  if (reglas.involucrados === 'obligatorio' && involucrados.length === 0) errores.push('Una inspección necesita al menos una persona observada');
  if (reglas.involucrados === 'no' && involucrados.length > 0) errores.push('Este tipo de reporte no lleva personas involucradas');
  if (reglas.puntoGps === 'obligatorio' && !c.tienePunto) errores.push('Falta tomar la ubicación: hay que saber de qué obra se trata');
  return errores;
}

// ------------------------------------------------------------------ puntos

export interface MovimientoCalculado {
  cuil: string;
  puntos: number;
}

/**
 * Movimientos de puntos de un reporte APROBADO con `puntaje` (0 a 10):
 * el autor suma, salvo en la inspección, donde cada involucrado resta y HyS
 * (autora) no suma nada. Un reporte que no está aprobado no genera nada.
 */
export function movimientosDe(r: {
  tipo: TipoReporte;
  estado: string;
  autorCuil: string;
  puntaje: number | null;
  involucrados: string[];
}): MovimientoCalculado[] {
  if (r.estado !== 'aprobado' || r.puntaje === null) return [];
  if (r.tipo === TIPO_INSPECCION) {
    return [...new Set(r.involucrados)].map((cuil) => ({ cuil, puntos: -r.puntaje! }));
  }
  return [{ cuil: r.autorCuil, puntos: r.puntaje }];
}

/** Cargan inspecciones HyS (siempre) y los inspectores que habilitó. */
export function puedeInspeccionar(rol: string, esInspector: boolean): boolean {
  return rol === ROL_HYS || esInspector;
}

/** Nadie califica su propio reporte (HyS no es juez y parte). La inspección
 * es la excepción: quien la carga no suma puntos, así que no hay conflicto. */
export function puedeCalificar(r: { tipo: TipoReporte; autorCuil: string }, calificadorCuil: string): boolean {
  return r.tipo === TIPO_INSPECCION || r.autorCuil !== calificadorCuil;
}

// ----------------------------------------------------------------- ranking

export interface FilaRanking {
  cuil: string;
  mas: number;
  menos: number;
  total: number;
  puesto: number;
}

/**
 * Ranking de un período a partir de sus movimientos. Entran solo las
 * personas con al menos un movimiento (un 0 por +10 y −10 aparece; quien no
 * tiene nada, no). Empates comparten puesto y el siguiente salta (1, 2, 2, 4).
 * `excluir`: quienes no compiten (HyS, usuarios fuera de nómina).
 */
export function armarRanking(
  movimientos: { cuil: string; puntos: number }[],
  excluir: Set<string> = new Set(),
): FilaRanking[] {
  const porPersona = new Map<string, { mas: number; menos: number }>();
  for (const m of movimientos) {
    if (excluir.has(m.cuil)) continue;
    const acc = porPersona.get(m.cuil) ?? { mas: 0, menos: 0 };
    if (m.puntos >= 0) acc.mas += m.puntos;
    else acc.menos += -m.puntos;
    porPersona.set(m.cuil, acc);
  }
  const filas = [...porPersona.entries()]
    .map(([cuil, { mas, menos }]) => ({ cuil, mas, menos, total: mas - menos }))
    .sort((a, b) => b.total - a.total || a.cuil.localeCompare(b.cuil));

  let puesto = 0;
  return filas.map((f, i) => {
    if (i === 0 || f.total !== filas[i - 1].total) puesto = i + 1;
    return { ...f, puesto };
  });
}

// ------------------------------------------------------------- punto (mapa)

export interface FotoConUbicacion {
  origen: 'camara' | 'galeria';
  latitud: number | null;
  longitud: number | null;
  errorMetros: number | null;
}

export interface Punto {
  latitud: number;
  longitud: number;
  errorMetros: number | null;
  /** De dónde salió: el botón GPS del reporte o una foto de cámara. */
  origen: 'gps' | 'foto';
}

/** Punto del reporte: manda el GPS que el autor tomó con el botón; si no
 * hay, la foto de CÁMARA con menor error. Las de galería no cuentan (pueden
 * ser de otro día y otro lugar). Sin error informado, va después de las que
 * sí lo informan. */
export function puntoDelReporte(
  fotos: FotoConUbicacion[],
  propio?: { latitud: number | null; longitud: number | null; errorMetros: number | null },
): Punto | null {
  if (propio && propio.latitud !== null && propio.longitud !== null) {
    return { latitud: propio.latitud, longitud: propio.longitud, errorMetros: propio.errorMetros, origen: 'gps' };
  }
  const candidatas = fotos.filter((f) => f.origen === 'camara' && f.latitud !== null && f.longitud !== null);
  if (candidatas.length === 0) return null;
  const mejor = candidatas.reduce((a, b) => ((b.errorMetros ?? Infinity) < (a.errorMetros ?? Infinity) ? b : a));
  return { latitud: mejor.latitud!, longitud: mejor.longitud!, errorMetros: mejor.errorMetros, origen: 'foto' };
}

// ------------------------------------------------------------------ rangos

/** Rango de una consulta de puntos (bordes incluidos, 'YYYY-MM-DD'). No hay
 * períodos guardados (2026-10-08): cada uno filtra por fechas, y por
 * defecto es el año en curso. */
export function rangoConsulta(desde: string | undefined, hasta: string | undefined, hoy: string): { desde: string; hasta: string } {
  const d = desde?.slice(0, 10) ?? `${hoy.slice(0, 4)}-01-01`;
  const h = hasta?.slice(0, 10) ?? hoy;
  return { desde: d, hasta: h };
}

// ------------------------------------------------------------------ fechas

const FORMATO_DIA_AR = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Día de hoy en Argentina como 'YYYY-MM-DD', sin depender del huso del
 * servidor. */
export function hoyAr(ahora: Date = new Date()): string {
  return FORMATO_DIA_AR.format(ahora);
}

/** 'YYYY-MM-DD' → Date para una columna @db.Date (medianoche UTC). */
export function diaADate(clave: string): Date {
  return new Date(`${clave}T00:00:00.000Z`);
}

/** Date de una columna @db.Date → 'YYYY-MM-DD'. */
export function dateADia(d: Date): string {
  return d.toISOString().slice(0, 10);
}
