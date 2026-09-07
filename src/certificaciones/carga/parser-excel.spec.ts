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
    ws.addRow(['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES']);
    ws.addRow([
      '289',
      'K5',
      'Salta',
      { formula: 'B1*0', result: 0 },
      100,
      { formula: 'B3*100', result: 0 },
    ]);
    ws.addRow([
      '290',
      'K5',
      'Salta',
      { formula: 'B1*0', result: 2 },
      100,
      { formula: 'B4*100', result: 200 },
    ]);
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
    // Fix crítico (ronda 1): celdas NUMÉRICAS reales no pasan por la regla
    // es-AR de texto — 59164.8 sigue siendo 59164.8, no "591648".
    expect(f.precio_unitario).toBe('59164.8');
    expect(f.total_mes).toBe('887472');
  });

  // Caso 2: números es-AR (total declarado, cantidades, total_mes).
  it('normaliza números es-AR: total declarado, cantidades y total_mes', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K6', [
      ['TOTAL MES', '$ 39.072.433,92'],
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', 'TOTAL'],
      ['431', 'K6', 'Salta', '3,5', '100', '1.234,56'],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.total_declarado).toBe(39072433.92);
    expect(r.filas[0].cantidades).toBe('3.5');
    expect(r.filas[0].total_mes).toBe('1234.56');
  });

  // Caso 2b (fix crítico ronda 1): celda NUMÉRICA real con fracción no se
  // corrompe al pasar por la regla es-AR de texto (el punto es decimal de
  // JS, no separador de miles). Antes del fix, 59164.8 → "591648" (10x).
  it('celda numérica con fracción conserva el valor real (no aplica la regla de texto)', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K9', [
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
      ['431', 'K9', 'Salta', 15, 59164.8, 2827089.4219859],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas[0].precio_unitario).toBe('59164.8');
    expect(r.filas[0].total_mes).toBe('2827089.4219859');
  });

  // Caso 2c (fix crítico ronda 1): celda de TEXTO en las mismas columnas sigue
  // la regla es-AR (punto = miles, coma = decimal).
  it('celda de TEXTO en $ TOTAL MES sigue la regla es-AR de miles/decimal', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K9', [
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
      ['431', 'K9', 'Salta', '3', '133.337,26', '400.012'],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas[0].precio_unitario).toBe('133337.26');
    expect(r.filas[0].total_mes).toBe('400012');
  });

  // Caso 2d (fix crítico ronda 1): TOTAL MES de cabecera (total_declarado)
  // respeta el mismo criterio de origen — numérico real vs texto es-AR.
  it('total_declarado: TOTAL MES numérico real vs TOTAL MES en texto es-AR', async () => {
    const bufNumerico = await crearLibroUnaHoja('CERTIF K9', [
      ['TOTAL MES', 22535209.93],
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
      ['431', 'K9', 'Salta', 1, 10, 10],
    ]);
    const rNumerico = await parsearExcel(bufNumerico, 'test.xlsx', 2025, 2);
    expect(rNumerico.total_declarado).toBe(22535209.93);

    const bufTexto = await crearLibroUnaHoja('CERTIF K9', [
      ['TOTAL MES', '22.535.210'],
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
      ['431', 'K9', 'Salta', 1, 10, 10],
    ]);
    const rTexto = await parsearExcel(bufTexto, 'test.xlsx', 2025, 2);
    expect(rTexto.total_declarado).toBe(22535210);
  });

  // Caso 3: fmt_item — float de celda, texto con coma, texto alfanumérico, celda vacía descartada.
  it('fmt_item: numérico entero, decimal con coma, texto tal cual; vacío se descarta', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K1', [
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
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
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
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
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
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
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', 'TOTAL', 'TOTAL'],
      ['431', 'K4', 'Salta', 5, 50, 100, 999],
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
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', 'TOTAL'],
      ['431', 'K13', 'Salta', 1, 10, 431.0],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas[0].total_mes).toBe('431');
  });

  // Caso 7a: contrato desde celda "8" → "K8".
  it('contrato: celda "8" se normaliza a "K8"', async () => {
    const buf = await crearLibroUnaHoja('CERTIF GENERAL', [
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
      ['431', '8', 'Salta', 1, 10, 10],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas[0].contrato).toBe('K8');
    expect(r.filas[0].tiene_error).toBe(false);
  });

  // Caso 7b: contrato vacío en la celda → fallback a meta.k_gasnor por nombre de hoja.
  it('contrato: celda vacía usa el k_gasnor de la meta (nombre de hoja "CERTIF K12 SUR")', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K12 SUR', [
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
      ['431', null, 'Salta', 1, 10, 10],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas[0].contrato).toBe('K12');
    expect(r.filas[0].tiene_error).toBe(false);
  });

  // Caso 7c: sin celda ni meta → tiene_error true + mensaje.
  it('contrato: sin celda y sin meta → tiene_error true con "Contrato K no detectado."', async () => {
    const buf = await crearLibroUnaHoja('CERTIF GENERAL2', [
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
      ['431', null, 'Salta', 1, 10, 10],
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
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
      ['431', 'K5', 'Salta', 0, 10, 10],
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
      {
        nombre: 'CERTIF K8',
        filas: [
          ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
          ['431', 'K8', 'Salta', 1, 10, 10],
        ],
      },
      { nombre: 'Resumen', filas: [['ÍTEMS'], ['999']] },
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.hojas).toEqual(['CERTIF K8']);
    expect(r.filas.map((f) => f.item_codigo)).toEqual(['431']);
  });

  // Caso 9b: libro sin hojas CERTIF* → se procesan todas.
  it('hojas: si ninguna hoja empieza con CERTIF, se procesan todas', async () => {
    const buf = await crearLibro([
      {
        nombre: 'Datos1',
        filas: [
          ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
          ['431', 'K1', 'Salta', 1, 10, 10],
        ],
      },
      {
        nombre: 'Datos2',
        filas: [
          ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
          ['432', 'K1', 'Salta', 1, 10, 10],
        ],
      },
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.hojas).toEqual(['Datos1', 'Datos2']);
    expect(r.filas.map((f) => f.item_codigo)).toEqual(['431', '432']);
  });

  // Caso 10: meta NRO. DE NP.
  it('meta: extrae nro_np de la fila "NRO. DE NP"', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K9', [
      ['NRO. DE NP', '12345'],
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
      ['431', 'K9', 'Salta', 1, 10, 10],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas[0].nro_np).toBe('12345');
  });

  // Caso 11: provincia .title() y literales NAN/#N/A → null.
  it('provincia se titula ("salta"→"Salta"); literales NAN/#N/A se normalizan a null', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K10', [
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'TAREA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
      ['431', 'K10', 'salta', 'NAN', 1, 10, 10],
      ['432', 'K10', '#N/A', 'x', 1, 10, 10],
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
    const buf = await crearLibroUnaHoja('CERTIF K1', [
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
      ['431', 'K1', 'Salta', 1, 10, 10],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2026, 9);

    expect(r.periodo).toBe('2026-09');
    expect(r.filas[0].fecha).toBe('2026-09-01');
  });
});

