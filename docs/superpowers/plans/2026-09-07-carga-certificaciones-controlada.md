# Carga de certificaciones controlada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la carga de certificaciones de Naturgy lea bien lo que hoy lee mal en silencio (montos sin centavos, columna CUENTA, ítems cortos, metadatos) y que lo que no se pueda leer quede bloqueado hasta que la persona lo corrija, lo confirme o lo agregue a mano.

**Architecture:** Los parsers (Excel/PDF) siguen siendo funciones puras que devuelven `ResultadoParseo`; se les agregan avisos, columnas ignoradas y metadatos. La cuadratura por fila vive en `validacion.ts` (puro, compartido por preview y confirmar) y se espeja en el frontend en `revalidar.ts`. `CargaService` arma avisos de negocio (K del nombre, período), aplica las ediciones nuevas, inserta filas manuales con `origen='manual'` y rechaza confirmar con bloqueadas. El frontend implementa el mockup aprobado sobre `page.tsx` existente.

**Tech Stack:** NestJS 11 + Prisma 7 (adapter mariadb) + exceljs + pdfjs-dist, Jest (`npm test`); Next 15 + React Query + Vitest (`npm test` en Frontend). Windows, PowerShell; comandos git con `gh`.

**Spec:** `docs/superpowers/specs/2026-09-07-carga-certificaciones-controlada-design.md` (leerlo entero antes de empezar; CONTEXT.md sección "Carga de certificaciones (Naturgy)" para el vocabulario).

## Global Constraints

- Tolerancia de cuadratura por fila: `1.00` peso (`TOLERANCIA_CUADRATURA = 1`).
- Tolerancia contra total declarado: `1.00` peso. Total declarado `0` o `null` = no hay total declarado.
- Montos en texto: punto = miles, coma = decimal, sin heurística por forma.
- Columnas requeridas (PDF y Excel): `item_codigo`, `contrato`, `provincia`, `cantidades`, `precio_unitario`, `total_mes`.
- Textos de error existentes NO cambian (`'Falta cantidad'`, `'Falta total mes'`, `'Falta contrato K'`, `'Falta provincia'`, `Provincia 'X' inválida`, `Ítem X no encontrado en el maestro`). Nuevos: `'Falta $ unitario (no se puede cuadrar)'`, `'No cuadra: N × U = C, impreso T (dif. $ D)'`.
- Todo DDL va a las DOS bases (`testing` y `Horas_Sertec`), a mano, documentado en `docs/sql/`. Nunca ejecutar DDL desde código.
- Flujo de entrega: mostrar el cambio al usuario y esperar OK antes del PR; rama por etapa; `gh pr merge N --merge --admin`; deploy SOLO con pedido explícito.
- Los PDFs reales NO se commitean (documentos de negocio). Los tests reales leen `process.env.CERT_PDF_DIR` y se saltean si no está.
- Frontend: tablas sin scroll horizontal (columnas principales + fila expandible); Recharts si hubiera gráficos (no hay en este plan).
- Español con tildes en todo texto visible.

---

# Etapa A — Backend: parsers y validación (rama `feat/cert-carga-controlada-parser`)

### Task 1: Helper único de montos es-AR (`montos.ts`)

**Files:**
- Create: `src/certificaciones/carga/montos.ts`
- Create: `src/certificaciones/carga/montos.spec.ts`
- Modify: `src/certificaciones/carga/parser-excel.ts` (funciones `parsearMonto`, `fmtNum`, líneas ~118-145)
- Modify: `src/certificaciones/carga/parser-pdf.ts` (función `limpiarNum`, líneas ~115-130)

**Interfaces:**
- Produces: `parsearMontoTexto(s: string | null | undefined): string | null` — devuelve la string numérica normalizada con punto decimal (ej. `"400012"`, `"3840113"`, `"254552.96"`, `"677910"`) o `null` si no hay número. `montoANumero(s): number | null`.

- [ ] **Step 1: Test que falla**

```ts
// src/certificaciones/carga/montos.spec.ts
import { parsearMontoTexto, montoANumero } from './montos';

describe('parsearMontoTexto (es-AR estricto: punto = miles, coma = decimal)', () => {
  it.each([
    ['3.840.113', '3840113'],
    ['400.012', '400012'],
    ['60.608', '60608'],
    ['254.552,96', '254552.96'],
    ['$ 22.535.209,93', '22535209.93'],
    ['22.535.210', '22535210'],
    ['677.910', '677910'],
    ['52,76', '52.76'],
    ['922', '922'],
    ['1.5', '15'], // regla estricta: el punto NUNCA es decimal
    ['-', null],
    ['', null],
    [null, null],
    ['abc', null],
  ])('%s -> %s', (entrada, esperado) => {
    expect(parsearMontoTexto(entrada)).toBe(esperado);
  });

  it('toma solo el primer bloque numérico y descarta la cola de texto', () => {
    expect(parsearMontoTexto('3.840.113 12 servicios')).toBe('3840113');
  });

  it('montoANumero devuelve number o null', () => {
    expect(montoANumero('400.012')).toBe(400012);
    expect(montoANumero('-')).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx jest src/certificaciones/carga/montos.spec.ts`
Expected: FAIL — `Cannot find module './montos'`.

- [ ] **Step 3: Implementación**

```ts
// src/certificaciones/carga/montos.ts
/**
 * Regla única de montos en TEXTO para certificaciones de Naturgy (decisión
 * 2026-09-07, CONTEXT.md "Regla de montos en texto"): el punto es SIEMPRE
 * separador de miles y la coma SIEMPRE decimal. Sin heurística por forma:
 * "400.012" son cuatrocientos mil doce, "1.5" son quince. Si algún día
 * viniera al estilo inglés, la cuadratura por fila lo delata.
 *
 * Aplica a texto de PDF y a celdas de TEXTO de Excel. Las celdas numéricas
 * de Excel ya traen el valor real y no pasan por acá.
 */
const BLOQUE_NUM_RE = /[+-]?[\d.,]+/;
const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

export function parsearMontoTexto(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const sinMoneda = s.replace(/\$/g, '').trim();
  const m = sinMoneda.match(BLOQUE_NUM_RE);
  if (!m) return null;
  let bloque = m[0].replace(/^[.,]+/, '').replace(/[.,]+$/, '');
  if (!/\d/.test(bloque)) return null;
  bloque = bloque.replace(/\./g, '').replace(/,/g, '.');
  if (!FLOAT_RE.test(bloque)) return null;
  const n = Number(bloque);
  if (!Number.isFinite(n)) return null;
  return bloque;
}

export function montoANumero(s: string | null | undefined): number | null {
  const t = parsearMontoTexto(s);
  return t === null ? null : Number(t);
}
```

Luego en `parser-pdf.ts` reemplazar el cuerpo de `limpiarNum` por `return parsearMontoTexto(s);` (mantener el `export function limpiarNum` porque lo importan los specs). En `parser-excel.ts`, `parsearMonto(v)` pasa a `return montoANumero(v);` y `fmtNum(v)` a `return parsearMontoTexto(v);`. Importar desde `'./montos'`.

- [ ] **Step 4: Correr todo el módulo**

Run: `npx jest src/certificaciones/carga`
Expected: `montos.spec.ts` PASS. En `parser-pdf.spec.ts` van a fallar los casos viejos que asumían "punto solo = decimal" (`limpiarNum` describe 'coma sola = decimal; punto+coma...'): actualizar esas expectativas a la regla nueva (ej. si esperaba `'1.5'` de `'1.5'`, ahora es `'15'`). Idem en `parser-excel.spec.ts` si hay asserts de `fmtNum` con punto decimal en TEXTO. No cambiar nada más.

- [ ] **Step 5: Commit**

```bash
git add src/certificaciones/carga/montos.ts src/certificaciones/carga/montos.spec.ts src/certificaciones/carga/parser-excel.ts src/certificaciones/carga/parser-pdf.ts src/certificaciones/carga/parser-pdf.spec.ts src/certificaciones/carga/parser-excel.spec.ts
git commit -m "feat(cert-carga): regla única de montos es-AR (punto=miles, coma=decimal) para PDF y texto Excel"
```

### Task 2: Tipos nuevos del parser (avisos, columnas ignoradas, período, K del nombre)

**Files:**
- Modify: `src/certificaciones/carga/parser-tipos.ts`
- Create: `src/certificaciones/carga/nombre-archivo.ts`
- Create: `src/certificaciones/carga/nombre-archivo.spec.ts`
- Modify: `src/certificaciones/carga/parser-excel.ts` (`parsearExcel`, inicialización de `resultado`)
- Modify: `src/certificaciones/carga/parser-pdf.ts` (`parsearPdf`, inicialización de `resultado`)

**Interfaces:**
- Produces:
```ts
export type TipoAviso = 'columna_ignorada' | 'linea_no_leida' | 'sin_total_declarado' | 'periodo_archivo' | 'k_nombre_archivo' | 'np_no_detectado';
export interface AvisoParseo { tipo: TipoAviso; hoja: string; fila: number; mensaje: string; fuerte: boolean }
export interface PeriodoArchivo { desde: string; hasta: string } // 'YYYY-MM-DD'
// ResultadoParseo suma: avisos: AvisoParseo[]; columnas_ignoradas: string[]; periodo_archivo: PeriodoArchivo | null; k_nombre_archivo: string | null;
export function extraerKDeNombre(nombreArchivo: string): string | null; // 'K11' | null
```

- [ ] **Step 1: Test que falla**

```ts
// src/certificaciones/carga/nombre-archivo.spec.ts
import { extraerKDeNombre } from './nombre-archivo';

describe('extraerKDeNombre', () => {
  it.each([
    ['CERTIFICADO AGOSTO 2026 SERTEC - K11 - Capex (Inspecciones).pdf', 'K11'],
    ['CERTIFICADOS SERTEC (K8) -agosto 26 -Opex.pdf', 'K8'],
    ['CERTIFICADO JUNIO 2026 SERTEC - K2- ODORIZACION.xlsx', 'K2'],
    ['CERTIFICADO AGRUPADO SERTEC ADECUACION CAPEX-1JUL31JUL ..xlsm', null],
    ['k 5 algo.pdf', 'K5'],
  ])('%s -> %s', (nombre, esperado) => {
    expect(extraerKDeNombre(nombre)).toBe(esperado);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx jest src/certificaciones/carga/nombre-archivo.spec.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementación**

```ts
// src/certificaciones/carga/nombre-archivo.ts
/** 'K11' desde "… - K11 - Capex.pdf" o "(K8)"; null si el nombre no trae K. */
export function extraerKDeNombre(nombreArchivo: string): string | null {
  const m = nombreArchivo.toUpperCase().match(/(?:^|[^A-Z0-9])K\s?(\d{1,3})(?![0-9])/);
  return m ? `K${m[1]}` : null;
}
```

Agregar a `parser-tipos.ts`:

```ts
export type TipoAviso =
  | 'columna_ignorada'
  | 'linea_no_leida'
  | 'sin_total_declarado'
  | 'periodo_archivo'
  | 'k_nombre_archivo'
  | 'np_no_detectado';

/** Aviso de lectura: `fuerte` = cartel rojo (período distinto, sin total);
 * no fuerte = panel ámbar de "avisos de lectura". Nunca bloquea una fila. */
export interface AvisoParseo {
  tipo: TipoAviso;
  hoja: string;
  fila: number; // 0 si no aplica
  mensaje: string;
  fuerte: boolean;
}

