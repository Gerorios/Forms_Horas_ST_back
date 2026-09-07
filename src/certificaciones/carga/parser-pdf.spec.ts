/**
 * parser-pdf.spec.ts — tests del algoritmo puro (palabras posicionadas
 * sintéticas, sin PDF real) + 1 test de integración del wrapper pdfjs-dist
 * generando un PDF simple con pdf-lib.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  COLUMNAS_REQUERIDAS,
  PalabraPosicionada,
  agruparPorLinea,
  construirCabecera,
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

/**
 * Simula lo que produce `dividirEnPalabras` con UN item de pdfjs: reparte el
 * ancho por caracteres y marca todas las palabras con el mismo `itemId`
 * (o sea: son partes de una misma frase, como "NOMBRE CONTRATO").
 */
function frase(texto: string, x0: number, top: number, itemId: number): PalabraPosicionada[] {
  const tokens = texto.split(' ');
  const width = texto.length * 5;
  let cursor = 0;
  return tokens.map((t) => {
    const palabra: PalabraPosicionada = {
      text: t,
      x0: x0 + (width * cursor) / texto.length,
      top,
      width: (width * t.length) / texto.length,
      itemId,
    };
    cursor += t.length + 1;
    return palabra;
  });
}

/**
 * Cabecera real de una certificación Naturgy de agosto 2026 (K11): Naturgy
 * agregó la columna "CUENTA" entre PROVINCIA y Cantidades. Compartida por
 * los describes de `construirCabecera` y de `procesarPagina`.
 */
const HEADER_NATURGY: PalabraPosicionada[] = [
  ...frase('ÍTEMS', 58, 245, 0),
  ...frase('NOMBRE CONTRATO', 87, 245, 1),
  ...frase('TAREA', 195, 245, 2),
  ...frase('K GASNOR', 281, 245, 3),
  ...frase('UM', 324, 245, 4),
  ...frase('PTOS. GASNOR', 349, 245, 5),
  ...frase('TIPO', 383, 245, 6),
  ...frase('CONTRATISTA', 425, 245, 7),
  ...frase('PROVINCIA', 466, 245, 8),
  ...frase('CUENTA', 505, 245, 9),
  ...frase('Cantidades', 537, 245, 10),
  ...frase('$ Unitario mes', 574, 245, 11),
  ...frase('$ Total mes', 622, 245, 12),
  ...frase('Observaciones', 681, 245, 13),
];