describe('parsearExcel: columnas requeridas e ignoradas', () => {
  it('lista CUENTA como ignorada y no la confunde con cantidades', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('CERTIFICO K8');
    ws.addRow(['NRO. WK', '362000594']);
    ws.addRow(['PERIODO A CERTIFICAR', '1/8/2026', '31/8/2026']);
    ws.addRow(['ÍTEMS', 'TAREA', 'K GASNOR', 'PROVINCIA', 'CUENTA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES']);
    ws.addRow([436, 'Instalación', 'K8', 'Salta', 922, 16, 240007.08, 3840113.28]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parsearExcel(buf, 'CERTIFICADOS SERTEC (K8) -agosto 26.xlsx', 2026, 8);
    expect(r.columnas_ignoradas).toEqual(['CUENTA']);
    expect(r.filas[0].cantidades).toBe('16');
    expect(r.filas[0].nro_np).toBe('362000594');
    expect(r.periodo_archivo).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' });
    expect(r.k_nombre_archivo).toBe('K8');
    expect(r.avisos.some((a) => a.tipo === 'columna_ignorada')).toBe(true);
  });

  it('sin columna de total: error de header con faltantes, sin filas', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('CERTIFICO K8');
    ws.addRow(['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES']);
    ws.addRow([436, 'K8', 'Salta', 16, 240007.08]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parsearExcel(buf, 'x.xlsx', 2026, 8);
    expect(r.filas).toEqual([]);
    expect(r.errores[0].campo).toBe('header');
    expect(r.errores[0].mensaje).toContain('total_mes');
  });

  it('celda de TEXTO con monto es-AR: "400.012" → 400012', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('CERTIFICO K8');
    ws.addRow(['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES']);
    ws.addRow([442, 'K8', 'Salta', '3', '133.337,26', '400.012']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parsearExcel(buf, 'x.xlsx', 2026, 8);
    expect(r.filas[0].total_mes).toBe('400012');
    expect(r.filas[0].precio_unitario).toBe('133337.26');
  });

  it('sin total declarado (null o 0): aviso fuerte sin_total_declarado', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K1', [
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
      ['431', 'K1', 'Salta', 1, 10, 10],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.total_declarado).toBeNull();
    const aviso = r.avisos.find((a) => a.tipo === 'sin_total_declarado');
    expect(aviso).toBeDefined();
    expect(aviso?.fuerte).toBe(true);
    expect(aviso?.fila).toBe(0);
    expect(aviso?.mensaje).toBe(
      'El archivo no declara un total mes legible: la carga no se pudo controlar contra el total declarado.',
    );
  });

  // Paridad con el parser PDF: el aviso np_no_detectado faltaba en el Excel.
  it('sin fila de NP/WK: aviso débil np_no_detectado', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K1', [
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
      ['431', 'K1', 'Salta', 1, 10, 10],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas[0].nro_np).toBeNull();
    const aviso = r.avisos.find((a) => a.tipo === 'np_no_detectado');
    expect(aviso).toBeDefined();
    expect(aviso?.fuerte).toBe(false);
    expect(aviso?.fila).toBe(0);
    expect(aviso?.hoja).toBe('test.xlsx');
    expect(aviso?.mensaje).toBe('No se detectó el número de NP/WK en la cabecera.');
  });

  it('con "NRO. WK 362000594" en la cabecera: sin aviso np_no_detectado', async () => {
    const buf = await crearLibroUnaHoja('CERTIF K1', [
      ['NRO. WK', '362000594'],
      ['ÍTEMS', 'K GASNOR', 'PROVINCIA', 'CANTIDADES', '$ UNITARIO MES', '$ TOTAL MES'],
      ['431', 'K1', 'Salta', 1, 10, 10],
    ]);

    const r = await parsearExcel(buf, 'test.xlsx', 2025, 2);

    expect(r.filas[0].nro_np).toBe('362000594');
    expect(r.avisos.some((a) => a.tipo === 'np_no_detectado')).toBe(false);
  });
});
