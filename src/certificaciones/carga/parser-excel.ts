/**
 * parser-excel.ts — port de parser.py (PortalCertificaciones) a TS puro.
 *
 * Sin Nest, sin Prisma: recibe un Buffer y devuelve ResultadoParseo. Busca
 * columnas por nombre (COL_ALIAS), no por posición del Excel de Naturgy.
 *
 * Paridad exacta con el Python salvo dos fixes conscientes del inventario
 * (docs/superpowers/specs/2026-09-02-inventario-carga-portal.md §2):
 *   - B4: `fila_excel` es la fila REAL 1-based del archivo, incluso si hubo
 *     descartes en el medio (el Python original re-enumeraba secuencial).
 *   - B6: el mapeo de columnas se resuelve UNA VEZ por ÍNDICE de columna,
 *     así headers duplicados no corrompen valores (toma la primera).
 *
 * Nota exceljs: una celda puede traer number, string, Date, {richText:[...]}
 * o {formula, result}. `valorCelda` normaliza todo a lo que produciría
 * `str(v)` en pandas para los fines de este parser. Para números elegimos
 * `String(numero)` simple (p.ej. 431 → "431", no "431.0"): tanto "431" como
 * "431.0" parsean igual en fmt_num/fmt_item, así que el resultado final no
 * cambia — documentado a pedido del brief.
 */
import * as ExcelJS from 'exceljs';
import { ErrorParseo, FilaParseada, ResultadoParseo } from './parser-tipos';

/** Mapeo flexible: nombre canónico → variantes posibles en el header (orden = prioridad). */
const COL_ALIAS: Record<string, string[]> = {
  item_codigo: ['ÍTEMS', 'ITEMS', 'ÍTEM', 'ITEM'],
  nombre_contrato: ['NOMBRE CONTRATO', 'NOMBRE_CONTRATO'],
  tarea: ['TAREA', 'DESCRIPCION', 'DESCRIPCIÓN'],
  contrato: ['K GASNOR', 'K_GASNOR', 'K GASNOR ', 'K'],
  unidad_medida: ['UM', 'UNIDAD', 'UNIDAD MEDIDA'],
  ptos_gasnor: ['PTOS. GASNOR', 'PTOS GASNOR', 'PUNTOS GASNOR', 'PUNTOS', 'PTOS'],
  tipo: ['TIPO'],
  contratista: ['CONTRATISTA'],
  provincia: ['PROVINCIA'],
  cantidades: ['CANTIDADES', 'CANTIDAD'],
  precio_unitario: ['$ UNITARIO MES', 'UNITARIO MES', '$ UNITARIO', 'PRECIO UNITARIO', '$ UNIT'],
  total_mes: ['$ TOTAL MES', 'TOTAL MES', '$ TOTAL', 'TOTAL CERTIFICADO', 'TOTAL'],
  observaciones: ['OBSERVACIONES', 'OBS', 'OBSERVACION'],
};

const HEADER_ITEM = new Set(['ÍTEMS', 'ITEMS', 'ÍTEM', 'ITEM']);
const LITERALES_NULOS = new Set(['NAN', 'NAT', 'NONE', '#N/A', '']);
const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function normalizarEspacios(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Extrae el valor "plano" de una celda exceljs (number|string|boolean|Date|null). */
function valorCeldaPlano(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('richText' in (v as any)) {
      return ((v as any).richText as Array<{ text: string }>).map((r) => r.text).join('');
    }
    if ('formula' in (v as any)) {
      return valorCeldaPlano((v as any).result as ExcelJS.CellValue);
    }
    if ('error' in (v as any)) return String((v as any).error);
    if ('text' in (v as any)) return String((v as any).text);
    return null;
  }
  return v;
}

/** Texto crudo de una celda. Para celdas con fórmula usa `cell.result`: exceljs
 * OMITE `result` dentro de `cell.value` cuando el resultado cacheado es 0 (falsy),
 * así que leer `cell.value.result` convertía todo 0 en null (bug visto con los
 * Excel reales de Naturgy: "Cantidad es 0." desaparecía y TOTAL MES se perdía). */