describe('esItemValido (1+ dígitos, letra opcional, sufijo opcional)', () => {
  it.each([
    ['5', true],
    ['132', true],
    ['116-a', true],
    ['A12', true],
    ['ÍTEMS', false],
    ['', false],
    ['Firma', false],
    ['12 servicios', false],
  ])('%s -> %s', (s, esperado) => {
    expect(esItemValido(s)).toBe(esperado);
  });

  it('rechaza dos letras iniciales, headers y footer-like', () => {
    // Actualizado: la regla vieja exigía 3+ dígitos ("12" se rechazaba); la
    // nueva acepta 1+ dígitos, así que "12" ahora ES válido. Lo que sigue
    // rechazado: dos letras al inicio, headers y texto sin dígitos.
    expect(esItemValido('12')).toBe(true);
    expect(esItemValido('AB123')).toBe(false);
    expect(esItemValido('ITEMS')).toBe(false);
    expect(esItemValido('TOTAL:')).toBe(false);
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

  it('no duplica campo repetido y la palabra desconocida queda como columna ignorada', () => {
    const header = [w('ÍTEMS', 0, 0), w('RUIDO', 20, 0), w('ITEMS', 25, 0), w('TAREA', 50, 0)];
    const colMap = construirColMap(header);
    // item_codigo (primera ocurrencia) + tarea + la desconocida con rango propio
    expect(colMap.size).toBe(3);
    expect(colMap.get('item_codigo')![0]).toBe(0);
    expect(colMap.has('__ignorada_0')).toBe(true);
  });
});

describe('construirCabecera (frases por itemId, requeridas e ignoradas)', () => {
  it('reconoce todas las requeridas y lista CUENTA como ignorada', () => {
    const c = construirCabecera(HEADER_NATURGY);
    expect(c.faltantes).toEqual([]);
    expect(c.ignoradas).toEqual(['CUENTA']);
    for (const req of COLUMNAS_REQUERIDAS) expect(c.colMap.has(req)).toBe(true);
  });

  it('la columna ignorada ocupa su propio rango: 922 en x=509 NO cae en cantidades', () => {
    const c = construirCabecera(HEADER_NATURGY);
    const [cantIni] = c.colMap.get('cantidades')!;
    expect(509).toBeLessThan(cantIni);
    const [ignIni, ignFin] = c.colMap.get('__ignorada_0')!;
    expect(509).toBeGreaterThanOrEqual(ignIni);
    expect(509).toBeLessThan(ignFin);
  });

  it('sin itemId (palabras sueltas estilo pdfplumber) sigue mapeando por primera palabra', () => {
    const suelto = [
      w('ÍTEMS', 58, 10),
      w('TAREA', 195, 10),
      w('K', 281, 10),
      w('PROVINCIA', 466, 10),
      w('Cantidades', 537, 10),
      w('Unitario', 574, 10),
      w('Total', 622, 10),
    ];
    const c = construirCabecera(suelto);
    expect(c.faltantes).toEqual([]);
    expect(c.ignoradas).toEqual([]);
  });

  /** Header mínimo por frases (con itemId) que trae todas las requeridas. */
  function headerMinimo(): PalabraPosicionada[] {
    return [
      ...frase('ÍTEMS', 58, 245, 0),
      ...frase('K GASNOR', 281, 245, 1),
      ...frase('PROVINCIA', 466, 245, 2),
      ...frase('Cantidades', 500, 245, 3),
      ...frase('$ Unitario mes', 530, 245, 4),
      ...frase('$ Total mes', 622, 245, 5),
    ];
  }

  it('un título desconocido de varias palabras NO secuestra el campo por su primera palabra', () => {
    // "Total acumulado" está a la IZQUIERDA del "$ Total mes" real: con
    // fallback por primera palabra se quedaría con total_mes (gana el primer
    // x0) y el total del mes verdadero se descartaría como duplicado.
    const c = construirCabecera([...headerMinimo(), ...frase('Total acumulado', 560, 245, 9)]);
    expect(c.ignoradas).toEqual(['TOTAL ACUMULADO']);
    expect(c.faltantes).toEqual([]);
    const [totalIni] = c.colMap.get('total_mes')!;
    expect(totalIni).toBe((560 + 622) / 2 + 5); // límite derivado del 622 real
  });

  it('con itemId, un item suelto "MES" es columna ignorada; sin itemId sigue siendo continuación', () => {
    const conItemId = construirCabecera([...headerMinimo(), ...frase('MES', 350, 245, 9)]);
    expect(conItemId.ignoradas).toEqual(['MES']);
    expect(conItemId.faltantes).toEqual([]);

    const sinItemId = construirCabecera([
      w('ÍTEMS', 58, 10),
      w('K', 281, 10),
      w('GASNOR', 300, 10),
      w('PROVINCIA', 466, 10),
      w('Cantidades', 537, 10),
      w('Unitario', 574, 10),
      w('Total', 622, 10),
    ]);
    expect(sinItemId.ignoradas).toEqual([]);
    expect(sinItemId.faltantes).toEqual([]);
  });

  it('reporta faltantes si no hay columna de total', () => {
    const c = construirCabecera([
      w('ÍTEMS', 58, 10),
      w('K', 281, 10),
      w('PROVINCIA', 466, 10),
      w('Cantidades', 537, 10),
      w('Unitario', 574, 10),
    ]);
    expect(c.faltantes).toEqual(['total_mes']);
  });
});

describe('procesarPagina con columna ignorada (caso real K11 agosto 2026)', () => {
  it('cantidad = 221 (no 922) y la página registra la columna ignorada', () => {
    const fila = [
      ...frase('132', 60, 256, 20),
      ...frase('INSPECCIÓN ADECUACIÓN', 135, 256, 21),
      ...frase('K2', 288, 256, 22),
      ...frase('N°', 325, 256, 23),
      ...frase('52,76', 358, 256, 24),
      ...frase('CAPEX', 396, 256, 25),
      ...frase('SER&TEC', 419, 256, 26),
      ...frase('Tucumán', 467, 256, 27),
      ...frase('922', 509, 256, 28),
      ...frase('221', 555, 256, 29),
      ...frase('$', 565, 256, 30),
      ...frase('66.989,90', 586, 256, 31),
      ...frase('$', 610, 256, 32),
      ...frase('14.804.768', 633, 256, 33),
      ...frase('PR, CS, RE Aprobada', 657, 256, 34),
    ];
    const r = procesarPagina([...HEADER_NATURGY, ...fila], 'k11.pdf', 2026, 8);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].cantidades).toBe('221');
    expect(r.filas[0].precio_unitario).toBe('66989.90');
    expect(r.filas[0].total_mes).toBe('14804768');
    expect(r.columnasIgnoradas).toEqual(['CUENTA']);
  });

  it('sin columna requerida: no procesa filas y emite error de header con las faltantes', () => {
    const header = [
      w('ÍTEMS', 58, 10),
      w('K', 281, 10),
      w('PROVINCIA', 466, 10),
      w('Cantidades', 537, 10),
      w('Unitario', 574, 10),
    ];
    const r = procesarPagina([...header, w('436', 56, 30), w('16', 542, 30)], 'x.pdf', 2026, 8);
    expect(r.filas).toEqual([]);
    expect(r.errores[0].campo).toBe('header');
    expect(r.errores[0].mensaje).toContain('total_mes');
  });
});