export interface PeriodoArchivo {
  desde: string; // 'YYYY-MM-DD'
  hasta: string; // 'YYYY-MM-DD'
}
```
y en `ResultadoParseo`: `avisos: AvisoParseo[]; columnas_ignoradas: string[]; periodo_archivo: PeriodoArchivo | null; k_nombre_archivo: string | null;`.

En `parsearExcel` y `parsearPdf`, inicializar `resultado` con `avisos: [], columnas_ignoradas: [], periodo_archivo: null, k_nombre_archivo: extraerKDeNombre(nombreArchivo)`.

- [ ] **Step 4: Compilar y correr tests**

Run: `npx tsc --noEmit -p tsconfig.json; npx jest src/certificaciones/carga`
Expected: sin errores de tipo (los specs que construyen `ResultadoParseo` a mano, si los hay, agregan los 4 campos); tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/certificaciones/carga/parser-tipos.ts src/certificaciones/carga/nombre-archivo.ts src/certificaciones/carga/nombre-archivo.spec.ts src/certificaciones/carga/parser-excel.ts src/certificaciones/carga/parser-pdf.ts
git commit -m "feat(cert-carga): tipos de avisos de lectura, columnas ignoradas, período y K del nombre del archivo"
```

### Task 3: PDF — cabecera por frases, columnas requeridas e ignoradas

**Files:**
- Modify: `src/certificaciones/carga/parser-pdf.ts` (`PalabraPosicionada`, `dividirEnPalabras`, `construirColMap`, `procesarPagina`)
- Modify: `src/certificaciones/carga/parser-pdf.spec.ts`

**Interfaces:**
- `PalabraPosicionada` suma `itemId?: number` (índice del item de pdfjs del que salió la palabra; palabras del mismo item = misma frase de cabecera).
- Produces:
```ts
export interface Cabecera { colMap: ColMap; ignoradas: string[]; faltantes: string[] }
export function construirCabecera(headerWs: PalabraPosicionada[]): Cabecera;
export const COLUMNAS_REQUERIDAS = ['item_codigo','contrato','provincia','cantidades','precio_unitario','total_mes'] as const;
```
- `construirColMap` se mantiene exportada como `construirCabecera(ws).colMap` (compatibilidad con specs).

- [ ] **Step 1: Tests que fallan**

```ts
// agregar a parser-pdf.spec.ts
import { construirCabecera, COLUMNAS_REQUERIDAS, procesarPagina } from './parser-pdf';

function frase(texto: string, x0: number, top: number, itemId: number): PalabraPosicionada[] {
  // simula lo que hace dividirEnPalabras con un item de pdfjs: reparte el ancho por caracteres
  const tokens = texto.split(' ');
  const width = texto.length * 5;
  let cursor = 0;
  return tokens.map((t) => {
    const w: PalabraPosicionada = { text: t, x0: x0 + (width * cursor) / texto.length, top, width: (width * t.length) / texto.length, itemId };
    cursor += t.length + 1;
    return w;
  });
}

describe('construirCabecera (frases por itemId, requeridas e ignoradas)', () => {
  const header = [
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

  it('reconoce todas las requeridas y lista CUENTA como ignorada', () => {
    const c = construirCabecera(header);
    expect(c.faltantes).toEqual([]);
    expect(c.ignoradas).toEqual(['CUENTA']);
    for (const req of COLUMNAS_REQUERIDAS) expect(c.colMap.has(req)).toBe(true);
  });

  it('la columna ignorada ocupa su propio rango: 922 en x=509 NO cae en cantidades', () => {
    const c = construirCabecera(header);
    const [cantIni] = c.colMap.get('cantidades')!;
    expect(509).toBeLessThan(cantIni);
    const [ignIni, ignFin] = c.colMap.get('__ignorada_0')!;
    expect(509).toBeGreaterThanOrEqual(ignIni);
    expect(509).toBeLessThan(ignFin);
  });

  it('sin itemId (palabras sueltas estilo pdfplumber) sigue mapeando por primera palabra', () => {
    const suelto = [w('ÍTEMS', 58, 10), w('TAREA', 195, 10), w('K', 281, 10), w('PROVINCIA', 466, 10), w('Cantidades', 537, 10), w('Unitario', 574, 10), w('Total', 622, 10)];
    const c = construirCabecera(suelto);
    expect(c.faltantes).toEqual([]);
    expect(c.ignoradas).toEqual([]);
  });

  it('reporta faltantes si no hay columna de total', () => {
    const c = construirCabecera([w('ÍTEMS', 58, 10), w('K', 281, 10), w('PROVINCIA', 466, 10), w('Cantidades', 537, 10), w('Unitario', 574, 10)]);
    expect(c.faltantes).toEqual(['total_mes']);
  });
});

describe('procesarPagina con columna ignorada (caso real K11 agosto 2026)', () => {
  it('cantidad = 221 (no 922) y la página registra la columna ignorada', () => {
    const header = [/* mismo header del describe anterior */];
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
    const r = procesarPagina([...header, ...fila], 'k11.pdf', 2026, 8);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].cantidades).toBe('221');
    expect(r.filas[0].precio_unitario).toBe('66989.90');
    expect(r.filas[0].total_mes).toBe('14804768');
    expect(r.columnasIgnoradas).toEqual(['CUENTA']);
  });

  it('sin columna requerida: no procesa filas y emite error de header con las faltantes', () => {
    const header = [w('ÍTEMS', 58, 10), w('K', 281, 10), w('PROVINCIA', 466, 10), w('Cantidades', 537, 10), w('Unitario', 574, 10)];
    const r = procesarPagina([...header, w('436', 56, 30), w('16', 542, 30)], 'x.pdf', 2026, 8);
    expect(r.filas).toEqual([]);
    expect(r.errores[0].campo).toBe('header');
    expect(r.errores[0].mensaje).toContain('total_mes');
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx jest src/certificaciones/carga/parser-pdf.spec.ts`
Expected: FAIL — `construirCabecera` no existe.

- [ ] **Step 3: Implementación**

En `parser-pdf.ts`:

```ts
export interface PalabraPosicionada {
  text: string;
  x0: number;
  top: number;
  width: number;
  /** Índice del item de pdfjs de origen: las palabras con el mismo itemId
   * forman una frase de cabecera ("NOMBRE CONTRATO", "$ Total mes"). */
  itemId?: number;
}

/** Frases completas de cabecera → campo canónico (UPPER, espacios normalizados). */
const HEADER_FRASES: Record<string, string> = {
  'ÍTEMS': 'item_codigo', 'ITEMS': 'item_codigo', 'ÍTEM': 'item_codigo', 'ITEM': 'item_codigo',
  'NOMBRE CONTRATO': 'nombre_contrato',
  'TAREA': 'tarea', 'DESCRIPCION': 'tarea', 'DESCRIPCIÓN': 'tarea',
  'K GASNOR': 'contrato', 'K': 'contrato',
  'UM': 'unidad_medida',
  'PTOS. GASNOR': 'ptos_gasnor', 'PTOS GASNOR': 'ptos_gasnor', 'PTOS.': 'ptos_gasnor',
  'TIPO': 'tipo',
  'CONTRATISTA': 'contratista',
  'PROVINCIA': 'provincia',
  'CANTIDADES': 'cantidades', 'CANTIDAD': 'cantidades',
  '$ UNITARIO MES': 'precio_unitario', 'UNITARIO MES': 'precio_unitario', '$ UNITARIO': 'precio_unitario', 'UNITARIO': 'precio_unitario',
  '$ TOTAL MES': 'total_mes', 'TOTAL MES': 'total_mes', '$ TOTAL': 'total_mes', 'TOTAL': 'total_mes',
  'OBSERVACIONES': 'observaciones',
};

export const COLUMNAS_REQUERIDAS = ['item_codigo', 'contrato', 'provincia', 'cantidades', 'precio_unitario', 'total_mes'] as const;

export interface Cabecera {
  colMap: ColMap;
  ignoradas: string[];
  faltantes: string[];
}

/** Agrupa las palabras de la línea de cabecera en frases: mismo itemId =
 * misma frase; sin itemId, cada palabra es su propia frase (pdfplumber). */
function frasesDeCabecera(headerWs: PalabraPosicionada[]): { texto: string; x0: number }[] {
  const ordenadas = [...headerWs].sort((a, b) => a.x0 - b.x0);
  const frases: { texto: string; x0: number; itemId?: number }[] = [];
  for (const w of ordenadas) {
    const ultima = frases[frases.length - 1];
    if (ultima && w.itemId !== undefined && ultima.itemId === w.itemId) {
      ultima.texto += ' ' + w.text.trim();
    } else {
      frases.push({ texto: w.text.trim(), x0: w.x0, itemId: w.itemId });
    }
  }
  return frases.map((f) => ({ texto: f.texto.replace(/\s+/g, ' ').trim().toUpperCase(), x0: f.x0 }));
}

/** Palabras que son continuación de un título y no una columna nueva cuando
 * llegan sueltas (sin itemId): "NOMBRE CONTRATO" partido, "K GASNOR", "$ Total mes". */
const CONTINUACIONES = new Set(['CONTRATO', 'GASNOR', 'MES', '$']);

export function construirCabecera(headerWs: PalabraPosicionada[]): Cabecera {
  const frases = frasesDeCabecera(headerWs);
  const detectados: [number, string][] = [];
  const ignoradas: string[] = [];
  let nIgn = 0;
  for (const f of frases) {
    const campo = HEADER_FRASES[f.texto] ?? HEADER_FRASES[f.texto.split(' ')[0]];
    if (campo) {
      if (!detectados.some(([, c]) => c === campo)) detectados.push([f.x0, campo]);
      continue;
    }
    if (CONTINUACIONES.has(f.texto) || f.texto === '') continue;
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
  return { colMap, ignoradas, faltantes };
}

/** Compatibilidad con los specs existentes. */
export function construirColMap(headerWs: PalabraPosicionada[]): ColMap {
  return construirCabecera(headerWs).colMap;
}
```

En `dividirEnPalabras(texto, x0, top, width, itemId?: number)` propagar `itemId` a cada palabra; en `extraerPalabrasPorPagina` pasar el índice del item (`content.items.forEach((item, idx) => ...)`).

En `ResultadoPagina` agregar `columnasIgnoradas: string[]` y `avisos: AvisoParseo[]`. En `procesarPagina`: usar `construirCabecera(ws)`; si `faltantes.length > 0` → `resultado.errores.push({ hoja: nombreArchivo, fila: 0, campo: 'header', mensaje: \`Faltan columnas requeridas en la cabecera: ${faltantes.join(', ')}. Se ignoraron: ${ignoradas.join(', ') || 'ninguna'}.\` })` y `return resultado`. Si no, `resultado.columnasIgnoradas = ignoradas`. En `parsearPdf`, acumular `columnas_ignoradas` únicas de todas las páginas y por cada una un aviso `{ tipo: 'columna_ignorada', hoja: nombreArchivo, fila: 0, fuerte: false, mensaje: \`Columna ignorada: ${c}. Sus valores no se asignaron a ninguna columna.\` }`.

- [ ] **Step 4: Correr tests**

Run: `npx jest src/certificaciones/carga/parser-pdf.spec.ts`
Expected: PASS (los tests viejos de `construirColMap` siguen pasando vía el wrapper).

- [ ] **Step 5: Commit**

```bash
git add src/certificaciones/carga/parser-pdf.ts src/certificaciones/carga/parser-pdf.spec.ts
git commit -m "feat(cert-carga/pdf): cabecera por frases, columnas requeridas y columnas ignoradas con rango propio"
```

### Task 4: PDF — filas con código corto y líneas no leídas

**Files:**
- Modify: `src/certificaciones/carga/parser-pdf.ts` (`esItemValido`, bucle de agrupación en `procesarPagina`)
- Modify: `src/certificaciones/carga/parser-pdf.spec.ts`

**Interfaces:**
- `esItemValido(s)` acepta `^[A-Za-z]?\d+([-.,/][A-Za-z0-9]+)?$`.
- Produces: `export function lineaTraePlata(ws: PalabraPosicionada[], colMap: ColMap): boolean` — true si en el rango de `cantidades` o `total_mes` hay un número parseable.