function rawDeCelda(cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  if (v !== null && typeof v === 'object' && ('formula' in (v as any) || 'sharedFormula' in (v as any))) {
    const res = cell.result;
    return rawToStr((res === undefined ? null : res) as ExcelJS.CellValue);
  }
  return rawToStr(v);
}

/** Equivalente a `str(v)` de Python para los tipos que produce exceljs. */
function rawToStr(v: ExcelJS.CellValue): string | null {
  const plano = valorCeldaPlano(v);
  if (plano === null || plano === undefined) return null;
  if (plano instanceof Date) return plano.toISOString();
  return String(plano);
}

function parseFloatEstricto(s: string): number | null {
  if (!FLOAT_RE.test(s)) return null;
  const f = Number(s);
  return Number.isFinite(f) ? f : null;
}

function tituloEs(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

function extraerRegion(nombreHoja: string): string {
  const h = nombreHoja.toUpperCase();
  if (h.includes('NORTE')) return 'Norte';
  if (h.includes('SUR')) return 'Sur';
  return '';
}

/** '$ 39.072.433,92' | '39072433.92' → number, o null si no es un monto. */
function parsearMonto(v: string): number | null {
  let s = v.replace(/[$\s]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(/,/g, '.');
  } else if (s.includes(',')) {
    s = s.replace(/,/g, '.');
  }
  return parseFloatEstricto(s);
}

/** fmt_num: normaliza es-AR; devuelve STRING normalizada o null si no parsea. */
function fmtNum(v: string | null): string | null {
  if (v === null) return null;
  let s = v.replace(/[$\s]/g, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(/,/g, '.');
  } else if (s.includes(',')) {
    s = s.replace(/,/g, '.');
  }
  return parseFloatEstricto(s) === null ? null : s;
}

/** fmt_item: numérico → entero o 4 decimales; texto tal cual; null → "". */
function fmtItem(v: string | null): string {
  if (v === null) return '';
  const f = parseFloatEstricto(v.replace(/,/g, '.'));
  if (f === null) return v;
  if (f === Math.trunc(f)) return String(Math.trunc(f));
  return String(Number(f.toFixed(4)));
}

function esItemValido(raw: string | null): boolean {
  if (raw === null) return false;
  const s = raw.trim();
  if (!s) return false;
  const su = s.toUpperCase();
  if (su === 'NAN' || su === 'NAT' || su === 'NONE' || HEADER_ITEM.has(su) || su === '') {
    return false;
  }
  if (parseFloatEstricto(s.replace(/,/g, '.')) !== null) return true;
  return /^[A-Za-z0-9][A-Za-z0-9\s\-_,.]*$/.test(s);
}

/** Dado el header en UPPER (índice 1-based → texto), resuelve {canon: índice de columna}. */
function mapearColumnas(headerUpper: Map<number, string>): Map<string, number> {
  const headerNorm = new Map<number, string>();
  for (const [idx, h] of headerUpper) headerNorm.set(idx, normalizarEspacios(h));

  const mapa = new Map<string, number>();
  for (const [canon, aliases] of Object.entries(COL_ALIAS)) {
    for (const alias of aliases) {
      const aliasNorm = normalizarEspacios(alias);
      let encontrado: number | undefined;
      for (const [idx, h] of headerNorm) {
        if (h === aliasNorm) {
          encontrado = idx;
          break;
        }
      }
      if (encontrado !== undefined) {
        mapa.set(canon, encontrado);
        break;
      }
    }
  }
  return mapa;
}

interface Meta {
  k_gasnor: string | null;
  nro_np: string | null;
  fecha: string;
  total_declarado: number | null;
}

function extraerMeta(
  worksheet: ExcelJS.Worksheet,
  nombreHoja: string,
  anio: number,
  mes: number,
): Meta {
  const meta: Meta = {
    k_gasnor: null,
    nro_np: null,
    fecha: `${anio}-${pad2(mes)}-01`,
    total_declarado: null,
  };

  const mSheet = nombreHoja.toUpperCase().match(/K\d+/);
  if (mSheet) meta.k_gasnor = mSheet[0];

  const filasMeta = Math.min(13, worksheet.rowCount || 0);
  for (let r = 1; r <= filasMeta; r++) {
    const row = worksheet.getRow(r);
    const vals: string[] = [];
    const colCount = Math.max(row.cellCount, worksheet.columnCount || 0);
    for (let c = 1; c <= colCount; c++) {
      const raw = rawDeCelda(row.getCell(c));
      if (raw === null) continue;
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed.toLowerCase() === 'nan') continue;
      vals.push(trimmed);
    }

    for (const v of vals) {
      if (/^K\d+$/i.test(v) && !meta.k_gasnor) meta.k_gasnor = v.toUpperCase();
    }

    const filaStr = vals.join(' ').toUpperCase();
    if ((filaStr.includes('NRO. DE NP') || filaStr.includes('NRO DE NP')) && !meta.nro_np) {
      for (let i = 0; i < vals.length; i++) {
        if (vals[i].toUpperCase().includes('NP') && i + 1 < vals.length) {
          meta.nro_np = vals[i + 1];
        }
      }
    }

    if (meta.total_declarado === null) {
      for (let i = 0; i < vals.length; i++) {
        if (vals[i].toUpperCase().includes('TOTAL MES') && i + 1 < vals.length) {
          meta.total_declarado = parsearMonto(vals[i + 1]);
          break;
        }
      }
    }
  }

  return meta;
}