describe('procesarPagina: fila real partida en dos líneas (Task 8 fix, K8 Capex agosto 2026)', () => {
  it('ítem 437 con código+ptos+provincia en una línea y cantidad/unitario/total en la siguiente -> 2 filas', () => {
    // Reproduce el caso real (ítem 436 y 437, sección Jujuy) que fusionaba
    // silenciosamente la fila 437 dentro del grupo de la fila 436: la línea
    // B trae el código y algún dato posicional (ptos_gasnor, provincia)
    // pero SIN plata; la plata real de esa misma fila recién aparece en la
    // línea C (que no arranca con código).
    const filaA = [
      ...frase('436', 60, 300, 20),
      ...frase('MANTENIMIENTO DE LA RED', 90, 300, 21),
      ...frase('Instalación de servicio SIN MATERIALES', 200, 300, 22),
      ...frase('k8', 285, 300, 23),
      ...frase('un', 328, 300, 24),
      ...frase('212,42', 353, 300, 25),
      ...frase('CAPEX', 387, 300, 26),
      ...frase('SER&TEC', 429, 300, 27),
      ...frase('Jujuy', 470, 300, 28),
      ...frase('1', 541, 300, 29),
      ...frase('240.007,08', 578, 300, 30),
      ...frase('240.007,08', 626, 300, 31),
    ];
    // Línea B: código "437" (columna ítem) + "150,20" bajo PTOS. GASNOR +
    // "Jujuy" bajo PROVINCIA. Sin cantidad ni total en esta línea.
    const filaB = [
      ...frase('437', 60, 310, 32),
      ...frase('150,20', 353, 310, 33),
      ...frase('Jujuy', 470, 310, 34),
    ];
    // Línea C: sin código, trae la plata real de la fila 437.
    const filaC = [
      ...frase('MANTENIMIENTO DE LA RED', 90, 320, 35),
      ...frase('Instalación de servicio SIN MATERIALES', 200, 320, 36),
      ...frase('un', 328, 320, 37),
      ...frase('CAPEX', 387, 320, 38),
      ...frase('24', 541, 320, 39),
      ...frase('169.701,97', 578, 320, 40),
      ...frase('4.072.847', 626, 320, 41),
    ];
    const r = procesarPagina(
      [...HEADER_NATURGY, ...filaA, ...filaB, ...filaC],
      'k8-capex.pdf',
      2026,
      8,
    );
    expect(r.filas).toHaveLength(2);
    expect(r.filas[0].item_codigo).toBe('436');
    expect(r.filas[1].item_codigo).toBe('437');
    expect(r.filas[1].cantidades).toBe('24');
    expect(r.filas[1].total_mes).toBe('4072847');
    expect(r.filas[1].provincia).toBe('Jujuy');
  });
});