- [ ] **Step 1: Tests que fallan**

```ts
describe('esItemValido (1+ dígitos, letra opcional, sufijo opcional)', () => {
  it.each([['5', true], ['132', true], ['116-a', true], ['A12', true], ['ÍTEMS', false], ['', false], ['Firma', false], ['12 servicios', false]])(
    '%s -> %s', (s, esperado) => expect(esItemValido(s)).toBe(esperado),
  );
});

describe('procesarPagina: fila de ítem corto y línea sin plata', () => {
  const header = [w('ÍTEMS', 54, 134), w('TAREA', 214, 134), w('K', 357, 134), w('PROVINCIA', 489, 134), w('Cantidades', 521, 134), w('Unitario', 557, 134), w('Total', 595, 134)];

  it('el ítem "5" con cantidad y total ES una fila', () => {
    const fila = [w('5', 57, 157), w('Adicional largos', 108, 157), w('k8', 363, 157), w('Salta', 484, 157), w('4', 544, 157), w('15.151,96', 568, 157), w('60.608', 606, 157)];
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
    expect(r.avisos).toEqual([expect.objectContaining({ tipo: 'linea_no_leida', fila: 1, fuerte: false })]);
  });

  it('las líneas de continuación (sin código) siguen pegándose a la fila anterior', () => {
    const fila = [w('436', 56, 141), w('Instalación', 108, 141), w('k8', 363, 141), w('Salta', 484, 141), w('16', 542, 141), w('240.007,08', 566, 141), w('3.840.113', 601, 141)];
    const cont = [w('de servicio', 108, 145)];
    const r = procesarPagina([...header, ...fila, ...cont], 'k8.pdf', 2026, 8);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].tarea).toBe('Instalación de servicio');
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx jest src/certificaciones/carga/parser-pdf.spec.ts -t "ítem corto|esItemValido"`
Expected: FAIL (`'5'` rechazado; `avisos` undefined).

- [ ] **Step 3: Implementación**

```ts
const ITEM_RE = /^[A-Za-z]?\d+([-.,/][A-Za-z0-9]+)?$/;
export function esItemValido(s: string | null | undefined): boolean {
  if (!s) return false;
  const t = s.trim();
  const su = t.toUpperCase();
  if (su === 'ÍTEMS' || su === 'ITEMS' || su === 'ÍTEM' || su === 'ITEM') return false;
  return ITEM_RE.test(t);
}

export function lineaTraePlata(ws: PalabraPosicionada[], colMap: ColMap): boolean {
  return limpiarNum(obtenerTexto(ws, colMap, 'cantidades')) !== null || limpiarNum(obtenerTexto(ws, colMap, 'total_mes')) !== null;
}
```

En el bucle de `procesarPagina`, reemplazar la decisión `esItem`:

```ts
const primer = ws[0];
const pareceCodigo = esItemValido(primer.text.trim()) && primer.x0 < itemXMax;
if (pareceCodigo && lineaTraePlata(ws, colMap)) {
  grupoActual = [ws];
  grupos.push(grupoActual);
} else if (pareceCodigo && grupoActual === null) {
  // parece fila pero no trae plata y no hay fila abierta: aviso, no se pierde en silencio
  lineasNoLeidas += 1;
  resultado.avisos.push({ tipo: 'linea_no_leida', hoja: nombreArchivo, fila: lineasNoLeidas, fuerte: false,
    mensaje: `Una línea de la página empieza con "${primer.text.trim()}" pero no trae cantidad ni total legibles. Si es un ítem certificado, agregalo como fila manual.` });
} else if (grupoActual !== null) {
  grupoActual.push(ws);
}
```
Nota: si `pareceCodigo` y NO trae plata pero hay grupo abierto, se pega al grupo (continuación de tarea que empieza con número, ej. "25 mm , sobre cañería…"). Inicializar `resultado.avisos = []` y `let lineasNoLeidas = 0`.

En `parsearPdf`, concatenar `pagina.avisos` a `resultado.avisos`.

- [ ] **Step 4: Correr tests**

Run: `npx jest src/certificaciones/carga/parser-pdf.spec.ts`
Expected: PASS. El test viejo `'rechaza menos de 3 dígitos'` se actualiza a la regla nueva (ahora acepta 1+ dígitos; sigue rechazando headers y texto).

- [ ] **Step 5: Commit**

```bash
git add src/certificaciones/carga/parser-pdf.ts src/certificaciones/carga/parser-pdf.spec.ts
git commit -m "feat(cert-carga/pdf): fila = código de 1+ dígitos con plata; líneas dudosas como aviso"
```

### Task 5: PDF — metadatos: NP (NP/WK), período a certificar, total declarado

**Files:**
- Modify: `src/certificaciones/carga/parser-pdf.ts` (`Meta`, `extraerMeta`, `parsearPdf`)
- Modify: `src/certificaciones/carga/parser-pdf.spec.ts`

**Interfaces:**
- `Meta` suma `periodo_archivo: PeriodoArchivo | null`.
- Produces: `export function parsearFechaDMA(s: string): string | null` ('4/9/2026' → '2026-09-04').

- [ ] **Step 1: Tests que fallan**

```ts
describe('extraerMeta (K11/K8 agosto 2026)', () => {
  const words = (txt: string) => txt.split(' ').map((t, i) => w(t, i * 30, 10));

  it('NP con etiqueta "NRO. WK"', () => {
    expect(extraerMeta(words('CONTRATISTA SER&TEC NRO. WK 362000594 K K2')).nro_np).toBe('362000594');
  });
  it('NP con etiqueta "NRO. DE NP"', () => {
    expect(extraerMeta(words('NRO. DE NP 362000594 PRESUP MES')).nro_np).toBe('362000594');
  });
  it('período a certificar', () => {
    expect(extraerMeta(words('PERIODO A CERTIFICAR 1/8/2026 30/8/2026')).periodo_archivo).toEqual({ desde: '2026-08-01', hasta: '2026-08-30' });
  });
  it('total declarado sin centavos y con miles: "TOTAL MES $ - $ 22.535.210" → 22535210', () => {
    expect(extraerMeta(words('TOTAL MES $ - $ 22.535.210 SALDO')).total_declarado).toBe(22535210);
  });
  it('total declarado con centavos: "TOTAL MES $ 14.804.767,81"', () => {
    expect(extraerMeta(words('TOTAL MES $ 14.804.767,81 $ 14.804.767,81')).total_declarado).toBeCloseTo(14804767.81, 2);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx jest src/certificaciones/carga/parser-pdf.spec.ts -t extraerMeta`
Expected: FAIL (nro_np null; periodo_archivo undefined; total 22.535.210 → null).

- [ ] **Step 3: Implementación**

```ts
export function parsearFechaDMA(s: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${m[3]}-${pad2(mo)}-${pad2(d)}`;
}

