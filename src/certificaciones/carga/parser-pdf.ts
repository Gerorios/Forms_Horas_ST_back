/**
 * parser-pdf.ts — port de parser_pdf.py (PortalCertificaciones) a TS.
 *
 * Arquitectura (pedida por el brief T2): el ALGORITMO es puro — funciones
 * que reciben `PalabraPosicionada[]` (equivalente al dict de palabra de
 * pdfplumber: text/x0/top/width) y devuelven filas/errores — separado del
 * WRAPPER que usa pdfjs-dist para extraer esas palabras de un PDF real. Así
 * el algoritmo (que es la lógica de negocio con reglas exactas a portar) se
 * testea con datos sintéticos, sin depender de un PDF real ni de pdfjs.
 *
 * Coordenadas: pdfplumber informa `top` como distancia desde el borde
 * SUPERIOR de la página (crece hacia abajo). pdfjs-dist, en cambio, da
 * `item.transform = [a,b,c,d,e,f]` con `e=x0` y `f=y` en el sistema de PDF,
 * donde Y crece hacia ARRIBA desde el borde inferior. Para calcar la
 * semántica de pdfplumber el wrapper hace `top = alturaPagina - y`.
 *
 * Paridad exacta con el Python salvo lo documentado explícitamente en cada
 * función. Diferencias PDF vs Excel (ver inventario §3): `provincia` vacía
 * SÍ marca `tiene_error`; `item_codigo` NO pasa por fmt_item (queda crudo);
 * `nombre_contrato` siempre null; `region` siempre ""; `hojas` = [nombreArchivo].
 *
 * `fila_excel` en el PDF no es una fila de planilla: es el número
 * secuencial de fila lógica (1-based) DENTRO DE LA PÁGINA — igual que el
 * `num_fila` del Python original, que también reinicia en 1 en cada página
 * (mismo comportamiento, incluida la duplicación de números entre páginas
 * si el PDF tiene más de una).
 */
import { ErrorParseo, FilaParseada, ResultadoParseo } from './parser-tipos';
import { parsearMontoTexto } from './montos';
import { extraerKDeNombre } from './nombre-archivo';

/** Palabra con posición, equivalente al dict que devuelve `page.extract_words()` de pdfplumber. */
export interface PalabraPosicionada {
  text: string;
  x0: number;
  top: number;
  width: number;
  /**
   * Índice del item de texto de pdfjs del que salió la palabra: las palabras
   * con el mismo `itemId` forman UNA frase de cabecera ("NOMBRE CONTRATO",
   * "K GASNOR", "$ Total mes"), porque pdfjs devuelve el título multipalabra
   * como un único item. Opcional: los datos sintéticos de los tests y un
   * extractor tipo pdfplumber (una palabra = un item) lo dejan sin definir, y
   * entonces cada palabra es su propia frase.
   */
  itemId?: number;
}

/**
 * FRASES completas de cabecera (UPPER, espacios normalizados) → nombre
 * canónico del campo. El match es EXACTO sobre la frase entera: por eso la
 * tabla lista tanto "K GASNOR" como "K" suelto, tanto "$ TOTAL MES" como
 * "TOTAL".
 *
 * Deliberadamente NO hay fallback "por primera palabra" para frases de varias
 * palabras: si lo hubiera, un título desconocido como "Total acumulado" caería
 * en `total_mes`, y si estuviera a la izquierda del "$ Total mes" real se
 * quedaría con el campo (gana el primer x0) descartando la columna verdadera
 * como duplicada — sin ignorada, sin aviso y sin faltante, o sea cargando el
 * acumulado como total del mes en silencio. Un título de varias palabras que
 * no esté acá se trata como columna ignorada, que es visible para el usuario.
 */
