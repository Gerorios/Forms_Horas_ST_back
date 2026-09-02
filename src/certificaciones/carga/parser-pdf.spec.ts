/**
 * parser-pdf.spec.ts — tests del algoritmo puro (palabras posicionadas
 * sintéticas, sin PDF real) + 1 test de integración del wrapper pdfjs-dist
 * generando un PDF simple con pdf-lib.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  PalabraPosicionada,
  agruparPorLinea,
  construirColMap,
  dividirEnPalabras,
  esItemValido,
  extraerMeta,
  limpiarNum,
  normalizarProvincia,
  obtenerNumGrupo,
  obtenerTextoGrupo,
  parsearPdf,
  pegarPalabras,
  procesarFila,
  procesarPagina,
} from './parser-pdf';

function w(text: string, x0: number, top: number, width = text.length * 5): PalabraPosicionada {
  return { text, x0, top, width };
}

describe('esItemValido (PDF, más estricto que Excel)', () => {
  it('acepta código con letra opcional + 3+ dígitos', () => {
    expect(esItemValido('A123')).toBe(true);
    expect(esItemValido('123')).toBe(true);
    expect(esItemValido('B4567')).toBe(true);
  });

  it('rechaza menos de 3 dígitos, headers y footer-like', () => {
    expect(esItemValido('12')).toBe(false);
    expect(esItemValido('AB123')).toBe(false);
    expect(esItemValido('ÍTEMS')).toBe(false);
    expect(esItemValido('ITEMS')).toBe(false);
    expect(esItemValido('TOTAL:')).toBe(false);
    expect(esItemValido('')).toBe(false);
    expect(esItemValido(null)).toBe(false);
  });
});

describe('limpiarNum', () => {
  it('toma el primer bloque numérico, ignora resto de la string', () => {
    expect(limpiarNum('$ 1.234,56 extra')).toBe('1234.56');
  });

  it('coma sola = decimal; punto+coma = miles+decimal es-AR', () => {
    expect(limpiarNum('1234,5')).toBe('1234.5');
    expect(limpiarNum('9.338,22')).toBe('9338.22');
  });

  it('null si no hay bloque numérico al inicio', () => {
    expect(limpiarNum('abc')).toBeNull();
    expect(limpiarNum('')).toBeNull();
    expect(limpiarNum(null)).toBeNull();
  });

  it('strip(".,") de bordes tras extraer el bloque', () => {
    expect(limpiarNum('...')).toBeNull(); // queda vacío tras el strip -> no parsea
  });
});

describe('pegarPalabras (gap<8 pega dígitos partidos)', () => {
  it('pega "9" + ".338,22" -> "9.338,22" cuando el gap es chico', () => {
    const ws = [w('9', 10, 0, 4), w('.338,22', 13, 0, 30)]; // gap = 13-(10+4) = -1
    expect(pegarPalabras(ws)).toBe('9.338,22');
  });

  it('pega "8" + "3.006,40" -> "83.006,40"', () => {
    const ws = [w('8', 10, 0, 4), w('3.006,40', 13, 0, 40)];
    expect(pegarPalabras(ws)).toBe('83.006,40');
  });

  it('NO pega si el gap es grande', () => {
    const ws = [w('9', 10, 0, 4), w('.338,22', 40, 0, 30)]; // gap = 40-14 = 26
    expect(pegarPalabras(ws)).toBe('9 .338,22');
  });

  it('NO pega si el anterior no es solo dígitos', () => {
    const ws = [w('K9', 10, 0, 8), w('.338,22', 13, 0, 30)];
    expect(pegarPalabras(ws)).toBe('K9 .338,22');
  });
});

describe('construirColMap (límites = punto medio entre x0 consecutivos + 5)', () => {
  it('calcula xIni/xFin correctamente para 3 columnas', () => {
    const header = [w('ÍTEMS', 0, 0), w('TAREA', 50, 0), w('CANTIDADES', 150, 0)];
    const colMap = construirColMap(header);
    expect(colMap.get('item_codigo')).toEqual([0, (0 + 50) / 2 + 5]);
    expect(colMap.get('tarea')).toEqual([(0 + 50) / 2 + 5, (50 + 150) / 2 + 5]);
    expect(colMap.get('cantidades')).toEqual([(50 + 150) / 2 + 5, 99999]);
  });

  it('ignora palabras que no están en HEADER_PALABRAS y no duplica campo repetido', () => {
    const header = [w('ÍTEMS', 0, 0), w('RUIDO', 20, 0), w('ITEMS', 25, 0), w('TAREA', 50, 0)];
    const colMap = construirColMap(header);
    expect(colMap.size).toBe(2); // item_codigo (primera ocurrencia) + tarea
    expect(colMap.get('item_codigo')![0]).toBe(0);
  });
});

describe('agruparPorLinea (round(top/4)*4)', () => {
  it('agrupa tops cercanos en la misma línea cuantizada', () => {
    const lineas = agruparPorLinea([w('a', 0, 98), w('b', 10, 100), w('c', 0, 102)]);
    // 98/4=24.5->25*4=100 ; 100/4=25->25*4=100 ; 102/4=25.5->26*4=104
    expect(Array.from(lineas.keys()).sort((x: number, y: number) => x - y)).toEqual([100, 104]);
    expect(lineas.get(100)!.map((x) => x.text)).toEqual(['a', 'b']);
    expect(lineas.get(104)!.map((x) => x.text)).toEqual(['c']);
  });
});

describe('extraerMeta', () => {
  it('detecta k_gasnor por \\bK(\\d+)\\b', () => {
    const meta = extraerMeta([w('CONTRATO', 0, 0), w('K12', 50, 0), w('NORTE', 100, 0)]);
    expect(meta.k_gasnor).toBe('K12');
  });

  it('total_declarado con monto partido en varias palabras', () => {
    const words = [
      w('TOTAL', 0, 0),
      w('MES', 30, 0),
      w('$', 60, 0),
      w('3', 70, 0),
      w('9.072.433,92', 80, 0),
    ];
    const meta = extraerMeta(words);
    expect(meta.total_declarado).toBe(39072433.92);
  });

  it('nro_np siempre null (el Python original no lo completa en PDF)', () => {
    const meta = extraerMeta([w('NRO', 0, 0), w('DE', 20, 0), w('NP', 40, 0), w('55', 60, 0)]);
    expect(meta.nro_np).toBeNull();
  });
});

describe('normalizarProvincia', () => {
  it('matchea por substring sin tildes contra el dict cerrado', () => {
    expect(normalizarProvincia('tucuman')).toBe('Tucumán');
    expect(normalizarProvincia('TUCUMÁN')).toBe('Tucumán');
    expect(normalizarProvincia('salta')).toBe('Salta');
    expect(normalizarProvincia('Santiago del Estero')).toBe('Santiago del Estero');
  });

  it('fallback .title() si no matchea el dict', () => {
    expect(normalizarProvincia('CORDOBA')).toBe('Cordoba');
  });

  it('vacía -> ""', () => {
    expect(normalizarProvincia('')).toBe('');
  });
});

describe('obtenerTextoGrupo (multilínea: "juntar" concatena, "primero" toma la 1ª)', () => {
  const colMap = construirColMap([w('TAREA', 0, 0), w('CANTIDADES', 100, 0)]);

  it('modo "juntar" concatena texto de varias líneas', () => {
    const grupo = [[w('Reparar', 0, 0)], [w('caño', 0, 4)], [w('roto', 0, 8)]];
    expect(obtenerTextoGrupo(grupo, colMap, 'tarea', 'juntar')).toBe('Reparar caño roto');
  });

  it('modo "primero" toma solo la primera línea con valor', () => {
    const grupo = [[w('10', 100, 0)], [w('99', 100, 4)]];
    expect(obtenerTextoGrupo(grupo, colMap, 'cantidades', 'primero')).toBe('10');
  });
});

describe('obtenerNumGrupo', () => {
  it('toma el primer numérico válido entre las líneas del grupo', () => {
    const colMap = construirColMap([w('CANTIDADES', 0, 0)]);
    const grupo = [[w('texto', 0, 0)], [w('10,5', 0, 4)]];
    expect(obtenerNumGrupo(grupo, colMap, 'cantidades')).toBe('10.5');
  });
});

describe('procesarFila', () => {
  const colMap = construirColMap([
    w('ÍTEMS', 0, 0),
    w('CONTRATISTA', 100, 0),
    w('PROVINCIA', 200, 0),
    w('K', 300, 0),
  ]);
  const meta = { k_gasnor: null, nro_np: null, total_declarado: null };

  it('limpia la provincia pegada al contratista', () => {
    const grupo = [
      [w('A123', 0, 0), w('Constructora', 100, 0), w('Tucuman', 200, 0), w('K12', 300, 0)],
    ];
    const { fila, errores } = procesarFila(grupo, colMap, 'archivo.pdf', 1, 2026, 8, meta);
    expect(fila.provincia).toBe('Tucumán');
    expect(fila.contratista).toBe('Constructora');
    expect(fila.contrato).toBe('K12');
    expect(fila.item_codigo).toBe('A123'); // sin fmt_item, crudo
    expect(fila.tiene_error).toBe(false);
    expect(errores).toEqual([]);
  });

  it('provincia vacía SÍ marca tiene_error (a diferencia de Excel)', () => {
    const grupo = [[w('A123', 0, 0), w('Constructora', 100, 0), w('K12', 300, 0)]];
    const { fila, errores } = procesarFila(grupo, colMap, 'archivo.pdf', 2, 2026, 8, meta);
    expect(fila.provincia).toBe('');
    expect(fila.tiene_error).toBe(true);
    expect(errores).toContainEqual({
      hoja: 'archivo.pdf',
      fila: 2,
      campo: 'provincia',
      mensaje: 'Provincia vacía.',
    });
  });

  it('contrato ausente cae al k_gasnor de la meta', () => {
    const metaConK = { k_gasnor: 'K9', nro_np: null, total_declarado: null };
    const grupo = [[w('A123', 0, 0), w('Constructora', 100, 0), w('Salta', 200, 0)]];
    const { fila } = procesarFila(grupo, colMap, 'archivo.pdf', 3, 2026, 8, metaConK);
    expect(fila.contrato).toBe('K9');
  });
});

describe('procesarPagina (fila multilínea, footer corta la página)', () => {
  const header = [
    w('ÍTEMS', 0, 0),
    w('TAREA', 60, 0),
    w('CONTRATISTA', 150, 0),
    w('PROVINCIA', 250, 0),
    w('K', 350, 0),
    w('CANTIDADES', 400, 0),
  ];

  function linea(words: PalabraPosicionada[], top: number): PalabraPosicionada[] {
    return words.map((x) => ({ ...x, top }));
  }

  it('fila multilínea: "juntar" para tarea, "primero" para cantidades', () => {
    const words = [
      ...linea(header, 0),
      ...linea(
        [w('A123', 0, 0), w('Reparar', 60, 0), w('Constructora', 150, 0), w('Salta', 250, 0), w('K1', 350, 0), w('5', 400, 0)],
        10,
      ),
      ...linea([w('caño roto', 60, 0)], 14), // continuación de tarea, sin ítem
    ];
    const resultado = procesarPagina(words, 'archivo.pdf', 2026, 8);
    expect(resultado.filas).toHaveLength(1);
    const fila = resultado.filas[0];
    expect(fila.tarea).toBe('Reparar caño roto');
    expect(fila.cantidades).toBe('5');
  });

  it('footer (FIRMA) corta la página: filas después no se procesan', () => {
    const words = [
      ...linea(header, 0),
      ...linea(
        [w('A123', 0, 0), w('Reparar', 60, 0), w('Constructora', 150, 0), w('Salta', 250, 0), w('K1', 350, 0), w('5', 400, 0)],
        10,
      ),
      ...linea([w('FIRMA', 0, 0)], 20),
      ...linea(
        [w('B999', 0, 0), w('Otra', 60, 0), w('Otra SA', 150, 0), w('Jujuy', 250, 0), w('K2', 350, 0), w('7', 400, 0)],
        30,
      ),
    ];
    const resultado = procesarPagina(words, 'archivo.pdf', 2026, 8);
    expect(resultado.filas).toHaveLength(1);
    expect(resultado.filas[0].item_codigo).toBe('A123');
  });

  it('sin header ÍTEMS no procesa filas (pero igual intenta meta)', () => {
    const resultado = procesarPagina([w('RUIDO', 0, 0)], 'archivo.pdf', 2026, 8);
    expect(resultado.filas).toEqual([]);
  });
});

describe('dividirEnPalabras (aproximación de palabras dentro de un item de pdfjs)', () => {
  it('un solo token conserva x0/width tal cual', () => {
    expect(dividirEnPalabras('HOLA', 10, 5, 40)).toEqual([{ text: 'HOLA', x0: 10, top: 5, width: 40 }]);
  });

  it('reparte proporcionalmente por caracteres cuando hay varios tokens', () => {
    const palabras = dividirEnPalabras('AB CD', 0, 0, 10); // "AB CD" = 5 chars, width 10 -> 2/char
    expect(palabras).toHaveLength(2);
    expect(palabras[0]).toEqual({ text: 'AB', x0: 0, top: 0, width: 4 });
    expect(palabras[1].text).toBe('CD');
    expect(palabras[1].x0).toBeCloseTo(6);
    expect(palabras[1].width).toBeCloseTo(4);
  });

  it('string vacía o solo espacios -> []', () => {
    expect(dividirEnPalabras('', 0, 0, 0)).toEqual([]);
    expect(dividirEnPalabras('   ', 0, 0, 10)).toEqual([]);
  });
});

describe('parsearPdf (integración con pdfjs-dist real, PDF generado con pdf-lib)', () => {
  async function generarPdfSimple(): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 400]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const alto = 400;

    // Header: coordenadas Y de pdf-lib (crecen hacia arriba), y=350 => top pdfplumber ~ 400-350=50
    const draw = (text: string, x: number, y: number) => page.drawText(text, { x, y, size: 10, font });

    draw('ÍTEMS', 30, 350);
    draw('TAREA', 100, 350);
    draw('CONTRATISTA', 250, 350);
    draw('PROVINCIA', 380, 350);
    draw('K', 480, 350);
    draw('CANTIDADES', 520, 350);

    // Fila de datos
    draw('A100', 30, 330);
    draw('Reparar', 100, 330);
    draw('Constructora', 250, 330);
    draw('Salta', 380, 330);
    draw('K12', 480, 330);
    draw('5', 520, 330);

    void alto;
    return Buffer.from(await doc.save());
  }

  // pdfjs-dist >= 4 es ESM-only y el wrapper usa `import()` NATIVO (ver
  // comentario en parser-pdf.ts) para poder cargarlo desde este repo en
  // CommonJS. Ese `import()` nativo, al correr DENTRO del sandbox
  // vm.Context que arma Jest para cada test file, tira
  // `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` salvo que el PROCESO DE
  // NODE que levanta Jest tenga el flag `--experimental-vm-modules`. Eso no
  // depende de una env var (`NODE_OPTIONS=...` no es portable a
  // cmd/PowerShell) sino de cómo se invoca el binario de Jest: pasando el
  // flag como argumento posicional a `node` SÍ es portable —
  // `node --experimental-vm-modules node_modules/jest/bin/jest.js ...`
  // funciona igual en bash, cmd y PowerShell — de ahí el script
  // `test:pdf-integration` del package.json.
  //
  // Detectamos esa capacidad en runtime con `process.execArgv` (los flags
  // con los que arrancó el proceso de Node actual) para que el test corra
  // quede como skip LEGÍTIMO bajo `npx jest`/`npm test` normal (no soporta
  // el import nativo) y en VERDE bajo `npm run test:pdf-integration` (si
  // soporta) — no un skip "porque sí".
  const puedeVm = process.execArgv.some((a) => a.includes('experimental-vm-modules'));

  (puedeVm ? it : it.skip)('procesa un PDF real de punta a punta (header por x0, 1 fila válida) [requiere --experimental-vm-modules; correr con `npm run test:pdf-integration`]', async () => {
    const buf = await generarPdfSimple();
    const resultado = await parsearPdf(buf, 'certificacion.pdf', 2026, 8);

    expect(resultado.hojas).toEqual(['certificacion.pdf']);
    expect(resultado.archivo).toBe('certificacion.pdf');
    expect(resultado.periodo).toBe('2026-08');
    expect(resultado.filas).toHaveLength(1);

    const fila = resultado.filas[0];
    expect(fila.item_codigo).toBe('A100');
    expect(fila.contrato).toBe('K12');
    expect(fila.provincia).toBe('Salta');
    expect(fila.contratista).toBe('Constructora');
    expect(fila.tiene_error).toBe(false);
    expect(fila.fecha).toBe('2026-08-01');
    expect(fila.nombre_contrato).toBeNull();
    expect(fila.region).toBe('');
  });

  it('PDF corrupto produce un error de "archivo", no una excepción', async () => {
    const resultado = await parsearPdf(Buffer.from('no es un pdf'), 'roto.pdf', 2026, 8);
    expect(resultado.filas).toEqual([]);
    expect(resultado.errores.length).toBeGreaterThan(0);
    expect(resultado.errores[0].campo).toBe('archivo');
  });
});
