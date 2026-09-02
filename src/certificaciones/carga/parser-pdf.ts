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

/** Palabra con posición, equivalente al dict que devuelve `page.extract_words()` de pdfplumber. */
export interface PalabraPosicionada {
  text: string;
  x0: number;
  top: number;
  width: number;
}

/** Palabras del header → nombre canónico del campo. */
const HEADER_PALABRAS: Record<string, string> = {
  ÍTEMS: 'item_codigo',
  ITEMS: 'item_codigo',
  NOMBRE: 'nombre_contrato',
  TAREA: 'tarea',
  K: 'contrato',
  UM: 'unidad_medida',
  'PTOS.': 'ptos_gasnor',
  TIPO: 'tipo',
  CONTRATISTA: 'contratista',
  PROVINCIA: 'provincia',
  CANTIDADES: 'cantidades',
  UNITARIO: 'precio_unitario',
  TOTAL: 'total_mes',
  OBSERVACIONES: 'observaciones',
};

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

type ColMap = Map<string, [number, number]>;

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

const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

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
 * `_limpiar_num`: toma solo el PRIMER bloque `^[\d.,]+` (tras quitar $),
 * hace strip(".,") de ambos extremos y aplica la regla es-AR coma/punto.
 * Devuelve la STRING normalizada o null si no parsea como float.
 */
export function limpiarNum(s: string | null | undefined): string | null {
  if (!s) return null;
  let str = s.replace(/\$/g, '').trim();
  const m = str.match(/^[\d.,]+/);
  if (!m) return null;
  str = m[0].replace(/^[.,]+/, '').replace(/[.,]+$/, '');
  if (str.includes(',') && str.includes('.')) {
    str = str.replace(/\./g, '').replace(/,/g, '.');
  } else if (str.includes(',')) {
    str = str.replace(/,/g, '.');
  }
  return FLOAT_RE.test(str) ? str : null;
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

/**
 * `_construir_col_map`: {campo: [xIni, xFin]} usando los x0 reales del
 * header; los límites son el punto medio entre header consecutivos + 5.
 */
export function construirColMap(headerWs: PalabraPosicionada[]): ColMap {
  const ordenados = [...headerWs].sort((a, b) => a.x0 - b.x0);
  const detectados: [number, string][] = [];
  for (const w of ordenados) {
    const texto = w.text.trim().toUpperCase();
    const campo = HEADER_PALABRAS[texto];
    if (campo && !detectados.some(([, c]) => c === campo)) {
      detectados.push([w.x0, campo]);
    }
  }

  const colMap: ColMap = new Map();
  const n = detectados.length;
  for (let i = 0; i < n; i++) {
    const [x0, campo] = detectados[i];
    const xFin = i + 1 < n ? (x0 + detectados[i + 1][0]) / 2 + 5 : 99999;
    const xIni = i > 0 ? (detectados[i - 1][0] + x0) / 2 + 5 : 0;
    colMap.set(campo, [xIni, xFin]);
  }
  return colMap;
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
  const resultado: ResultadoPagina = { filas: [], errores: [], totalDeclarado: null };
  if (words.length === 0) return resultado;

  const meta = extraerMeta(words);
  resultado.totalDeclarado = meta.total_declarado;

  const lineas = agruparPorLinea(words);
  const tops = Array.from(lineas.keys()).sort((a, b) => a - b);

  let headerTop: number | null = null;
  let colMap: ColMap | null = null;
  for (const top of tops) {
    const ws = [...lineas.get(top)!].sort((a, b) => a.x0 - b.x0);
    const textos = ws.map((w) => w.text.trim().toUpperCase());
    if (textos.includes('ÍTEMS') || textos.includes('ITEMS')) {
      headerTop = top;
      colMap = construirColMap(ws);
      break;
    }
  }

  if (headerTop === null || !colMap || colMap.size === 0) return resultado;

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
    const { fila, errores } = procesarFila(grupo, colMap as ColMap, nombreArchivo, numFila, anio, mes, meta);
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
    return [{ text: tokens[0].text, x0, top, width }];
  }
  return tokens.map(({ text, start }) => ({
    text,
    x0: x0 + (width * start) / total,
    top,
    width: (width * text.length) / total,
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

      for (const item of content.items as any[]) {
        const texto: string | undefined = item.str;
        if (!texto || !texto.trim()) continue;
        const x0 = item.transform[4];
        const y = item.transform[5];
        const top = alturaPagina - y; // pdfjs: y crece hacia arriba → invertir para calcar pdfplumber
        const width = item.width ?? 0;
        palabras.push(...dividirEnPalabras(texto, x0, top, width));
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
  }

  return resultado;
}