const HEADER_FRASES: Record<string, string> = {
  ÍTEMS: 'item_codigo',
  ITEMS: 'item_codigo',
  ÍTEM: 'item_codigo',
  ITEM: 'item_codigo',
  'NOMBRE CONTRATO': 'nombre_contrato',
  NOMBRE: 'nombre_contrato',
  TAREA: 'tarea',
  DESCRIPCION: 'tarea',
  DESCRIPCIÓN: 'tarea',
  'K GASNOR': 'contrato',
  K: 'contrato',
  UM: 'unidad_medida',
  'PTOS. GASNOR': 'ptos_gasnor',
  'PTOS GASNOR': 'ptos_gasnor',
  'PTOS.': 'ptos_gasnor',
  TIPO: 'tipo',
  CONTRATISTA: 'contratista',
  PROVINCIA: 'provincia',
  CANTIDADES: 'cantidades',
  CANTIDAD: 'cantidades',
  '$ UNITARIO MES': 'precio_unitario',
  'UNITARIO MES': 'precio_unitario',
  '$ UNITARIO': 'precio_unitario',
  UNITARIO: 'precio_unitario',
  '$ TOTAL MES': 'total_mes',
  'TOTAL MES': 'total_mes',
  '$ TOTAL': 'total_mes',
  TOTAL: 'total_mes',
  OBSERVACIONES: 'observaciones',
};

/**
 * Columnas sin las cuales la página no se puede leer: si falta alguna, no se
 * procesa ninguna fila y se emite un error de `header` (mejor no cargar nada
 * que cargar valores corridos de columna).
 */
export const COLUMNAS_REQUERIDAS = [
  'item_codigo',
  'contrato',
  'provincia',
  'cantidades',
  'precio_unitario',
  'total_mes',
] as const;

/**
 * Palabras que son CONTINUACIÓN de un título y no una columna nueva: "NOMBRE
 * CONTRATO", "K GASNOR", "$ Total mes" partidos. Sin esta lista cada una
 * inventaría una columna ignorada fantasma que se comería el rango x de la
 * columna real.
 *
 * Solo aplica a frases SIN `itemId` (extractor tipo pdfplumber, o datos
 * sintéticos): ahí no hay forma de saber que la palabra venía pegada al
 * título anterior. Cuando la palabra trae `itemId`, el agrupado por item ya
 * rearmó las frases reales, así que un item suelto titulado "MES" es una
 * columna desconocida como cualquier otra y va a `ignoradas`.
 */
const CONTINUACIONES = new Set(['CONTRATO', 'GASNOR', 'MES', '$']);

/** Al detectar cualquiera de estas palabras, terminó la zona de datos de la página. */
const FOOTER_PALABRAS = [
  'FIRMA',
  'ACLARACIÓN',
  'ACLARACION',
  'TOTAL A CERTIFICAR',
  'PERIODO A CERTIFICAR',
];

/** Dict cerrado de provincias (matching por substring, sin tildes). */
const PROVINCIAS: Record<string, string> = {
  salta: 'Salta',
  jujuy: 'Jujuy',
  tucumán: 'Tucumán',
  tucuman: 'Tucumán',
  santiago: 'Santiago del Estero',
  catamarca: 'Catamarca',
};

export type ColMap = Map<string, [number, number]>;