export function extraerMeta(words: PalabraPosicionada[]): Meta {
  const meta: Meta = { k_gasnor: null, nro_np: null, total_declarado: null, periodo_archivo: null };
  const full = words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').toUpperCase();

  const mK = full.match(/\bK(\d+)\b/);
  if (mK) meta.k_gasnor = 'K' + mK[1];

  const mNp = full.match(/NRO\.?\s*(?:DE\s+)?(?:NP|WK)\s+(\d{4,})/);
  if (mNp) meta.nro_np = mNp[1];

  const mPer = full.match(/PERIODO A CERTIFICAR\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (mPer) {
    const desde = parsearFechaDMA(mPer[1]);
    const hasta = parsearFechaDMA(mPer[2]);
    if (desde && hasta) meta.periodo_archivo = { desde, hasta };
  }

  // Primer monto REAL después de "TOTAL MES" (saltea "$" y "-" vacíos).
  const mTotal = full.match(/TOTAL MES((?:\s*\$?\s*-?\s*)*?)(\d[\d.,]*)/);
  if (mTotal) {
    const n = montoANumero(mTotal[2]);
    if (n !== null && n > 0) meta.total_declarado = n;
  }
  return meta;
}
```
(importar `montoANumero` de `./montos`). En `parsearPdf`: si `resultado.periodo_archivo === null` y la página trae `meta.periodo_archivo`, asignarlo (exponer `periodoArchivo` en `ResultadoPagina`). Si al final `resultado.total_declarado === null`, agregar aviso `{ tipo: 'sin_total_declarado', hoja: nombreArchivo, fila: 0, fuerte: true, mensaje: 'El archivo no declara un total mes legible: la carga no se pudo controlar contra el total declarado.' }`. Si `nro_np === null` en todas las filas, aviso `np_no_detectado` (no fuerte): `'No se detectó el número de NP/WK en la cabecera.'`.

- [ ] **Step 4: Correr tests**

Run: `npx jest src/certificaciones/carga/parser-pdf.spec.ts`
Expected: PASS. Actualizar el test viejo `'nro_np siempre null'` (ya no aplica): reemplazarlo por `'nro_np null si no hay etiqueta NP/WK'`.

- [ ] **Step 5: Commit**

```bash
git add src/certificaciones/carga/parser-pdf.ts src/certificaciones/carga/parser-pdf.spec.ts
git commit -m "feat(cert-carga/pdf): NP con etiquetas NP/WK, período a certificar y total declarado con miles"
```

### Task 6: Excel — columnas requeridas/ignoradas y metadatos

**Files:**
- Modify: `src/certificaciones/carga/parser-excel.ts` (`mapearColumnas`, `procesarHoja`, `extraerMeta`)
- Modify: `src/certificaciones/carga/parser-excel.spec.ts`

**Interfaces:**
- `mapearColumnas(headerUpper)` devuelve `{ mapa: Map<string, number>; ignoradas: string[]; faltantes: string[] }`.
- `Meta` (Excel) suma `periodo_archivo: PeriodoArchivo | null`; `extraerMeta` detecta NP con `NRO. DE NP` y `NRO. WK`, y `PERIODO A CERTIFICAR d/m/yyyy d/m/yyyy` en las primeras 13 filas.

- [ ] **Step 1: Tests que fallan**

Ver cómo `parser-excel.spec.ts` construye workbooks (usa exceljs en memoria). Agregar:

```ts
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
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx jest src/certificaciones/carga/parser-excel.spec.ts -t "requeridas"`
Expected: FAIL.

- [ ] **Step 3: Implementación**

```ts
const COLUMNAS_REQUERIDAS_XLS = ['item_codigo', 'contrato', 'provincia', 'cantidades', 'precio_unitario', 'total_mes'];

function mapearColumnas(headerUpper: Map<number, string>): { mapa: Map<string, number>; ignoradas: string[]; faltantes: string[] } {
  const headerNorm = new Map<number, string>();
  for (const [idx, h] of headerUpper) headerNorm.set(idx, normalizarEspacios(h));
  const mapa = new Map<string, number>();
  const usadas = new Set<number>();
  for (const [canon, aliases] of Object.entries(COL_ALIAS)) {
    for (const alias of aliases) {
      const aliasNorm = normalizarEspacios(alias);
      const idx = [...headerNorm.entries()].find(([, h]) => h === aliasNorm)?.[0];
      if (idx !== undefined) { mapa.set(canon, idx); usadas.add(idx); break; }
    }
  }
  const ignoradas = [...headerNorm.entries()].filter(([idx, h]) => h !== '' && !usadas.has(idx)).map(([, h]) => h);
  const faltantes = COLUMNAS_REQUERIDAS_XLS.filter((c) => !mapa.has(c));
  return { mapa, ignoradas, faltantes };
}
```
En `procesarHoja`: `const { mapa: colMap, ignoradas, faltantes } = mapearColumnas(headerUpper);` si `faltantes.length > 0` → error `header` `Faltan columnas requeridas en la hoja: ${faltantes.join(', ')}. Header: ${JSON.stringify(primeros12)}` y return (reemplaza el chequeo solo de ÍTEMS). Acumular `ignoradas` en `resultado.columnas_ignoradas` (únicas) y un aviso `columna_ignorada` por cada una con `hoja: nombreHoja`.

En `extraerMeta` (Excel), además del NP actual:
```ts
if ((filaStr.includes('NRO. WK') || filaStr.includes('NRO WK')) && !meta.nro_np) {
  for (let i = 0; i < vals.length; i++) if (vals[i].toUpperCase().includes('WK') && i + 1 < vals.length && /^\d{4,}$/.test(vals[i + 1])) meta.nro_np = vals[i + 1];
}
if (filaStr.includes('PERIODO A CERTIFICAR') && !meta.periodo_archivo) {
  const fechas = vals.map(aFechaISO).filter((f): f is string => f !== null);
  if (fechas.length >= 2) meta.periodo_archivo = { desde: fechas[0], hasta: fechas[1] };
}
```
donde `aFechaISO(v)` acepta `'d/m/yyyy'` (con `parsearFechaDMA` exportado desde `parser-pdf.ts`, o moverlo a `montos.ts` como `fechas.ts` — elegir `src/certificaciones/carga/fechas.ts` con `parsearFechaDMA` y `fechaISODeCelda(raw)` que también acepta el ISO de `Date.toISOString()` que produce `rawToStr`). En `parsearExcel`, tomar el `periodo_archivo` de la primera hoja que lo tenga; aviso `sin_total_declarado` (fuerte) si al final `total_declarado` es null o 0.

- [ ] **Step 4: Correr tests**

Run: `npx jest src/certificaciones/carga`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/certificaciones/carga/parser-excel.ts src/certificaciones/carga/parser-excel.spec.ts src/certificaciones/carga/fechas.ts src/certificaciones/carga/parser-pdf.ts
git commit -m "feat(cert-carga/excel): columnas requeridas e ignoradas, NP WK, período a certificar"
```

### Task 7: Validación — cuadratura por fila y bloqueo

**Files:**
- Modify: `src/certificaciones/carga/validacion.ts`
- Modify: `src/certificaciones/carga/validacion.spec.ts`

**Interfaces:**
- Produces:
```ts
export const TOLERANCIA_CUADRATURA = 1;
export interface Cuadratura { calculado: number | null; impreso: number | null; diferencia: number | null; cuadra: boolean; sugerencia_cantidad: string | null }
export function cuadraturaFila(f: { cantidades: string | null; precio_unitario: string | null; total_mes: string | null }): Cuadratura;
export function revalidarFila(f: FilaParseada, opts: { itemExiste: boolean; provinciasValidas: string[]; confirmada?: boolean }): { tieneError: boolean; detalle: string | null; cuadratura: Cuadratura };
```
- `cuadra === false` bloquea salvo `opts.confirmada === true`. Falta de unitario: `cuadra=false`, detalle `'Falta $ unitario (no se puede cuadrar)'`.
- `sugerencia_cantidad`: si unitario > 0 y `total/unitario` está a ≤ 0,01 de un entero ≥ 1 y ese entero ≠ cantidad → `String(entero)`; si no, null.

- [ ] **Step 1: Tests que fallan**

```ts
import { cuadraturaFila, TOLERANCIA_CUADRATURA } from './validacion';

describe('cuadraturaFila', () => {
  it('3 × 133337.26 = 400011.78 vs impreso 400012: cuadra (dif 0,22 ≤ 1)', () => {
    const c = cuadraturaFila({ cantidades: '3', precio_unitario: '133337.26', total_mes: '400012' });
    expect(c.cuadra).toBe(true);
    expect(c.diferencia).toBeCloseTo(0.22, 2);
    expect(c.sugerencia_cantidad).toBeNull();
  });
  it('922 × 66989.90 vs impreso 14804768: NO cuadra y sugiere 221', () => {
    const c = cuadraturaFila({ cantidades: '922', precio_unitario: '66989.90', total_mes: '14804768' });
    expect(c.cuadra).toBe(false);
    expect(c.sugerencia_cantidad).toBe('221');
  });
  it('sin unitario: no cuadra, sin sugerencia', () => {
    const c = cuadraturaFila({ cantidades: '3', precio_unitario: null, total_mes: '400012' });
    expect(c).toEqual({ calculado: null, impreso: 400012, diferencia: null, cuadra: false, sugerencia_cantidad: null });
  });
  it('tolerancia exportada = 1', () => expect(TOLERANCIA_CUADRATURA).toBe(1));
});

describe('revalidarFila con cuadratura', () => {
  const opts = { itemExiste: true, provinciasValidas: ['Salta'] };
  it('fila que cuadra: sin error', () => {
    const r = revalidarFila(filaBase({ cantidades: '3', precio_unitario: '133337.26', total_mes: '400012' }), opts);
    expect(r.tieneError).toBe(false);
    expect(r.cuadratura.cuadra).toBe(true);
  });
  it('fila que no cuadra: bloqueada con detalle de las tres cifras', () => {
    const r = revalidarFila(filaBase({ cantidades: '922', precio_unitario: '66989.90', total_mes: '14804768' }), opts);
    expect(r.tieneError).toBe(true);
    expect(r.detalle).toBe('No cuadra: 922 × 66989.90 = 61764687.80, impreso 14804768 (dif. $ 46959919.80)');
  });
  it('confirmada levanta SOLO el bloqueo por cuadratura', () => {
    const r = revalidarFila(filaBase({ cantidades: '922', precio_unitario: '66989.90', total_mes: '14804768' }), { ...opts, confirmada: true });
    expect(r.tieneError).toBe(false);
    const r2 = revalidarFila(filaBase({ cantidades: '922', precio_unitario: '66989.90', total_mes: '14804768', provincia: '' }), { ...opts, confirmada: true });
    expect(r2.tieneError).toBe(true);
    expect(r2.detalle).toBe('Falta provincia');
  });
  it('sin unitario: bloqueada con texto exacto', () => {
    const r = revalidarFila(filaBase({ cantidades: '3', precio_unitario: null, total_mes: '100' }), opts);
    expect(r.detalle).toBe('Falta $ unitario (no se puede cuadrar)');
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx jest src/certificaciones/carga/validacion.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementación**

```ts
export const TOLERANCIA_CUADRATURA = 1;

export interface Cuadratura {
  calculado: number | null;
  impreso: number | null;
  diferencia: number | null;
  cuadra: boolean;
  sugerencia_cantidad: string | null;
}

/** Fila que cuadra (CONTEXT.md): |cantidad × unitario − total| ≤ 1 peso.
 * Ninguna cifra manda sola. Sin unitario no hay cuadratura posible. */
export function cuadraturaFila(f: { cantidades: string | null; precio_unitario: string | null; total_mes: string | null }): Cuadratura {
  const cant = num(f.cantidades);
  const unit = num(f.precio_unitario);
  const total = num(f.total_mes);
  if (cant === null || unit === null || total === null) {
    return { calculado: null, impreso: total, diferencia: null, cuadra: false, sugerencia_cantidad: null };
  }
  const calculado = Math.round(cant * unit * 100) / 100;
  const diferencia = Math.round((total - calculado) * 100) / 100;
  const cuadra = Math.abs(diferencia) <= TOLERANCIA_CUADRATURA;
  let sugerencia: string | null = null;
  if (!cuadra && unit > 0) {
    const q = total / unit;
    const ent = Math.round(q);
    if (ent >= 1 && Math.abs(q - ent) <= 0.01 && ent !== cant) sugerencia = String(ent);
  }
  return { calculado, impreso: total, diferencia, cuadra, sugerencia_cantidad: sugerencia };
}

const fmt2 = (n: number) => n.toFixed(2);

export function revalidarFila(
  f: FilaParseada,
  opts: { itemExiste: boolean; provinciasValidas: string[]; confirmada?: boolean },
): { tieneError: boolean; detalle: string | null; cuadratura: Cuadratura } {
  const faltas: string[] = [];
  // ... (bloque existente: ítem, contrato, provincia, cantidad, total — sin cambios de texto)
  const cuadratura = cuadraturaFila(f);
  if (faltas.length === 0 && !cuadratura.cuadra && !opts.confirmada) {
    if (num(f.precio_unitario) === null) {
      faltas.push('Falta $ unitario (no se puede cuadrar)');
    } else {
      faltas.push(`No cuadra: ${f.cantidades} × ${f.precio_unitario} = ${fmt2(cuadratura.calculado!)}, impreso ${f.total_mes} (dif. $ ${fmt2(cuadratura.diferencia!)})`);
    }
  }
  return faltas.length > 0
    ? { tieneError: true, detalle: faltas.join('; '), cuadratura }
    : { tieneError: false, detalle: null, cuadratura };
}
```
Nota: la cuadratura solo se evalúa si no hay otras faltas (una fila sin cantidad ya está bloqueada por 'Falta cantidad'; no duplicar mensajes).

- [ ] **Step 4: Correr tests**

Run: `npx jest src/certificaciones/carga`
Expected: PASS. `carga.service.spec.ts` puede fallar por la firma nueva (`cuadratura` en el retorno no rompe; `precio_unitario: null` en fixtures ahora bloquea): actualizar fixtures del service spec agregando `precio_unitario` coherente (ej. cantidad '3', unitario '100', total '300').

- [ ] **Step 5: Commit**

```bash
git add src/certificaciones/carga/validacion.ts src/certificaciones/carga/validacion.spec.ts src/certificaciones/carga/carga.service.spec.ts
git commit -m "feat(cert-carga): cuadratura por fila (tolerancia $1), bloqueo y override 'confirmada'"
```

### Task 8: Tests contra los PDFs reales (guardados por variable de entorno)

**Files:**
- Create: `src/certificaciones/carga/parser-real.spec.ts`
- Modify: `package.json` (script `test:cert-real`)

- [ ] **Step 1: Escribir el spec**

```ts
// src/certificaciones/carga/parser-real.spec.ts
/**
 * Corre contra los PDFs REALES de Naturgy (no se commitean). Se saltea si
 * CERT_PDF_DIR no está definido. Uso local:
 *   $env:CERT_PDF_DIR = 'C:\Users\Administrador\Downloads'; npm run test:cert-real
 */
import * as fs from 'fs';
import * as path from 'path';
import { parsearPdf } from './parser-pdf';
import { esFilaPlantilla, cuadraturaFila } from './validacion';

const dir = process.env.CERT_PDF_DIR;
const d = dir && fs.existsSync(dir) ? describe : describe.skip;

async function leer(nombre: string) {
  const buf = fs.readFileSync(path.join(dir!, nombre));
  return parsearPdf(buf, nombre, 2026, 8);
}
const suma = (filas: { total_mes: string | null }[]) => filas.reduce((a, f) => a + Number(f.total_mes ?? 0), 0);

d('PDFs reales agosto 2026', () => {
  it('K8 Capex: 8 filas, todas cuadran, suma = total declarado ± 1', async () => {
    const r = await leer('CERTIFICADOS SERTEC (K8) -agosto 26 -Capex.pdf');
    const vis = r.filas.filter((f) => !esFilaPlantilla(f));
    expect(vis).toHaveLength(8);
    expect(vis.map((f) => f.item_codigo)).toContain('5');
    for (const f of vis) expect(cuadraturaFila(f).cuadra).toBe(true);
    expect(r.total_declarado).toBeCloseTo(22535209.93, 2);
    expect(Math.abs(suma(vis) - r.total_declarado!)).toBeLessThanOrEqual(1);
    expect(r.k_nombre_archivo).toBe('K8');
    expect(r.periodo_archivo).toEqual({ desde: '2026-08-01', hasta: '2026-08-30' });
  });

  it('K8 Opex: total 677.910 y NP 362000594', async () => {
    const r = await leer('CERTIFICADOS SERTEC (K8) -agosto 26 -Opex.pdf');
    expect(r.filas[0].total_mes).toBe('677910');
    expect(r.filas[0].nro_np).toBe('362000594');
    expect(r.total_declarado).toBe(677910);
  });

  it('K11 Capex: columna CUENTA ignorada, cantidad 221, cuadra', async () => {
    const r = await leer('CERTIFICADO AGOSTO 2026 SERTEC - K11 - Capex (Inspecciones rehabiltiación de servicio).pdf');
    expect(r.columnas_ignoradas).toEqual(['CUENTA']);
    expect(r.filas[0].cantidades).toBe('221');
    expect(cuadraturaFila(r.filas[0]).cuadra).toBe(true);
    expect(r.filas[0].contrato).toBe('K2');
    expect(r.k_nombre_archivo).toBe('K11');
    expect(r.filas[0].nro_np).toBe('362000594'); // etiqueta "NRO. WK"
  });

  it('K2 Opex: cantidad 109 y cuadra', async () => {
    const r = await leer('CERTIFICADO AGOSTO 2026 SERTEC - K2 - Opex (Inspecciones rehabiltiación de servicio).pdf');
    expect(r.filas[0].cantidades).toBe('109');
    expect(cuadraturaFila(r.filas[0]).cuadra).toBe(true);
  });
});
```
En `package.json` scripts: `"test:cert-real": "jest src/certificaciones/carga/parser-real.spec.ts"`.

- [ ] **Step 2: Correr con los archivos reales**

Run (PowerShell): `$env:CERT_PDF_DIR = 'C:\Users\Administrador\Downloads'; npm run test:cert-real`
Expected: PASS los 4. Si K8 Capex no da 8 filas, revisar Task 4 (línea del ítem "5"); si el total_mes de "3.840.113" queda null, revisar Task 1.

- [ ] **Step 3: Correr sin la variable**

Run: `npm run test:cert-real` (sin `$env:CERT_PDF_DIR`)
Expected: `skipped`.

- [ ] **Step 4: Commit**

```bash
git add src/certificaciones/carga/parser-real.spec.ts package.json
git commit -m "test(cert-carga): spec contra PDFs reales de agosto (CERT_PDF_DIR, se saltea si no está)"
```

**Cierre Etapa A:** `npm test` completo verde → mostrar al usuario el resumen de la salida del spec real → con OK, PR `feat/cert-carga-controlada-parser` → main (`gh pr merge N --merge --admin`). No deployar todavía (sin cambios de contrato con el front, la API sigue compatible: los campos nuevos son aditivos).

---

# Etapa B — Backend: sesión, confirmar, filas manuales (rama `feat/cert-carga-controlada-servicio`)

### Task 9: DDL documentado y Prisma (`filas_manuales`)

**Files:**
- Create: `docs/sql/2026-09-07-cert-origen-y-filas-manuales.sql`
- Modify: `prisma/schema.prisma` (`model CertCargaLog`)

- [ ] **Step 1: Escribir el DDL**

```sql
-- Carga de certificaciones controlada (2026-09-07), decisiones 8 y 9.
-- NO EJECUTAR automáticamente. Correr a mano, en el deploy, en las DOS bases
-- (`testing` y `Horas_Sertec`). Verificar antes con SHOW CREATE TABLE.
--
-- Origen de cada fila cargada: 'archivo' (leída del documento) o 'manual'
-- (agregada por la persona en el preview porque el parser no la reconoció).
ALTER TABLE sth_cert_certificaciones
  ADD COLUMN origen ENUM('archivo','manual') NOT NULL DEFAULT 'archivo';

-- Cuántas filas manuales entraron en cada carga (se muestra en el historial).
ALTER TABLE sth_cert_cargas_log
  ADD COLUMN filas_manuales INT NOT NULL DEFAULT 0;

-- Verificación:
-- SELECT COUNT(*) FROM sth_cert_certificaciones WHERE origen <> 'archivo';  -- 0
-- SELECT filas_manuales FROM sth_cert_cargas_log ORDER BY id DESC LIMIT 3; -- 0
```

- [ ] **Step 2: Prisma**

En `model CertCargaLog` agregar `filasManuales Int @map("filas_manuales") @default(0)` después de `filasError`. Correr `npx prisma generate`. NO correr `prisma migrate` (DDL manual, convención del proyecto).

- [ ] **Step 3: Aplicar el DDL en `testing` (base local de desarrollo)**

Pedirle al usuario que lo corra (o correrlo con el cliente que use habitualmente) ANTES de la Task 12; anotar en el commit que `Horas_Sertec` se hace en el deploy.

- [ ] **Step 4: Compilar**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add docs/sql/2026-09-07-cert-origen-y-filas-manuales.sql prisma/schema.prisma
git commit -m "feat(cert-carga): DDL origen de fila y filas_manuales en el log (manual, ambas bases)"
```

### Task 10: DTOs de edición ampliada y filas manuales

**Files:**
- Modify: `src/certificaciones/dto/carga.dto.ts`

**Interfaces:**
- `EdicionFilaDto` suma `precio_unitario?: string; item_codigo?: string; confirmada?: boolean`.
- Produces:
```ts
export class FilaManualDto {
  @IsInt() @Min(1) id_item: number;
  @IsString() @MaxLength(50) provincia: string;
  @IsString() @MaxLength(30) cantidades: string;
  @IsString() @MaxLength(30) precio_unitario: string;
  @IsString() @MaxLength(30) total_mes: string;
  @IsOptional() @IsString() @MaxLength(500) observaciones?: string;
  @IsOptional() @IsBoolean() confirmada?: boolean;
}
// ConfirmarCargaDto suma:
@IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => FilaManualDto) manuales?: FilaManualDto[];
```

- [ ] **Step 1: Editar el DTO** con los decoradores anteriores (importar `MaxLength` de class-validator). Actualizar el comentario de whitelist: "SOLO estos 8 campos".

- [ ] **Step 2: Compilar**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add src/certificaciones/dto/carga.dto.ts
git commit -m "feat(cert-carga): DTO con unitario, ítem, confirmada y filas manuales"
```

### Task 11: Preview — cuadratura, avisos de negocio, resumen

**Files:**
- Modify: `src/certificaciones/carga/preview-store.ts` (`FilaPreview`, `PreviewSession`)
- Modify: `src/certificaciones/carga/carga.service.ts` (`preview`, interfaces `ResumenPreview`, `RespuestaPreview`)
- Create: `src/certificaciones/carga/avisos.ts`
- Create: `src/certificaciones/carga/avisos.spec.ts`
- Modify: `src/certificaciones/carga/carga.service.spec.ts`

**Interfaces:**
- `FilaPreview` suma `cuadratura: Cuadratura; confirmada: boolean; origen: 'archivo' | 'manual'`.
- `PreviewSession` suma `total_declarado: number | null; k_nombre_archivo: string | null; periodo_archivo: PeriodoArchivo | null`.
- `ResumenPreview` suma `bloqueadas: number`. `RespuestaPreview` suma `avisos: AvisoParseo[]; columnas_ignoradas: string[]; periodo_archivo: PeriodoArchivo | null; k_nombre_archivo: string | null`.
- Produces (avisos.ts):
```ts
export function avisoKNombre(kNombre: string | null, ksResueltos: string[], hoja: string): AvisoParseo | null;
export function avisoPeriodo(periodoArchivo: PeriodoArchivo | null, anio: number, mes: number, hoja: string): AvisoParseo | null;
```

- [ ] **Step 1: Tests que fallan (avisos puros)**

```ts
// avisos.spec.ts
import { avisoKNombre, avisoPeriodo } from './avisos';

describe('avisoKNombre', () => {
  it('K11 en el nombre, K2 resuelto → aviso suave con texto de acción', () => {
    const a = avisoKNombre('K11', ['K2'], 'k11.pdf');
    expect(a).toEqual({ tipo: 'k_nombre_archivo', hoja: 'k11.pdf', fila: 0, fuerte: false,
      mensaje: 'El nombre del archivo dice K11 y las filas se resolvieron en K2. Si la plata va a K11, cambiá el contrato en las filas.' });
  });
  it('K8 en el nombre y entre los resueltos → sin aviso', () => expect(avisoKNombre('K8', ['K8', 'K5'], 'x')).toBeNull());
  it('sin K en el nombre → sin aviso', () => expect(avisoKNombre(null, ['K8'], 'x')).toBeNull());
});

describe('avisoPeriodo', () => {
  it('período del archivo agosto, elegido agosto → null', () => {
    expect(avisoPeriodo({ desde: '2026-08-01', hasta: '2026-08-30' }, 2026, 8, 'x')).toBeNull();
  });
  it('período del archivo julio, elegido agosto → aviso FUERTE', () => {
    const a = avisoPeriodo({ desde: '2026-07-01', hasta: '2026-07-31' }, 2026, 8, 'x');
    expect(a?.fuerte).toBe(true);
    expect(a?.mensaje).toBe('El archivo dice período 1/7/2026 a 31/7/2026 y elegiste agosto 2026. Revisá el mes antes de confirmar.');
  });
  it('sin período en el archivo → null', () => expect(avisoPeriodo(null, 2026, 8, 'x')).toBeNull());
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx jest src/certificaciones/carga/avisos.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementación de avisos.ts**

```ts
import { AvisoParseo, PeriodoArchivo } from './parser-tipos';

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const dma = (iso: string) => { const [y, m, d] = iso.split('-'); return `${Number(d)}/${Number(m)}/${y}`; };

export function avisoKNombre(kNombre: string | null, ksResueltos: string[], hoja: string): AvisoParseo | null {
  if (!kNombre || ksResueltos.length === 0 || ksResueltos.includes(kNombre)) return null;
  const resueltos = [...new Set(ksResueltos)].join(', ');
  return { tipo: 'k_nombre_archivo', hoja, fila: 0, fuerte: false,
    mensaje: `El nombre del archivo dice ${kNombre} y las filas se resolvieron en ${resueltos}. Si la plata va a ${kNombre}, cambiá el contrato en las filas.` };
}

export function avisoPeriodo(p: PeriodoArchivo | null, anio: number, mes: number, hoja: string): AvisoParseo | null {
  if (!p) return null;
  const elegido = `${anio}-${String(mes).padStart(2, '0')}`;
  if (p.hasta.startsWith(elegido) || p.desde.startsWith(elegido)) return null;
  return { tipo: 'periodo_archivo', hoja, fila: 0, fuerte: true,
    mensaje: `El archivo dice período ${dma(p.desde)} a ${dma(p.hasta)} y elegiste ${MESES[mes - 1]} ${anio}. Revisá el mes antes de confirmar.` };
}
```

- [ ] **Step 4: Cambios en `preview()`**

Por fila: `const { tieneError, detalle, cuadratura } = revalidarFila(filaResuelta, { itemExiste, provinciasValidas });` y en `filaPreview` agregar `cuadratura, confirmada: false, origen: 'archivo'`. Contar `bloqueadas = conError` (mismo número; se expone con el nombre nuevo y se mantiene `con_error` por compatibilidad). Después del bucle:

```ts
const ksResueltos = [...new Set(Array.from(filasMap.values()).map((f) => f.contrato).filter(Boolean))];
const avisos = [...resultado.avisos];
const aK = avisoKNombre(resultado.k_nombre_archivo, ksResueltos, resultado.archivo);
if (aK) avisos.push(aK);
const aP = avisoPeriodo(resultado.periodo_archivo, anio, mes, resultado.archivo);
if (aP) avisos.push(aP);
```
Guardar en la sesión `total_declarado: resultado.total_declarado, k_nombre_archivo, periodo_archivo`. Responder con `avisos, columnas_ignoradas: resultado.columnas_ignoradas, periodo_archivo, k_nombre_archivo` y `resumen.bloqueadas`.

- [ ] **Step 5: Test del service**

En `carga.service.spec.ts` agregar un caso: preview de un `ResultadoParseo` mockeado (los specs ya mockean `parsearPdf`/`parsearExcel`; seguir ese patrón) con `k_nombre_archivo: 'K11'`, una fila con `contrato: 'K2'` que cuadra y `periodo_archivo` de julio con período elegido agosto → `resumen.bloqueadas === 0`, `avisos` contiene un `k_nombre_archivo` (no fuerte) y un `periodo_archivo` (fuerte), y `filas[0].cuadratura.cuadra === true`.

Run: `npx jest src/certificaciones/carga`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/certificaciones/carga/avisos.ts src/certificaciones/carga/avisos.spec.ts src/certificaciones/carga/preview-store.ts src/certificaciones/carga/carga.service.ts src/certificaciones/carga/carga.service.spec.ts
git commit -m "feat(cert-carga): preview con cuadratura por fila, avisos de K del nombre y de período, resumen.bloqueadas"
```

### Task 12: Confirmar — ediciones nuevas, filas manuales, rechazo con bloqueadas, origen

**Files:**
- Modify: `src/certificaciones/carga/carga.service.ts` (`confirmar`, `RespuestaConfirmar`)
- Modify: `src/certificaciones/carga/resolucion.service.ts` (nuevo `cargarItemsPorId`)
- Modify: `src/certificaciones/carga/carga.service.spec.ts`

**Interfaces:**
- `RespuestaConfirmar` suma `manuales: number`.
- Produces (resolucion.service.ts):
```ts
async cargarItemsPorId(ids: number[]): Promise<Map<number, { id_item: number; item_codigo: string; codigo_k: string; id_contrato: number; tarea: string; unidad_medida: string | null; ptos_gasnor: string | null; tipo: string | null; contratista: string | null }>>
```
- Error 422 con bloqueadas: `throw new UnprocessableEntityException({ message: \`Hay ${n} filas bloqueadas. Corregilas, confirmalas o excluilas antes de cargar.\`, bloqueadas: [{ rowId, item_codigo, detalle }] })`.

- [ ] **Step 1: Tests que fallan**

Siguiendo el patrón de mocks de `carga.service.spec.ts` (PrismaService, ResolucionService y PreviewStore mockeados), agregar:

```ts
it('confirmar rechaza con 422 y lista las bloqueadas si queda una fila con error no excluida', async () => {
  // sesión con fila A que cuadra y fila B que no cuadra (922 × 66989.90 vs 14804768)
  await expect(service.confirmar({ previewId, ediciones: [] }, certAdmin, cuil, 'Nombre')).rejects.toMatchObject({
    response: { bloqueadas: [expect.objectContaining({ rowId: rowB })] },
  });
});

it('confirmar acepta la fila si viene confirmada=true, y aplica unitario/ítem editados', async () => {
  const r = await service.confirmar({ previewId, ediciones: [{ rowId: rowB, confirmada: true }, { rowId: rowA, precio_unitario: '100', total_mes: '300' }] }, certAdmin, cuil, 'Nombre');
  expect(r.insertadas).toBe(2);
  expect(r.manuales).toBe(0);
  // el INSERT raw incluye la columna origen con 'archivo'
  expect(String(executeRawMock.mock.calls[0][0].strings.join(''))).toContain('origen');
});

it('filas manuales: valida ítem por id, K dentro del claim carga, cuadratura, y las inserta con origen manual', async () => {
  resolucion.cargarItemsPorId.mockResolvedValue(new Map([[77, { id_item: 77, item_codigo: '5', codigo_k: 'K8', id_contrato: 3, tarea: 'Adicional', unidad_medida: 'un', ptos_gasnor: null, tipo: null, contratista: null }]]));
  const r = await service.confirmar({ previewId, ediciones: [], manuales: [{ id_item: 77, provincia: 'Salta', cantidades: '4', precio_unitario: '15151.96', total_mes: '60607.84' }] }, certCargaK8, cuil, 'Nombre');
  expect(r.manuales).toBe(1);
  const sqlTexto = String(executeRawMock.mock.calls[0][0].strings.join(''));
  expect(sqlTexto).toContain('origen');
  expect(prisma.certCargaLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ filasManuales: 1 }) }));
});

it('fila manual de un K fuera del claim carga → 403', async () => {
  resolucion.cargarItemsPorId.mockResolvedValue(new Map([[78, { id_item: 78, item_codigo: '9', codigo_k: 'K2', id_contrato: 1, tarea: 't', unidad_medida: null, ptos_gasnor: null, tipo: null, contratista: null }]]));
  await expect(service.confirmar({ previewId, ediciones: [], manuales: [{ id_item: 78, provincia: 'Salta', cantidades: '1', precio_unitario: '10', total_mes: '10' }] }, certCargaK8, cuil, 'N')).rejects.toBeInstanceOf(ForbiddenException);
});

it('fila manual que no cuadra sin confirmada → 422', async () => {
  resolucion.cargarItemsPorId.mockResolvedValue(new Map([[77, { /* como arriba */ }]]));
  await expect(service.confirmar({ previewId, ediciones: [], manuales: [{ id_item: 77, provincia: 'Salta', cantidades: '4', precio_unitario: '15151.96', total_mes: '999' }] }, certAdmin, cuil, 'N')).rejects.toBeInstanceOf(UnprocessableEntityException);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx jest src/certificaciones/carga/carga.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementación**

`resolucion.service.ts`:
```ts
async cargarItemsPorId(ids: number[]) {
  const mapa = new Map<number, {...}>();
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return mapa;
  const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT di.id_item, di.item_codigo, dc.codigo_k, dc.id_contrato, di.tarea, di.unidad_medida, di.ptos_gasnor, di.tipo, di.contratista
    FROM sth_cert_items di JOIN sth_cert_contratos dc ON di.id_contrato = dc.id_contrato
    WHERE di.id_item IN (${Prisma.join(unicos)})`);
  for (const r of rows) mapa.set(Number(r.id_item), { ...r, id_item: Number(r.id_item), id_contrato: Number(r.id_contrato), ptos_gasnor: r.ptos_gasnor == null ? null : String(r.ptos_gasnor) });
  return mapa;
}
```

`carga.service.ts` — en `confirmar`, paso 3 (ediciones): agregar
```ts
if (edicion.precio_unitario !== undefined) fila.precio_unitario = edicion.precio_unitario;
if (edicion.item_codigo !== undefined) { fila.item_codigo = edicion.item_codigo.trim(); }
if (edicion.confirmada !== undefined) fila.confirmada = edicion.confirmada;
```
Paso 6 (revalidar): `revalidarFila(fila, { itemExiste, provinciasValidas, confirmada: fila.confirmada })` y guardar `fila.cuadratura`.

Nuevo paso 6b — **filas manuales** (antes del filtro de cargables):
```ts
const manualesDto = dto.manuales ?? [];
const itemsPorId = await this.resolucion.cargarItemsPorId(manualesDto.map((m) => m.id_item));
const manuales: FilaPreview[] = [];
for (const m of manualesDto) {
  const it = itemsPorId.get(m.id_item);
  if (!it) throw new BadRequestException(`Ítem del maestro inexistente: ${m.id_item}`);
  if (cert!.nivel === 'carga' && !cert!.ks.includes(it.codigo_k)) throw new ForbiddenException(`No tenés acceso al contrato ${it.codigo_k}`);
  const base: FilaParseada = {
    hoja_origen: 'manual', archivo_origen: sesion.archivo, item_codigo: it.item_codigo, nombre_contrato: null, tarea: it.tarea,
    contrato: it.codigo_k, unidad_medida: it.unidad_medida, ptos_gasnor: it.ptos_gasnor, tipo: it.tipo, contratista: it.contratista,
    provincia: m.provincia.trim(), region: '', cantidades: m.cantidades.trim(), precio_unitario: m.precio_unitario.trim(),
    total_mes: m.total_mes.trim(), observaciones: m.observaciones?.trim() || null, fecha: `${sesion.anio}-${pad2(sesion.mes)}-01`,
    nro_np: null, tiene_error: false, fila_excel: 0,
  };
  const { tieneError, detalle, cuadratura } = revalidarFila(base, { itemExiste: true, provinciasValidas, confirmada: !!m.confirmada });
  manuales.push({ ...base, rowId: `manual-${manuales.length + 1}`, item_en_maestro: true, error_detalle: detalle, tiene_error: tieneError,
    contrato_archivo: it.codigo_k, contrato_fuente: 'maestro', contrato_del_maestro: it.codigo_k, excluida: false, cuadratura, confirmada: !!m.confirmada, origen: 'manual' });
}
```
Paso 7 — **bloqueadas rechazan** (reemplaza la acumulación silenciosa en `errores`):
```ts
const bloqueadas = [...filas, ...manuales].filter((f) => !f.excluida && f.tiene_error).map((f) => ({ rowId: f.rowId, item_codigo: f.item_codigo, detalle: f.error_detalle ?? 'Fila inválida' }));
if (bloqueadas.length > 0) {
  throw new UnprocessableEntityException({ message: `Hay ${bloqueadas.length} ${bloqueadas.length === 1 ? 'fila bloqueada' : 'filas bloqueadas'}. Corregilas, confirmalas o excluilas antes de cargar.`, bloqueadas });
}
const cargables = [...filas, ...manuales].filter((f) => !f.excluida);
```
Paso 8 (permisos carga) sin cambios (cubre manuales). Paso 9: `resolverIds` para las de `origen === 'archivo'`; para manuales usar `it.id_item / it.id_contrato` ya conocidos y resolver solo `id_provincia` (pasarlas también por `resolverIds` es válido y más simple: el ítem se resuelve por código+K igual; elegir eso y documentarlo). Paso 10: el INSERT agrega la columna `origen` al final: `..., cargado_por, origen) VALUES (..., ${nombre}, ${fila.origen})`. `certCargaLog.create` agrega `filasManuales: paraInsertar.filter((p) => p.fila.origen === 'manual').length`. `estado` ahora es siempre `'ok'` salvo errores de resolución de ids (que siguen acumulando en `errores`). Respuesta suma `manuales`.

- [ ] **Step 4: Correr tests**

Run: `npx jest src/certificaciones/carga`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/certificaciones/carga/carga.service.ts src/certificaciones/carga/resolucion.service.ts src/certificaciones/carga/carga.service.spec.ts
git commit -m "feat(cert-carga): confirmar rechaza bloqueadas, acepta 'confirmada', inserta filas manuales con origen"
```

### Task 13: Endpoint de ítems del maestro para filas manuales

**Files:**
- Modify: `src/certificaciones/items.service.ts` (nuevo `listarParaCarga`)
- Modify: `src/certificaciones/certificaciones.controller.ts` (nuevo `GET carga/items-maestro`)
- Modify: `src/certificaciones/items.service.spec.ts`

**Interfaces:**
- Produces: `listarParaCarga(cert: CertClaim | null): Promise<{ id_item: number; item_codigo: string; codigo_k: string; tarea: string; unidad_medida: string | null }[]>` — admin: todos; carga: `codigo_k IN cert.ks`; otro nivel/null: 403.

- [ ] **Step 1: Test que falla**

```ts
it('listarParaCarga: nivel carga solo ve ítems de sus K; lectura → 403', async () => {
  queryRaw.mockResolvedValue([{ id_item: 1n, item_codigo: '5', codigo_k: 'K8', tarea: 'Adicional', unidad_medida: 'un' }]);
  const r = await service.listarParaCarga({ nivel: 'carga', ks: ['K8'], inc: false });
  expect(r).toEqual([{ id_item: 1, item_codigo: '5', codigo_k: 'K8', tarea: 'Adicional', unidad_medida: 'un' }]);
  const sql = queryRaw.mock.calls[0][0];
  expect(sql.strings.join('')).toContain('dc.codigo_k IN');
  await expect(service.listarParaCarga({ nivel: 'lectura', ks: [], inc: false })).rejects.toBeInstanceOf(ForbiddenException);
});
```

- [ ] **Step 2: Correr y ver que falla** — `npx jest src/certificaciones/items.service.spec.ts` → FAIL.

- [ ] **Step 3: Implementación**

```ts
async listarParaCarga(cert: CertClaim | null) {
  if (!cert || (cert.nivel !== 'admin' && cert.nivel !== 'carga')) throw new ForbiddenException('Solo niveles admin y carga pueden cargar certificaciones.');
  if (cert.nivel === 'carga' && cert.ks.length === 0) return [];
  const where = cert.nivel === 'carga' ? Prisma.sql` WHERE dc.codigo_k IN (${Prisma.join(cert.ks)})` : Prisma.empty;
  const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT di.id_item, di.item_codigo, dc.codigo_k, di.tarea, di.unidad_medida
    FROM sth_cert_items di JOIN sth_cert_contratos dc ON di.id_contrato = dc.id_contrato${where}
    ORDER BY dc.codigo_k, di.item_codigo + 0, di.item_codigo`);
  return rows.map((r) => ({ id_item: Number(r.id_item), item_codigo: r.item_codigo, codigo_k: r.codigo_k, tarea: r.tarea, unidad_medida: r.unidad_medida ?? null }));
}
```
Controller (antes de `@Post('carga/confirmar')`):
```ts
@UseGuards(JwtAuthGuard)
@Get('carga/items-maestro')
itemsMaestroCarga(@Req() req: any) {
  return this.itemsService.listarParaCarga(req.user?.cert ?? null);
}
```

- [ ] **Step 4: Correr tests** — `npx jest src/certificaciones` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/certificaciones/items.service.ts src/certificaciones/items.service.spec.ts src/certificaciones/certificaciones.controller.ts
git commit -m "feat(cert-carga): GET carga/items-maestro filtrado por los K del claim"
```

### Task 14: Historial muestra filas manuales

**Files:**
- Modify: `src/certificaciones/carga/historial.service.ts` (`FilaHistorial`, SELECT)
- Modify: `src/certificaciones/carga/historial.service.spec.ts`

- [ ] **Step 1: Test** — el listado devuelve `filas_manuales: number` casteado con `Number(...)`.
- [ ] **Step 2: Implementación** — agregar `filas_manuales` al SELECT y al map (`filas_manuales: Number(r.filas_manuales)`); interfaz `FilaHistorial` suma `filas_manuales: number`.
- [ ] **Step 3: Correr** — `npx jest src/certificaciones/carga/historial.service.spec.ts` → PASS.
- [ ] **Step 4: Commit**

```bash
git add src/certificaciones/carga/historial.service.ts src/certificaciones/carga/historial.service.spec.ts
git commit -m "feat(cert-carga): historial expone filas_manuales"
```

**Cierre Etapa B:** `npm test` verde; `npx tsc --noEmit`. Mostrar al usuario: respuesta de preview real con un PDF de agosto (levantar el backend local contra `testing` con el DDL aplicado y pegar el JSON de `/certificaciones/carga/preview` en la conversación). Con OK → PR → merge. **Deploy junto con el frontend (Etapa C), no antes**: el front actual no manda `confirmada` y con bloqueadas recibiría 422 en vez de "se omiten".

---

# Etapa C — Frontend (repo `Frontend`, rama `feat/cert-carga-controlada`)

### Task 15: Tipos y hooks de la API

**Files:**
- Modify: `src/lib/api/certificaciones.ts` (`FilaPreview`, `ResumenPreviewCarga`, `RespuestaPreviewCarga`, `EdicionFilaCarga`, `RespuestaConfirmarCarga`, nuevo `FilaManualCarga`, `useItemsMaestroCarga`, `useConfirmarCarga`)
- Modify: `src/lib/api/certificaciones.test.tsx`

**Interfaces:**
```ts
export interface CuadraturaFila { calculado: number | null; impreso: number | null; diferencia: number | null; cuadra: boolean; sugerencia_cantidad: string | null }
export interface AvisoCarga { tipo: 'columna_ignorada'|'linea_no_leida'|'sin_total_declarado'|'periodo_archivo'|'k_nombre_archivo'|'np_no_detectado'; hoja: string; fila: number; mensaje: string; fuerte: boolean }
// FilaPreview suma: cuadratura: CuadraturaFila; confirmada: boolean; origen: 'archivo' | 'manual'
// ResumenPreviewCarga suma: bloqueadas: number
// RespuestaPreviewCarga suma: avisos: AvisoCarga[]; columnas_ignoradas: string[]; periodo_archivo: { desde: string; hasta: string } | null; k_nombre_archivo: string | null
// EdicionFilaCarga suma: precio_unitario?: string; item_codigo?: string; confirmada?: boolean
export interface FilaManualCarga { id_item: number; provincia: string; cantidades: string; precio_unitario: string; total_mes: string; observaciones?: string; confirmada?: boolean }
export interface ItemMaestroCarga { id_item: number; item_codigo: string; codigo_k: string; tarea: string; unidad_medida: string | null }
export function useItemsMaestroCarga(habilitado: boolean): UseQueryResult<ItemMaestroCarga[]>  // GET /certificaciones/carga/items-maestro, queryKey ['certificaciones','carga','items-maestro']
// useConfirmarCarga: mutationFn recibe { previewId, ediciones, manuales }
// RespuestaConfirmarCarga suma: manuales: number
```

- [ ] **Step 1: Test** en `certificaciones.test.tsx` (patrón existente de hooks con `api` mockeado): `useItemsMaestroCarga(true)` pega a `/certificaciones/carga/items-maestro`; `useConfirmarCarga` envía `manuales` en el body.
- [ ] **Step 2: Correr** — `npx vitest run src/lib/api/certificaciones.test.tsx` → FAIL.
- [ ] **Step 3: Implementar** tipos y hooks.
- [ ] **Step 4: Correr** — PASS. `npx tsc --noEmit` va a fallar en `page.tsx`/tests por los campos nuevos obligatorios en `FilaPreview`: arreglar `filaBase` de `carga-page.test.tsx` agregando `cuadratura: { calculado: 300, impreso: 300, diferencia: 0, cuadra: true, sugerencia_cantidad: null }, confirmada: false, origen: 'archivo'` y `precio_unitario: '100'`, `cantidades: '3'`, `total_mes: '300'`.
- [ ] **Step 5: Commit**

```bash
git add src/lib/api/certificaciones.ts src/lib/api/certificaciones.test.tsx "src/app/(protected)/certificaciones/carga/carga-page.test.tsx"
git commit -m "feat(cert-carga): tipos de cuadratura, avisos, filas manuales y hook de ítems del maestro"
```

### Task 16: Espejo de la cuadratura en `revalidar.ts`

**Files:**
- Modify: `src/features/certificaciones/carga/revalidar.ts`
- Modify: `src/features/certificaciones/carga/revalidar.test.ts`

**Interfaces:** idénticas a Task 7 (`cuadraturaFila`, `TOLERANCIA_CUADRATURA`, `revalidarFila` con `opts.confirmada` y retorno `cuadratura`); `FilaRevalidable` suma `precio_unitario: string | null`. Mismos textos exactos.

- [ ] **Step 1: Tests** — copiar los casos de Task 7 a Vitest (`describe/it/expect` de vitest), incluyendo el texto exacto `'No cuadra: 922 × 66989.90 = 61764687.80, impreso 14804768 (dif. $ 46959919.80)'` y `'Falta $ unitario (no se puede cuadrar)'`.
- [ ] **Step 2: Correr** — FAIL.
- [ ] **Step 3: Implementar** — mismo código que Task 7, con `num()` tolerante a coma (ya existe acá).
- [ ] **Step 4: Correr** — PASS.
- [ ] **Step 5: Commit**

```bash
git add src/features/certificaciones/carga/revalidar.ts src/features/certificaciones/carga/revalidar.test.ts
git commit -m "feat(cert-carga): espejo client-side de la cuadratura por fila"
```

### Task 17: Paso 3 según el mockup

**Files:**
- Modify: `src/app/(protected)/certificaciones/carga/page.tsx`
- Create: `src/app/(protected)/certificaciones/carga/fila-manual-form.tsx`
- Create: `src/app/(protected)/certificaciones/carga/fila-manual-form.test.tsx`
- Modify: `src/app/(protected)/certificaciones/carga/carga-page.test.tsx`

**Interfaces:**
- `FilaManualForm` props: `{ items: ItemMaestroCarga[]; provincias: string[]; onAgregar: (m: FilaManualCarga & { item: ItemMaestroCarga }) => void; onCancelar: () => void }`. Total propuesto = cantidad × unitario (recalcula al tipear cualquiera de los dos, formateado con 2 decimales, editable).
- Estado nuevo en la página: `manuales: (FilaManualCarga & { item: ItemMaestroCarga; localId: string })[]`; `mostrarFormManual: boolean`.
- `aplicarEdicion` suma `precio_unitario`, `item_codigo`, `confirmada`.
- Clases nuevas: `BADGE_BLOQUEADA = 'inline-flex items-center rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger ring-1 ring-inset ring-danger/25'`, `BADGE_MANUAL = '... bg-[#3b6fc4]/10 text-[#3b6fc4] ring-[#3b6fc4]/25'`.

- [ ] **Step 1: Tests de página que fallan** (agregar a `carga-page.test.tsx`, patrón existente con `usePreviewCarga` mockeado; agregar `useItemsMaestroCarga` al `vi.mock` devolviendo `{ data: [...] }`)

```ts
it('fila que no cuadra: badge "No cuadra", tile Bloqueadas = 1 y Confirmar deshabilitado con motivo', async () => {
  // preview con fila 922 × 66989.90 vs 14804768 (cuadratura.cuadra false, tiene_error true, error_detalle 'No cuadra: ...')
  ...
  expect(screen.getByTestId('metrica-bloqueadas')).toHaveTextContent('1');
  expect(screen.getByRole('button', { name: /confirmar carga/i })).toBeDisabled();
  expect(screen.getByText(/hay 1 fila bloqueada/i)).toBeInTheDocument();
});

it('"Usar cantidad 221" corrige la fila y la desbloquea', async () => {
  await user.click(screen.getByRole('button', { name: /detalle/i }));
  await user.click(screen.getByRole('button', { name: /usar cantidad 221/i }));
  expect(screen.getByTestId('metrica-bloqueadas')).toHaveTextContent('0');
  expect(screen.getByRole('button', { name: /confirmar carga/i })).toBeEnabled();
});

it('"Confirmar así" desbloquea y manda confirmada: true al confirmar', async () => {
  ...
  expect(useConfirmarCargaMutate).toHaveBeenCalledWith(expect.objectContaining({ ediciones: expect.arrayContaining([expect.objectContaining({ rowId: 'row-1', confirmada: true })]) }));
});

it('cartel rojo de descuadre contra el total declarado deja confirmar', async () => {
  // total_declarado 22535209.93; filas suman 22474602.04
  expect(screen.getByTestId('aviso-descuadre')).toHaveTextContent('faltan $ 60.607,89');
  expect(screen.getByRole('button', { name: /confirmar carga/i })).toBeEnabled();
});

it('avisos de lectura: columna ignorada y período (fuerte) se muestran', async () => {
  expect(screen.getByText(/columna ignorada: cuenta/i)).toBeInTheDocument();
  expect(screen.getByTestId('avisos-fuertes')).toHaveTextContent(/elegiste agosto 2026/i);
});

it('fila manual: elegir ítem, completar, total propuesto, suma en cuadratura y viaja en manuales', async () => {
  await user.click(screen.getByRole('button', { name: /agregar fila manual/i }));
  await user.selectOptions(screen.getByLabelText(/ítem del maestro/i), '77');
  await user.type(screen.getByLabelText(/^cantidad$/i), '4');
  await user.type(screen.getByLabelText(/unitario/i), '15151,96');
  expect(screen.getByLabelText(/^\$ total$/i)).toHaveValue('60607.84');
  await user.click(screen.getByRole('button', { name: /^agregar$/i }));
  expect(screen.getByTestId('metrica-manuales')).toHaveTextContent('1');
  expect(screen.getAllByText('Manual')).toHaveLength(1);
  // confirmar → body.manuales[0] = { id_item: 77, provincia: 'Salta', cantidades: '4', precio_unitario: '15151.96', total_mes: '60607.84' }
});

it('422 con bloqueadas del backend: toast con el mensaje y las filas quedan marcadas', async () => { ... });
```

- [ ] **Step 2: Correr** — `npx vitest run "src/app/(protected)/certificaciones/carga"` → FAIL.

- [ ] **Step 3: Implementar la página**

Cambios concretos en `page.tsx` (referencias a la estructura actual):
1. **Tiles** (bloque `grid grid-cols-2 gap-3.5 lg:grid-cols-4` → `lg:grid-cols-5`): "A cargar" (`metrica-a-cargar`), "Bloqueadas" (`metrica-bloqueadas`, tone `danger` si > 0, sub `corregila o excluila` / `corregilas o excluilas`), "Manuales" (`metrica-manuales`, sub `agregadas por vos`), "Excluidas", "Total a cargar" (sub `declara $ X` o `el archivo no declara un total`). Eliminar el tile "Con problema".
2. **Cartel rojo de cuadratura** (reemplaza el aviso ámbar actual de descuadre): borde `border-danger/45 bg-danger/5 text-danger`, título `La suma no cierra con el total declarado: faltan/sobran $ D`, cuerpo `El archivo declara $ T y las filas a cargar suman $ S (las bloqueadas no cuentan). Podés confirmar igual, pero revisá si el parser perdió una fila y agregala a mano si hace falta.` Condición: `totalDeclarado !== null && Math.abs(diferencia) > 1`. Incluir manuales en `montoACargar`. `data-testid="aviso-descuadre"`.
3. **Avisos fuertes** (`data-testid="avisos-fuertes"`): `preview.avisos.filter(a => a.fuerte)` en el mismo estilo rojo, uno por línea. **Panel ámbar "Avisos de lectura"**: `preview.avisos.filter(a => !a.fuerte)` + `preview.errores` (los de parseo que ya existían) en lista.
4. **Tabla**: columnas `Cargar | Ítem | Contrato | Provincia | Cant. | $ Unitario | $ Total | Estado | (detalle)`. Ítem y $ Unitario pasan a `<input>` (con `setEdicionCampo(rowId, 'item_codigo' | 'precio_unitario', v)`; el ítem editado también recalcula `item_en_maestro`?: NO se puede en el cliente sin maestro → mantener `item_en_maestro` del server y agregar en el detalle `El ítem editado se verifica al confirmar`). Estado: `excluida` → "Excluida"; `origen === 'manual'` → "Manual" (`BADGE_MANUAL`); `tieneError` → `BADGE_BLOQUEADA` con texto `No cuadra` si el detalle empieza con `No cuadra` o `Falta $ unitario`, si no `Bloqueada`; `vista.confirmada && !cuadra` → "Confirmada así" (`BADGE_WARN`); resto → "Cuadra" (`BADGE_OK`).
5. **Fila expandida**: además de Hoja/Fila del archivo, mostrar Tarea, Observaciones, y un bloque **Cuadratura** con las tres cifras: `${cant} × ${unit} = ${calc} · impreso ${impreso} · diferencia $ ${dif}` (tabular-nums). Si bloqueada por cuadratura: botones `Usar cantidad N` (si `sugerencia_cantidad`; hace `setEdicionCampo(rowId, 'cantidades', N)`), `Confirmar así` (`setEdicionCampo(rowId, 'confirmada', true)`), `Excluir fila` (`setExcluida(rowId, true)`). Si el aviso `k_nombre_archivo` existe y la fila tiene `contrato !== k_nombre_archivo`: línea `El nombre del archivo dice K11 · esta fila se resolvió en K2 · si la plata va a K11, cambiá el contrato arriba.`
6. **Filas manuales**: botón `+ Agregar fila manual` en la barra de la tabla (habilitado si `preview` existe). Abre `<FilaManualForm items={itemsMaestro} provincias={provinciasValidas} onAgregar onCancelar/>`. Las manuales se renderizan al final de la tabla con `origen: 'manual'`, mismas celdas (ítem/contrato no editables, cantidad/unitario/total sí), botón `Quitar` en vez de checkbox. Se revalidan con `revalidarFila` del cliente igual que las demás y cuentan en `bloqueadas`, `aCargar`, `montoACargar`.
7. **Confirmar**: `disabled={bloqueadas > 0 || aCargar + manualesOk === 0}`; debajo `<span class="text-[13px] text-danger">No podés confirmar: hay N filas bloqueadas. Corregilas, confirmalas o excluilas.</span>`. El payload suma `manuales: manuales.map(({ item, localId, ...m }) => m)`. En el `catch`, si `e.response.status === 422 && e.response.data.bloqueadas`, toast con `message` y marcar `expandidas` con esos `rowId`.
8. **Paso 4 (resultado)**: agregar `manuales` al resumen (`N filas cargadas (M manuales)`).
9. Actualizar la `TarjetaGuia` del paso 1: texto `"Ves qué cuadra y qué no, corregís cantidad, unitario, total, contrato o provincia, y agregás a mano lo que el archivo no dejó leer."`

`fila-manual-form.tsx`: `<select>` de ítems (`${codigo_k} · ${item_codigo} · ${tarea}`), `<select>` provincia, inputs cantidad/unitario/total (`inputMode="decimal"`, coma→punto con `normalizarDecimal`), total propuesto recalculado con `useEffect` sobre cantidad/unitario salvo que el usuario haya tocado el total (`totalTocado` flag), hint `propuesto: cantidad × unitario`, botones `Agregar` (disabled si falta ítem/provincia/cantidad/unitario) y `Cancelar`.

- [ ] **Step 4: Correr** — `npx vitest run` (todo el front) → PASS; `npx tsc --noEmit` → OK; `npm run lint` → OK.

- [ ] **Step 5: Verificar visualmente** con el skill `run` (levantar front + back local contra `testing`, subir `CERTIFICADOS SERTEC (K8) -agosto 26 -Capex.pdf`, período agosto 2026) y comparar con el mockup. Captura para el usuario.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(protected)/certificaciones/carga/page.tsx" "src/app/(protected)/certificaciones/carga/fila-manual-form.tsx" "src/app/(protected)/certificaciones/carga/fila-manual-form.test.tsx" "src/app/(protected)/certificaciones/carga/carga-page.test.tsx"
git commit -m "feat(cert-carga): paso 3 con cuadratura, bloqueadas, avisos de lectura y filas manuales (mockup 2026-09-07)"
```

### Task 18: Historial muestra manuales

**Files:**
- Modify: `src/app/(protected)/certificaciones/historial/page.tsx` (celda Filas)
- Modify: `src/app/(protected)/certificaciones/historial/historial-page.test.tsx`
- Modify: `src/lib/api/certificaciones.ts` (`FilaHistorialCarga` suma `filas_manuales: number`)

- [ ] **Step 1: Test** — con `filas_manuales: 2` la celda muestra `2 manuales` en `text-[#3b6fc4]`.
- [ ] **Step 2: Implementar** — junto a `{c.filas_error > 0 && ...}` agregar `{c.filas_manuales > 0 && <span className="ml-1 text-xs text-[#3b6fc4]">{c.filas_manuales} {c.filas_manuales === 1 ? 'manual' : 'manuales'}</span>}`.
- [ ] **Step 3: Correr** — PASS.
- [ ] **Step 4: Commit**

```bash
git add "src/app/(protected)/certificaciones/historial/page.tsx" "src/app/(protected)/certificaciones/historial/historial-page.test.tsx" src/lib/api/certificaciones.ts
git commit -m "feat(cert-carga): historial indica filas manuales"
```

**Cierre Etapa C:** mostrar captura al usuario; con OK → PR front → merge.

---

# Etapa D — Deploy y documentación (solo con pedido explícito del usuario)

### Task 19: Deploy coordinado back + front y DDL en producción

- [ ] **Step 1:** SSH al VPS (`ssh -i ~/.ssh/forms_horas_vps2 coworker@179.198.99.30`). Backup de `sth_cert_cargas_log` y `sth_cert_certificaciones` (mysqldump a `/var/www/backups/cert-2026-09-XX.sql`).
- [ ] **Step 2:** Aplicar `docs/sql/2026-09-07-cert-origen-y-filas-manuales.sql` en `Horas_Sertec` (y en `testing` si no se hizo). Verificar con los SELECT del archivo.
- [ ] **Step 3:** Deploy backend (pull main, `npm ci`, `npx prisma generate`, build, `pm2 restart` — 1 worker), luego frontend (pull, build, restart). Probar `/certificaciones/carga/preview` con el K8 Capex de agosto: 8 filas, 0 bloqueadas, cartel de total en verde (suma = declarado).
- [ ] **Step 4:** Doc de deploy `docs/2026-09-XX-cert-carga-controlada-deploy.md` (patrón de `docs/2026-09-02-erp-etapa4-deploy.md`).

### Task 20: Contexto y memoria

- [ ] **Step 1:** Sección nueva en `docs/contexto-proyecto.md` (§83): decisiones, PRs, DDL, trampas encontradas (pdfjs items como frases, montos sin centavos, CUENTA).
- [ ] **Step 2:** Actualizar memoria `carga-certificaciones-controlada.md` → estado EN PRODUCCIÓN + fecha; el portal viejo sigue como backup (sin cambios).
- [ ] **Step 3:** Pedir al usuario la prueba manual en producción con los 4 PDFs de agosto y una carga chica + deshacer.

---

## Self-review (hecho al escribir)

- **Cobertura del spec:** §2.1 → Tasks 7/11/12/16/17; §2.2 → 17 (cartel) + 5/6 (`sin_total_declarado`); §2.3 → 1; §2.4 → 3/6; §2.5 → 4; §2.6 → 11 (aviso) + 17 (detalle); §2.7 → 5/6/11; §2.8 → 10/12/13/15/17; §2.9 → 12/17; §2.10 → 6/7/11 comunes; §3 contrato → 2/10/11/12/15; §4 DDL → 9/19; §6 → 8/17.
- **Consistencia de nombres:** `cuadraturaFila`, `TOLERANCIA_CUADRATURA`, `revalidarFila(...opts.confirmada)`, `construirCabecera`, `COLUMNAS_REQUERIDAS`, `extraerKDeNombre`, `parsearMontoTexto`/`montoANumero`, `avisoKNombre`/`avisoPeriodo`, `listarParaCarga`, `cargarItemsPorId`, `useItemsMaestroCarga`, `FilaManualCarga`/`FilaManualDto` usados igual en todas las tareas.
- **Riesgos conocidos:** (a) `dividirEnPalabras` reparte x0 por proporción de caracteres: el test real de K11 (Task 8) es el que confirma que 922 y 221 caen en columnas distintas; si falla, ajustar el `+5` de los límites en `construirCabecera` a `+2`. (b) Al exigir unitario para cuadrar, archivos viejos sin unitario bloquearán todas sus filas: es la decisión 1 del usuario; "Confirmar así" es la salida.