function encontrarHeaderIdx(worksheet: ExcelJS.Worksheet): number | null {
  const filas = worksheet.rowCount || 0;
  for (let r = 1; r <= filas; r++) {
    const row = worksheet.getRow(r);
    const colCount = Math.max(row.cellCount, worksheet.columnCount || 0);
    for (let c = 1; c <= colCount; c++) {
      const raw = rawDeCelda(row.getCell(c));
      if (raw !== null && HEADER_ITEM.has(raw.trim().toUpperCase())) {
        return r;
      }
    }
  }
  return null;
}

function procesarFila(
  row: ExcelJS.Row,
  colMap: Map<string, number>,
  hoja: string,
  filaExcel: number,
  archivo: string,
  meta: Meta,
): { fila: FilaParseada; errores: ErrorParseo[] } {
  const errores: ErrorParseo[] = [];

  const get = (campo: string): string | null => {
    const col = colMap.get(campo);
    if (col === undefined) return null;
    const raw = rawDeCelda(row.getCell(col));
    if (raw === null) return null;
    const s = raw.trim();
    return s && !LITERALES_NULOS.has(s.toUpperCase()) ? s : null;
  };

  const itemCodigo = fmtItem(get('item_codigo'));
  const nombreContrato = get('nombre_contrato');
  const tarea = get('tarea');
  let contrato = (get('contrato') || '').trim().toUpperCase() || meta.k_gasnor || '';
  const unidadMedida = get('unidad_medida');
  const ptosGasnor = fmtNum(get('ptos_gasnor'));
  const tipo = get('tipo');
  const contratista = get('contratista');
  const provinciaTitulo = (get('provincia') || '').trim();
  const provincia = provinciaTitulo ? tituloEs(provinciaTitulo) : '';
  const cantidades = fmtNum(get('cantidades'));
  const precioUnitario = fmtNum(get('precio_unitario'));
  const totalMes = fmtNum(get('total_mes'));
  const observaciones = get('observaciones');

  if (contrato && !contrato.startsWith('K')) {
    contrato = 'K' + contrato.replace(/^[kK]+/, '');
  }

  let tieneError = false;
  if (!contrato) {
    errores.push({ hoja, fila: filaExcel, campo: 'contrato', mensaje: 'Contrato K no detectado.' });
    tieneError = true;
  }
  if (cantidades !== null && Number(cantidades) === 0) {
    errores.push({ hoja, fila: filaExcel, campo: 'cantidades', mensaje: 'Cantidad es 0.' });
  }

  const fila: FilaParseada = {
    hoja_origen: hoja,
    archivo_origen: archivo,
    item_codigo: itemCodigo,
    nombre_contrato: nombreContrato,
    tarea,
    contrato,
    unidad_medida: unidadMedida,
    ptos_gasnor: ptosGasnor,
    tipo,
    contratista,
    provincia,
    region: extraerRegion(hoja),
    cantidades,
    precio_unitario: precioUnitario,
    total_mes: totalMes,
    observaciones,
    fecha: meta.fecha,
    nro_np: meta.nro_np,
    tiene_error: tieneError,
    fila_excel: filaExcel,
  };

  return { fila, errores };
}