interface Meta {
  k_gasnor: string | null;
  nro_np: string | null;
  total_declarado: number | null;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Igual que .title() de Python para el fallback de provincia (sin dict). */
function tituloEs(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** `_es_item_valido` del PDF: más estricto que el de Excel — `^[A-Za-z]?\d{3,}`. */
export function esItemValido(s: string | null | undefined): boolean {
  if (!s) return false;
  const su = s.toUpperCase();
  if (su === 'ÍTEMS' || su === 'ITEMS' || su === 'ÍTEM' || su === 'ITEM' || su === '') {
    return false;
  }
  return /^[A-Za-z]?\d{3,}/.test(s);
}

/**
 * `_limpiar_num`: toma solo el PRIMER bloque numérico (tras quitar $) y
 * normaliza con la regla única es-AR (ver `./montos`: punto = miles,
 * coma = decimal, sin heurística por forma). Devuelve la STRING
 * normalizada o null si no parsea como float. Wrapper delgado — la lógica
 * vive en `parsearMontoTexto` para compartirla con Excel.
 */
export function limpiarNum(s: string | null | undefined): string | null {
  return parsearMontoTexto(s);
}

/**
 * `_pegar_palabras`: junta palabras de una línea pegando dígitos partidos
 * por el extractor cuando el gap es chico y prev/curr parecen partes de un
 * número (`9` + `.338,22` → `9.338,22`).
 */
export function pegarPalabras(ws: PalabraPosicionada[]): string {
  if (ws.length === 0) return '';
  const resultado: string[] = [ws[0].text.trim()];
  for (let i = 1; i < ws.length; i++) {
    const prev = ws[i - 1];
    const curr = ws[i];
    const prevTxt = prev.text.trim();
    const currTxt = curr.text.trim();
    const gap = curr.x0 - (prev.x0 + prev.width);
    const esNumeroPartido = gap < 8 && /^\d+$/.test(prevTxt) && /^[\d.,]/.test(currTxt);
    if (esNumeroPartido) {
      resultado[resultado.length - 1] = resultado[resultado.length - 1] + currTxt;
    } else {
      resultado.push(currTxt);
    }
  }
  return resultado.join(' ').trim();
}

/** Resultado de leer la línea de cabecera de una página. */
export interface Cabecera {
  /** {campo: [xIni, xFin]}, incluidas las columnas ignoradas como `__ignorada_N`. */
  colMap: ColMap;
  /** Títulos de cabecera que no reconocemos (p. ej. "CUENTA"), en orden de x0. */
  ignoradas: string[];
  /** Columnas de `COLUMNAS_REQUERIDAS` que no aparecieron. */
  faltantes: string[];
}

/**
 * Agrupa las palabras de la línea de cabecera en FRASES: mismo `itemId` =
 * misma frase; sin `itemId`, cada palabra es su propia frase (pdfplumber).
 *
 * El agrupado es POR `itemId`, no por adyacencia: los x0 de las palabras se
 * estiman por proporción de caracteres (ver `dividirEnPalabras`), así que las
 * palabras de dos títulos vecinos pueden intercalarse al ordenar por x0
 * ("mes" de "$ Unitario mes" cayendo después del "$" de "$ Total mes"). Cada
 * frase se queda con el x0 mínimo de su item y las frases se ordenan por ese x0.
 */
function frasesDeCabecera(
  headerWs: PalabraPosicionada[],
): { texto: string; x0: number; itemId?: number }[] {
  const porItem = new Map<number, PalabraPosicionada[]>();
  const frases: { texto: string; x0: number; itemId?: number }[] = [];

  for (const w of headerWs) {
    if (w.itemId === undefined) {
      frases.push({ texto: w.text.trim(), x0: w.x0, itemId: undefined });
      continue;
    }
    if (!porItem.has(w.itemId)) porItem.set(w.itemId, []);
    porItem.get(w.itemId)!.push(w);
  }

  for (const [itemId, ws] of porItem) {
    const ordenadas = [...ws].sort((a, b) => a.x0 - b.x0);
    frases.push({
      texto: ordenadas.map((x) => x.text.trim()).join(' '),
      x0: ordenadas[0].x0,
      itemId,
    });
  }

  frases.sort((a, b) => a.x0 - b.x0);
  return frases.map((f) => ({
    texto: f.texto.replace(/\s+/g, ' ').trim().toUpperCase(),
    x0: f.x0,
    itemId: f.itemId,
  }));
}

/**
 * `_construir_col_map` + lectura de cabecera: {campo: [xIni, xFin]} usando
 * los x0 reales del header; los límites son el punto medio entre header
 * consecutivos + 5.
 *
 * Diferencia con el Python original: los títulos DESCONOCIDOS ya no se
 * descartan — se registran como `__ignorada_N` y se quedan con su propio
 * rango x. Sin eso, cuando Naturgy agregó "CUENTA" entre PROVINCIA y
 * Cantidades (agosto 2026), el número de cuenta (922) caía dentro del rango
 * de `cantidades` y se cargaba como cantidad certificada en lugar del 221
 * real. Las ignoradas se informan al usuario como avisos de lectura.
 */
export function construirCabecera(headerWs: PalabraPosicionada[]): Cabecera {
  const frases = frasesDeCabecera(headerWs);
  const detectados: [number, string][] = [];
  const ignoradas: string[] = [];
  let nIgn = 0;

  for (const f of frases) {
    if (f.texto === '') continue;
    // Match exacto de la frase completa: ver el comentario de HEADER_FRASES
    // (un fallback por primera palabra secuestraría la columna real).
    const campo = HEADER_FRASES[f.texto];
    if (campo) {
      if (!detectados.some(([, c]) => c === campo)) detectados.push([f.x0, campo]);
      continue;
    }
    if (f.itemId === undefined && CONTINUACIONES.has(f.texto)) continue;
    ignoradas.push(f.texto);
    detectados.push([f.x0, `__ignorada_${nIgn++}`]);
  }
  detectados.sort((a, b) => a[0] - b[0]);

  const colMap: ColMap = new Map();
  const n = detectados.length;
  for (let i = 0; i < n; i++) {
    const [x0, campo] = detectados[i];
    const xFin = i + 1 < n ? (x0 + detectados[i + 1][0]) / 2 + 5 : 99999;
    const xIni = i > 0 ? (detectados[i - 1][0] + x0) / 2 + 5 : 0;
    colMap.set(campo, [xIni, xFin]);
  }

  const faltantes = COLUMNAS_REQUERIDAS.filter((c) => !colMap.has(c));
  return { colMap, ignoradas, faltantes: [...faltantes] };
}

/** Compatibilidad: el colMap suelto que consumen los specs y el resto del módulo. */
export function construirColMap(headerWs: PalabraPosicionada[]): ColMap {
  return construirCabecera(headerWs).colMap;
}

/** `_get_texto`: extrae y pega palabras de un campo según su rango x (una línea). */
function obtenerTexto(ws: PalabraPosicionada[], colMap: ColMap, campo: string): string {
  const rango = colMap.get(campo);
  if (!rango) return '';
  const [xMin, xMax] = rango;
  const palabras = ws.filter((w) => w.x0 >= xMin && w.x0 < xMax);
  if (palabras.length === 0) return '';
  if (campo === 'item_codigo') return palabras[0].text.trim();
  return pegarPalabras(palabras);
}

/**
 * `_get_texto_grupo`: extrae un campo de una fila lógica multilínea.
 * modo "primero": primera línea con valor. modo "juntar": concatena todas.
 */
export function obtenerTextoGrupo(
  grupo: PalabraPosicionada[][],
  colMap: ColMap,
  campo: string,
  modo: 'primero' | 'juntar',
): string {
  const chunks = grupo.map((ws) => obtenerTexto(ws, colMap, campo)).filter((t) => t);
  if (chunks.length === 0) return '';
  return modo === 'juntar' ? chunks.join(' ') : chunks[0];
}

/** `_get_num_grupo`: primer valor numérico válido del campo en las líneas del grupo. */
export function obtenerNumGrupo(
  grupo: PalabraPosicionada[][],
  colMap: ColMap,
  campo: string,
): string | null {
  for (const ws of grupo) {
    const n = limpiarNum(obtenerTexto(ws, colMap, campo));
    if (n !== null) return n;
  }
  return null;
}

/** Agrupa palabras por línea cuantizando `top` con `round(top/4)*4`. */
export function agruparPorLinea(words: PalabraPosicionada[]): Map<number, PalabraPosicionada[]> {
  const lineas = new Map<number, PalabraPosicionada[]>();
  for (const w of words) {
    const top = Math.round(w.top / 4) * 4;
    if (!lineas.has(top)) lineas.set(top, []);
    lineas.get(top)!.push(w);
  }
  return lineas;
}

/**
 * `_extraer_meta`: k_gasnor por `\bK(\d+)\b` en el texto completo;
 * total_declarado por `TOTAL MES \$? ((?:[\d.,]+\s*)+)` (monto que puede
 * venir partido en varias palabras). `nro_np` nunca se completa en el PDF
 * (el Python original no lo busca acá) — queda siempre null.
 */
export function extraerMeta(words: PalabraPosicionada[]): Meta {
  const meta: Meta = { k_gasnor: null, nro_np: null, total_declarado: null };
  const full = words.map((w) => w.text).join(' ').toUpperCase();

  const mK = full.match(/\bK(\d+)\b/);
  if (mK) meta.k_gasnor = 'K' + mK[1];

  const mTotal = full.match(/TOTAL MES\s*\$?\s*((?:[\d.,]+\s*)+)/);
  if (mTotal) {
    const n = limpiarNum(mTotal[1].replace(/\s+/g, ''));
    if (n !== null) meta.total_declarado = Number(n);
  }
  return meta;
}

/** Normaliza provincia: dict PROVINCIAS por substring sin tildes, fallback .title(). */
export function normalizarProvincia(provinciaRaw: string): string {
  const provKey = provinciaRaw.toLowerCase().replace(/á/g, 'a').replace(/é/g, 'e');
  for (const [key, val] of Object.entries(PROVINCIAS)) {
    if (provKey.includes(key)) return val;
  }
  return provinciaRaw ? tituloEs(provinciaRaw) : '';
}

/** `_procesar_fila`: arma una FilaParseada a partir de las líneas de una fila lógica. */
export function procesarFila(
  grupo: PalabraPosicionada[][],
  colMap: ColMap,
  nombreArchivo: string,
  numFila: number,
  anio: number,
  mes: number,
  meta: Meta,
): { fila: FilaParseada; errores: ErrorParseo[] } {
  const errores: ErrorParseo[] = [];

  const get = (campo: string, modo: 'primero' | 'juntar' = 'primero'): string =>
    obtenerTextoGrupo(grupo, colMap, campo, modo);
  const num = (campo: string): string | null => obtenerNumGrupo(grupo, colMap, campo);

  const itemCodigo = get('item_codigo').trim();
  const tarea = get('tarea', 'juntar').trim() || null;
  const contratoRaw = get('contrato').trim().toUpperCase();
  const unidadMedida = get('unidad_medida').trim() || null;
  const ptosGasnor = num('ptos_gasnor');
  const tipo = get('tipo').trim() || null;
  let contratista = get('contratista').trim() || null;
  const provinciaRaw = get('provincia').trim();
  const cantidades = num('cantidades');
  const precioUnitario = num('precio_unitario');
  const totalMes = num('total_mes');
  const observaciones = get('observaciones', 'juntar').trim() || null;

  const mC = contratoRaw.match(/^K\d+/);
  const contrato = mC ? mC[0] : meta.k_gasnor || '';

  const provincia = normalizarProvincia(provinciaRaw);

  if (contratista && provincia) {
    contratista = contratista.replace(new RegExp(escapeRegExp(provincia), 'ig'), '').trim();
  }

  let tieneError = false;
  if (!provincia) {
    errores.push({
      hoja: nombreArchivo,
      fila: numFila,
      campo: 'provincia',
      mensaje: 'Provincia vacía.',
    });
    tieneError = true;
  }
  if (!contrato) {
    errores.push({
      hoja: nombreArchivo,
      fila: numFila,
      campo: 'contrato',
      mensaje: 'Contrato K no detectado.',
    });
    tieneError = true;
  }

  const fila: FilaParseada = {
    hoja_origen: nombreArchivo,
    archivo_origen: nombreArchivo,
    item_codigo: itemCodigo,
    nombre_contrato: null,
    tarea,
    contrato,
    unidad_medida: unidadMedida,
    ptos_gasnor: ptosGasnor,
    tipo,
    contratista,
    provincia,
    region: '',
    cantidades,
    precio_unitario: precioUnitario,
    total_mes: totalMes,
    observaciones,
    fecha: `${anio}-${pad2(mes)}-01`,
    nro_np: meta.nro_np,
    tiene_error: tieneError,
    fila_excel: numFila,
  };

  return { fila, errores };
}

export interface ResultadoPagina {
  filas: FilaParseada[];
  errores: ErrorParseo[];
  totalDeclarado: number | null;
  /** Títulos de cabecera de esta página que no reconocimos. */
  columnasIgnoradas: string[];
}

/**
 * `_procesar_pagina` (parte pura, sin pdfplumber): recibe las palabras
 * posicionadas de UNA página ya extraídas y devuelve filas/errores/total.
 */
export function procesarPagina(
  words: PalabraPosicionada[],
  nombreArchivo: string,
  anio: number,
  mes: number,
): ResultadoPagina {
  const resultado: ResultadoPagina = {
    filas: [],
    errores: [],
    totalDeclarado: null,
    columnasIgnoradas: [],
  };
  if (words.length === 0) return resultado;

  const meta = extraerMeta(words);
  resultado.totalDeclarado = meta.total_declarado;

  const lineas = agruparPorLinea(words);
  const tops = Array.from(lineas.keys()).sort((a, b) => a - b);

  let headerTop: number | null = null;
  let cabecera: Cabecera | null = null;
  for (const top of tops) {
    const ws = [...lineas.get(top)!].sort((a, b) => a.x0 - b.x0);
    const textos = ws.map((w) => w.text.trim().toUpperCase());
    if (textos.includes('ÍTEMS') || textos.includes('ITEMS')) {
      headerTop = top;
      cabecera = construirCabecera(ws);
      break;
    }
  }

  if (headerTop === null || !cabecera || cabecera.colMap.size === 0) return resultado;

  // Falta una columna requerida: leer las filas daría valores corridos de
  // columna, así que no se procesa nada y se avisa qué falta.
  if (cabecera.faltantes.length > 0) {
    resultado.errores.push({
      hoja: nombreArchivo,
      fila: 0,
      campo: 'header',
      mensaje:
        `Faltan columnas requeridas en la cabecera: ${cabecera.faltantes.join(', ')}. ` +
        `Se ignoraron: ${cabecera.ignoradas.join(', ') || 'ninguna'}.`,
    });
    return resultado;
  }

  resultado.columnasIgnoradas = cabecera.ignoradas;
  const colMap = cabecera.colMap;

  const itemXMax = (colMap.get('item_codigo') || [0, 384])[1];

  const grupos: PalabraPosicionada[][][] = [];
  let grupoActual: PalabraPosicionada[][] | null = null;

  for (const top of tops.filter((t) => t > (headerTop as number))) {
    const ws = [...lineas.get(top)!].sort((a, b) => a.x0 - b.x0);
    if (ws.length === 0) continue;

    const textoLinea = ws.map((w) => w.text).join(' ').toUpperCase();
    if (FOOTER_PALABRAS.some((p) => textoLinea.includes(p))) break;

    const primer = ws[0];
    const esItem = esItemValido(primer.text.trim()) && primer.x0 < itemXMax;

    if (esItem) {
      grupoActual = [ws];
      grupos.push(grupoActual);
    } else if (grupoActual !== null) {
      grupoActual.push(ws);
    }
    // líneas antes de la primera fila con ítem: ruido, se ignoran
  }

  grupos.forEach((grupo, idx) => {
    const numFila = idx + 1;
    const { fila, errores } = procesarFila(grupo, colMap, nombreArchivo, numFila, anio, mes, meta);
    resultado.filas.push(fila);
    resultado.errores.push(...errores);
  });

  return resultado;
}

// ---------------------------------------------------------------------
// Wrapper pdfjs-dist
// ---------------------------------------------------------------------
//
// Decisión documentada (brief T2, step 3): pdfjs-dist >= 4 solo publica
// ESM (`pdfjs-dist/legacy/build/pdf.mjs`, sin build CJS). Con
// `tsconfig.json` en `module: commonjs` (todo el resto del backend), TS
// transpila cualquier `import()` dinámico a `require()`, que revienta con
// ERR_REQUIRE_ESM al cargar un `.mjs`. La solución estándar (usada por
// paquetes como `node-fetch`/`chalk` en proyectos CJS) es forzar un
// `import()` NATIVO que TS no pueda tocar, vía `new Function(...)`. Se
// verificó a mano (ts-node + ts-jest, module: commonjs) que esto carga
// pdfjs-dist correctamente tanto en runtime normal como bajo Jest.
type ImportDinamico = (especificador: string) => Promise<any>;
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importarDinamico: ImportDinamico = new Function(
  'especificador',
  'return import(especificador)',
) as ImportDinamico;

/**
 * Reparte el texto de un item de pdfjs (que puede traer varias palabras
 * pegadas, p.ej. "Empresa SA") en `PalabraPosicionada` por token, estimando
 * x0/width de cada uno por proporción de caracteres sobre el ancho total
 * del item. Es una aproximación (pdfjs no da el x0 real por palabra dentro
 * de un mismo item de texto, a diferencia de pdfplumber que trabaja a nivel
 * de carácter) — documentada como limitación conocida del wrapper.
 */
export function dividirEnPalabras(
  texto: string,
  x0: number,
  top: number,
  width: number,
  itemId?: number,
): PalabraPosicionada[] {
  const total = texto.length;
  if (total === 0) return [];

  const tokens: { text: string; start: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    tokens.push({ text: m[0], start: m.index });
  }
  if (tokens.length === 0) return [];
  if (tokens.length === 1) {
    return [{ text: tokens[0].text, x0, top, width, itemId }];
  }
  return tokens.map(({ text, start }) => ({
    text,
    x0: x0 + (width * start) / total,
    top,
    width: (width * text.length) / total,
    itemId,
  }));
}

async function extraerPalabrasPorPagina(contenido: Buffer): Promise<PalabraPosicionada[][]> {
  const pdfjsLib = await importarDinamico('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(contenido);
  // `destroy()` vive en el loadingTask, no en PDFDocumentProxy.
  const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true });
  const pdf = await loadingTask.promise;

  const paginas: PalabraPosicionada[][] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const alturaPagina = page.getViewport({ scale: 1 }).height;
      const content = await page.getTextContent();
      const palabras: PalabraPosicionada[] = [];

      // El índice del item se propaga como `itemId`: pdfjs entrega los
      // títulos multipalabra de la cabecera ("NOMBRE CONTRATO", "$ Total
      // mes") en UN solo item, y ese id es lo que después le permite a
      // `construirCabecera` volver a armar la frase completa.
      const items = content.items as any[];
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const texto: string | undefined = item.str;
        if (!texto || !texto.trim()) continue;
        const x0 = item.transform[4];
        const y = item.transform[5];
        const top = alturaPagina - y; // pdfjs: y crece hacia arriba → invertir para calcar pdfplumber
        const width = item.width ?? 0;
        palabras.push(...dividirEnPalabras(texto, x0, top, width, idx));
      }
      paginas.push(palabras);
    }
  } finally {
    await loadingTask.destroy();
  }
  return paginas;
}