describe('procesarPagina: fila de ítem corto y línea sin plata', () => {
  const header = [
    w('ÍTEMS', 54, 134),
    w('TAREA', 214, 134),
    w('K', 357, 134),
    w('PROVINCIA', 489, 134),
    w('Cantidades', 521, 134),
    w('Unitario', 557, 134),
    w('Total', 595, 134),
  ];

  it('el ítem "5" con cantidad y total ES una fila', () => {
    const fila = [
      w('5', 57, 157),
      w('Adicional largos', 108, 157),
      w('k8', 363, 157),
      w('Salta', 484, 157),
      w('4', 544, 157),
      w('15.151,96', 568, 157),
      w('60.608', 606, 157),
    ];
    const r = procesarPagina([...header, ...fila], 'k8.pdf', 2026, 8);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].item_codigo).toBe('5');
    expect(r.filas[0].total_mes).toBe('60608');
    expect(r.filas[0].contrato).toBe('K8');
  });

  it('una línea que parece código pero no trae plata se reporta como aviso y no es fila', () => {
    const linea = [w('7', 57, 157), w('texto suelto', 108, 157)];
    const r = procesarPagina([...header, ...linea], 'k8.pdf', 2026, 8);
    expect(r.filas).toEqual([]);
    expect(r.avisos).toEqual([
      expect.objectContaining({ tipo: 'linea_no_leida', fila: 1, fuerte: false }),
    ]);
  });

  it('las líneas de continuación (sin código) siguen pegándose a la fila anterior', () => {
    // Nota: "Instalación"/"de servicio" van a x0=150 (no 108 como en el
    // brief) porque con el header de este describe la columna item_codigo
    // llega hasta x=139 (midpoint 54/214 + 5): a 108 la palabra caería
    // dentro de item_codigo, no de tarea, y el aserto de abajo no podría
    // cumplirse. 150 cae ya dentro del rango de tarea [139, 290.5).
    const fila = [
      w('436', 56, 141),
      w('Instalación', 150, 141),
      w('k8', 363, 141),
      w('Salta', 484, 141),
      w('16', 542, 141),
      w('240.007,08', 566, 141),
      w('3.840.113', 601, 141),
    ];
    const cont = [w('de servicio', 150, 145)];
    const r = procesarPagina([...header, ...fila, ...cont], 'k8.pdf', 2026, 8);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].tarea).toBe('Instalación de servicio');
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

  it('nro_np null si no hay etiqueta NP/WK', () => {
    const meta = extraerMeta([w('CONTRATO', 0, 0), w('K12', 50, 0), w('NORTE', 100, 0)]);
    expect(meta.nro_np).toBeNull();
  });
});

describe('extraerMeta (K11/K8 agosto 2026)', () => {
  const words = (txt: string) => txt.split(' ').map((t, i) => w(t, i * 30, 10));

  it('NP con etiqueta "NRO. WK"', () => {
    expect(extraerMeta(words('CONTRATISTA SER&TEC NRO. WK 362000594 K K2')).nro_np).toBe(
      '362000594',
    );
  });
  it('NP con etiqueta "NRO. DE NP"', () => {
    expect(extraerMeta(words('NRO. DE NP 362000594 PRESUP MES')).nro_np).toBe('362000594');
  });
  it('período a certificar', () => {
    expect(extraerMeta(words('PERIODO A CERTIFICAR 1/8/2026 30/8/2026')).periodo_archivo).toEqual({
      desde: '2026-08-01',
      hasta: '2026-08-30',
    });
  });
  it('total declarado sin centavos y con miles: "TOTAL MES $ - $ 22.535.210" -> 22535210', () => {
    expect(extraerMeta(words('TOTAL MES $ - $ 22.535.210 SALDO')).total_declarado).toBe(22535210);
  });
  it('total declarado con centavos: "TOTAL MES $ 14.804.767,81"', () => {
    expect(
      extraerMeta(words('TOTAL MES $ 14.804.767,81 $ 14.804.767,81')).total_declarado,
    ).toBeCloseTo(14804767.81, 2);
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
  const meta = { k_gasnor: null, nro_np: null, total_declarado: null, periodo_archivo: null };

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
    const metaConK = { k_gasnor: 'K9', nro_np: null, total_declarado: null, periodo_archivo: null };
    const grupo = [[w('A123', 0, 0), w('Constructora', 100, 0), w('Salta', 200, 0)]];
    const { fila } = procesarFila(grupo, colMap, 'archivo.pdf', 3, 2026, 8, metaConK);
    expect(fila.contrato).toBe('K9');
  });
});

describe('procesarPagina (fila multilínea, footer corta la página)', () => {
  // Incluye UNITARIO y TOTAL: son columnas requeridas, sin ellas la página
  // se rechaza con error de header.
  const header = [
    w('ÍTEMS', 0, 0),
    w('TAREA', 60, 0),
    w('CONTRATISTA', 150, 0),
    w('PROVINCIA', 250, 0),
    w('K', 350, 0),
    w('CANTIDADES', 400, 0),
    w('UNITARIO', 450, 0),
    w('TOTAL', 500, 0),
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
    const page = doc.addPage([800, 400]);
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
    draw('UNITARIO', 620, 350);
    draw('TOTAL', 720, 350);

    // Fila de datos
    draw('A100', 30, 330);
    draw('Reparar', 100, 330);
    draw('Constructora', 250, 330);
    draw('Salta', 380, 330);
    draw('K12', 480, 330);
    draw('5', 520, 330);
    draw('100,50', 620, 330);
    draw('502,50', 720, 330);

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