function procesarHoja(
  worksheet: ExcelJS.Worksheet,
  nombreArchivo: string,
  anio: number,
  mes: number,
  resultado: ResultadoParseo,
): void {
  const nombreHoja = worksheet.name;

  const headerIdx = encontrarHeaderIdx(worksheet);
  if (headerIdx === null) {
    resultado.errores.push({
      hoja: nombreHoja,
      fila: 0,
      campo: 'header',
      mensaje: 'No se encontró la fila de encabezado (ÍTEMS).',
    });
    return;
  }

  const meta = extraerMeta(worksheet, nombreHoja, anio, mes);
  if (resultado.total_declarado === null) {
    resultado.total_declarado = meta.total_declarado;
  }

  const headerRow = worksheet.getRow(headerIdx);
  const colCount = Math.max(headerRow.cellCount, worksheet.columnCount || 0);
  const headerUpper = new Map<number, string>();
  for (let c = 1; c <= colCount; c++) {
    const raw = rawDeCelda(headerRow.getCell(c));
    headerUpper.set(c, raw !== null ? raw.trim().toUpperCase() : '');
  }

  const colMap = mapearColumnas(headerUpper);

  if (!colMap.has('item_codigo')) {
    const primeros12 = Array.from(headerUpper.values()).slice(0, 12);
    resultado.errores.push({
      hoja: nombreHoja,
      fila: 0,
      campo: 'header',
      mensaje: `Columna ÍTEMS no encontrada. Header: ${JSON.stringify(primeros12)}`,
    });
    return;
  }

  const colItem = colMap.get('item_codigo')!;
  const totalFilas = worksheet.rowCount || 0;
  for (let r = headerIdx + 1; r <= totalFilas; r++) {
    const row = worksheet.getRow(r);
    const rawItem = rawDeCelda(row.getCell(colItem));
    if (!esItemValido(rawItem)) continue;

    const { fila, errores } = procesarFila(row, colMap, nombreHoja, r, nombreArchivo, meta);
    resultado.filas.push(fila);
    resultado.errores.push(...errores);
  }
}

export async function parsearExcel(
  contenido: Buffer,
  nombreArchivo: string,
  anio: number,
  mes: number,
): Promise<ResultadoParseo> {
  const resultado: ResultadoParseo = {
    archivo: nombreArchivo,
    hojas: [],
    filas: [],
    errores: [],
    periodo: `${anio}-${pad2(mes)}`,
    total_declarado: null,
  };

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(contenido as unknown as ExcelJS.Buffer);
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    resultado.errores.push({
      hoja: '—',
      fila: 0,
      campo: 'archivo',
      mensaje: `No se pudo abrir el archivo: ${mensaje}`,
    });
    return resultado;
  }

  let hojasCert = workbook.worksheets.filter((ws) =>
    ws.name.trim().toUpperCase().startsWith('CERTIF'),
  );
  if (hojasCert.length === 0) hojasCert = workbook.worksheets;

  resultado.hojas = hojasCert.map((ws) => ws.name);

  for (const ws of hojasCert) {
    procesarHoja(ws, nombreArchivo, anio, mes, resultado);
  }

  return resultado;
}