/**
 * `parsear_pdf_bytes`: punto de entrada del parser PDF. Mismo shape de
 * salida que el parser Excel (T1): `hojas = [nombreArchivo]`,
 * `nombre_contrato = null`, `region = ""`.
 */
export async function parsearPdf(
  contenido: Buffer,
  nombreArchivo: string,
  anio: number,
  mes: number,
): Promise<ResultadoParseo> {
  const resultado: ResultadoParseo = {
    archivo: nombreArchivo,
    hojas: [nombreArchivo],
    filas: [],
    errores: [],
    periodo: `${anio}-${pad2(mes)}`,
    total_declarado: null,
    avisos: [],
    columnas_ignoradas: [],
    periodo_archivo: null,
    k_nombre_archivo: extraerKDeNombre(nombreArchivo),
  };

  let paginas: PalabraPosicionada[][];
  try {
    paginas = await extraerPalabrasPorPagina(contenido);
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    resultado.errores.push({
      hoja: nombreArchivo,
      fila: 0,
      campo: 'archivo',
      mensaje: `No se pudo abrir el PDF: ${mensaje}`,
    });
    return resultado;
  }

  for (const words of paginas) {
    const pagina = procesarPagina(words, nombreArchivo, anio, mes);
    resultado.filas.push(...pagina.filas);
    resultado.errores.push(...pagina.errores);
    if (resultado.total_declarado === null) resultado.total_declarado = pagina.totalDeclarado;
    for (const columna of pagina.columnasIgnoradas) {
      if (!resultado.columnas_ignoradas.includes(columna)) {
        resultado.columnas_ignoradas.push(columna);
      }
    }
  }

  for (const columna of resultado.columnas_ignoradas) {
    resultado.avisos.push({
      tipo: 'columna_ignorada',
      hoja: nombreArchivo,
      fila: 0,
      fuerte: false,
      mensaje: `Columna ignorada: ${columna}. Sus valores no se asignaron a ninguna columna.`,
    });
  }

  return resultado;
}
