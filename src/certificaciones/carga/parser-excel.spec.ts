import * as ExcelJS from 'exceljs';
import { parsearExcel } from './parser-excel';

type Celda = string | number | null;

async function crearLibro(hojas: Array<{ nombre: string; filas: Celda[][] }>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const h of hojas) {
    const ws = wb.addWorksheet(h.nombre);
    for (const fila of h.filas) ws.addRow(fila);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function crearLibroUnaHoja(nombre: string, filas: Celda[][]): Promise<Buffer> {
  return crearLibro([{ nombre, filas }]);
}

describe('parsearExcel — casos del brief T1 (port de parser.py)', () => {
  // Regresión (archivos reales de Naturgy): exceljs omite `result` en `cell.value`
  // cuando el resultado cacheado de una fórmula es 0 (falsy); solo `cell.result` lo
  // conserva. Sin este caso, cantidades/total_mes con fórmula = 0 se leían como null
  // (desaparecía el error "Cantidad es 0.") y el TOTAL MES de cabecera se perdía.
  it('lee el resultado 0 de celdas con fórmula (cantidades, total_mes y TOTAL MES)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('CERTIFICO K5');
    ws.addRow(['TOTAL MES', { formula: 'SUM(C3:C3)', result: 0 }]);
    ws.addRow(['ÍTEMS', 'CANTIDADES', '$ TOTAL MES']);
    ws.addRow(['289', { formula: 'B1*0', result: 0 }, { formula: 'B3*100', result: 0 }]);
    ws.addRow(['290', { formula: 'B1*0', result: 2 }, { formula: 'B4*100', result: 200 }]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const r = await parsearExcel(buf, 'test.xlsx', 2026, 7);

    expect(r.total_declarado).toBe(0);
    expect(r.filas).toHaveLength(2);
    expect(r.filas[0].cantidades).toBe('0');
    expect(r.filas[0].total_mes).toBe('0');
    expect(r.filas[1].cantidades).toBe('2');
    expect(r.filas[1].total_mes).toBe('200');
    expect(r.errores).toEqual([
      { hoja: 'CERTIFICO K5', fila: 3, campo: 'cantidades', mensaje: 'Cantidad es 0.' },
    ]);
  });

  // Caso 1: header en fila 5, aliases mezclados, region Norte, k_gasnor del nombre de hoja.
  it('mapea columnas con aliases mezclados y detecta region/k_gasnor por nombre de hoja', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K8 NORTE', [
      ['CONTRATISTA', 'SER&TEC'],
      ['K', 'K8'],
      [],
      [],
      ['ÍTEMS', 'TAREA', 'K GASNOR', 'UM', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
      ['431', 'Atención de urgencias', 'K8', 'U', 'Jujuy', 15, 59164.8, 887472],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.hojas).toEqual(['CERTIF K8 NORTE']);
    expect(r.filas).toHaveLength(1);
    const f = r.filas[0];
    expect(f.item_codigo).toBe('431');
    expect(f.contrato).toBe('K8');
    expect(f.region).toBe('Norte');
    expect(f.unidad_medida).toBe('U');
    expect(f.fila_excel).toBe(6);
  });

  // Caso 2: números es-AR (total declarado, cantidades, total_mes).
  it('normaliza números es-AR: total declarado, cantidades y total_mes', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K6', [
      ['TOTAL MES', '$ 39.072.433,92'],
      ['ÍTEMS', 'CANTIDADES', 'TOTAL'],
      ['431', '3,5', '1.234,56'],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.total_declarado).toBe(39072433.92);
    expect(r.filas[0].cantidades).toBe('3.5');
    expect(r.filas[0].total_mes).toBe('1234.56');
  });

  // Caso 3: fmt_item — float de celda, texto con coma, texto alfanumérico, celda vacía descartada.
  it('fmt_item: numérico entero, decimal con coma, texto tal cual; vacío se descarta', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K1', [
      ['ÍTEMS'],
      [431],
      ['431,2'],
      ['116-a'],
      [null],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas.map((f) => f.item_codigo)).toEqual(['431', '431.2', '116-a']);
    expect(r.filas.map((f) => f.fila_excel)).toEqual([2, 3, 4]);
  });

  // Caso 4: fila de subtotal "TOTAL:" descartada; header repetido descartado.
  it('descarta filas de subtotal ("TOTAL:") y repeticiones del header', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K2', [
      ['ÍTEMS'],
      ['431'],
      ['TOTAL:'],
      ['ÍTEMS'],
      ['432'],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas.map((f) => f.item_codigo)).toEqual(['431', '432']);
    expect(r.filas.map((f) => f.fila_excel)).toEqual([2, 5]);
  });

  // Caso 5 (fix B4): fila_excel real tras descartes en el medio.
  it('fix B4: fila_excel es la fila REAL del archivo aunque haya descartes en el medio', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K3', [
      [],
      [],
      [],
      [],
      ['ÍTEMS'],
      ['431'],
      [null],
      ['432'],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas.map((f) => f.fila_excel)).toEqual([6, 8]);
  });

  // Caso 6 (fix B6): headers duplicados (dos columnas "TOTAL") → toma la primera.
  it('fix B6: headers duplicados no corrompen el mapeo, toma la primera columna', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K4', [
      ['ÍTEMS', 'TOTAL', 'TOTAL'],
      ['431', 100, 999],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas[0].total_mes).toBe('100');
  });

  // Borde fmt_num (ronda de fix 1, hallazgo Important): celda NUMÉRICA real
  // (no string) escrita vía exceljs. pandas stringifica floats con ".0"
  // (str(431.0) → "431.0"), así que Python produciría fmt_num("431.0") →
  // "431.0" (fmt_num solo normaliza es-AR, no recorta el ".0"). Nuestro
  // `rawToStr` usa `String(431)` → "431" (sin ".0"), así que el TS produce
  // "431", no "431.0": es una divergencia CONSCIENTE frente a Python.
  // Adjudicación del controller: es inofensiva a nivel de datos porque
  // total_mes/cantidades/precio_unitario/ptos_gasnor son columnas DECIMAL en
  // MySQL — "431" y "431.0" castean al mismo valor numérico. No se cambia
  // la stringificación; este test deja la divergencia documentada y cubierta.
  it('fmt_num en celda numérica real: "431" (no "431.0" como pandas) — divergencia inocua por cast DECIMAL', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K13', [
      ['ÍTEMS', 'TOTAL'],
      ['431', 431.0],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas[0].total_mes).toBe('431');
  });

  // Caso 7a: contrato desde celda "8" → "K8".
  it('contrato: celda "8" se normaliza a "K8"', async () => {
    const buf = await crearLibroUnaHoja('CERTIF GENERAL', [
      ['ÍTEMS', 'K GASNOR'],
      ['431', '8'],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas[0].contrato).toBe('K8');
    expect(r.filas[0].tiene_error).toBe(false);
  });

  // Caso 7b: contrato vacío en la celda → fallback a meta.k_gasnor por nombre de hoja.
  it('contrato: celda vacía usa el k_gasnor de la meta (nombre de hoja "CERTIF K12 SUR")', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K12 SUR', [
      ['ÍTEMS', 'K GASNOR'],
      ['431', null],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas[0].contrato).toBe('K12');
    expect(r.filas[0].tiene_error).toBe(false);
  });

  // Caso 7c: sin celda ni meta → tiene_error true + mensaje.
  it('contrato: sin celda y sin meta → tiene_error true con "Contrato K no detectado."', async () => {
    const buf = await crearLibroUnaHoja('CERTIF GENERAL2', [
      ['ÍTEMS', 'K GASNOR'],
      ['431', null],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas[0].contrato).toBe('');
    expect(r.filas[0].tiene_error).toBe(true);
    expect(r.errores).toContainEqual({
      hoja: 'CERTIF GENERAL2',
      fila: 2,
      campo: 'contrato',
      mensaje: 'Contrato K no detectado.',
    });
  });

  // Caso 8: "Cantidad es 0." se anota pero NO marca tiene_error.
  it('cantidad 0 se anota en errores pero no marca tiene_error', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K5', [
      ['ÍTEMS', 'K GASNOR', 'CANTIDADES'],
      ['431', 'K5', 0],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas[0].tiene_error).toBe(false);
    expect(r.errores).toContainEqual({
      hoja: 'CERTIF K5',
      fila: 2,
      campo: 'cantidades',
      mensaje: 'Cantidad es 0.',
    });
  });

  // Caso 9a: libro con hoja CERTIF* y otra que no → solo se procesa la primera CERTIF*.
  it('hojas: si hay hojas CERTIF*, solo se procesan esas (se ignora "Resumen")', async () => {
    const buf = await crearLibro([
      { nombre: 'CERTIF K8', filas: [['ÍTEMS'], ['431']] },
      { nombre: 'Resumen', filas: [['ÍTEMS'], ['999']] },
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.hojas).toEqual(['CERTIF K8']);
    expect(r.filas.map((f) => f.item_codigo)).toEqual(['431']);
  });

  // Caso 9b: libro sin hojas CERTIF* → se procesan todas.
  it('hojas: si ninguna hoja empieza con CERTIF, se procesan todas', async () => {
    const buf = await crearLibro([
      { nombre: 'Datos1', filas: [['ÍTEMS'], ['431']] },
      { nombre: 'Datos2', filas: [['ÍTEMS'], ['432']] },
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.hojas).toEqual(['Datos1', 'Datos2']);
    expect(r.filas.map((f) => f.item_codigo)).toEqual(['431', '432']);
  });

  // Caso 10: meta NRO. DE NP.
  it('meta: extrae nro_np de la fila "NRO. DE NP"', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K9', [
      ['NRO. DE NP', '12345'],
      ['ÍTEMS'],
      ['431'],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas[0].nro_np).toBe('12345');
  });

  // Caso 11: provincia .title() y literales NAN/#N/A → null.
  it('provincia se titula ("salta"→"Salta"); literales NAN/#N/A se normalizan a null', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K10', [
      ['ÍTEMS', 'PROVINCIA', 'TAREA'],
      ['431', 'salta', 'NAN'],
      ['432', '#N/A', 'x'],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas[0].provincia).toBe('Salta');
    expect(r.filas[0].tarea).toBeNull();
    expect(r.filas[1].provincia).toBe('');
    expect(r.filas[1].tarea).toBe('x');
  });

  // Extras de paridad (Step 3 del brief): archivo ilegible y header ausente.
  it('archivo ilegible → error "No se pudo abrir el archivo: ..." sin lanzar excepción', async () => {
    const buf = Buffer.from('esto no es un xlsx');

    const r = await parsearExcel(buf, 'roto.xlsx', 2025, 2);

    expect(r.hojas).toEqual([]);
    expect(r.filas).toEqual([]);
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0].campo).toBe('archivo');
    expect(r.errores[0].mensaje).toMatch(/^No se pudo abrir el archivo: /);
  });

  it('hoja sin fila de encabezado (ÍTEMS) → error de header y sin filas', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K11', [
      ['CONTRATISTA', 'SER&TEC'],
      ['algo', 'mas'],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas).toEqual([]);
    expect(r.errores).toContainEqual({
      hoja: 'CERTIF K11',
      fila: 0,
      campo: 'header',
      mensaje: 'No se encontró la fila de encabezado (ÍTEMS).',
    });
  });

  it('periodo y fecha siempre vienen del período recibido, no del archivo', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K1', [['ÍTEMS'], ['431']]);

    const r = await parsearExcel(buf, 'test.xlsx', 2026, 9);

    expect(r.periodo).toBe('2026-09');
    expect(r.filas[0].fecha).toBe('2026-09-01');
  });
});
