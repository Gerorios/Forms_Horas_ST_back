# ERP Etapa 4 — Carga de certificaciones en NestJS/React — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El flujo completo de carga de certificaciones (upload Excel/PDF → preview editable → confirmación → escritura en `sth_cert_certificaciones` + `sth_cert_cargas_log`, con historial y deshacer) vive en la app de Horas; el upload del portal queda redundante.

**Architecture:** Parsers puros en TS (Excel con exceljs, PDF con pdfjs-dist) que calcan las reglas del portal; validación/resolución de contrato como funciones puras + un `CargaService` server-authoritative: el preview guarda las filas parseadas en un store en memoria (proceso único PM2, precedente del cache de incidencia) con `rowId` y owner por cuil del claim, y el confirmar acepta SOLO los campos editables por `rowId`, revalida todo server-side (incluida la existencia del ítem, bug B2 del portal) y escribe facts + log en UNA transacción. Frontend: wizard de 4 pasos + pantalla de historial con deshacer (admin).

**Tech Stack:** NestJS + Prisma (raw para la fact, modelo para el log), multer, exceljs, pdfjs-dist, class-validator; Next.js + react-query; Jest / Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-unificacion-erp-certificaciones-design.md` (§5 etapa 4; OneDrive RESUELTO: eliminado, sin copia).
**Referencia obligatoria:** `docs/superpowers/specs/2026-09-02-inventario-carga-portal.md` (reglas exactas, shapes y bugs B1..B16) + los fuentes Python del portal citados ahí (la verdad última al portar).

## Global Constraints

- **Paridad de negocio** (idéntico al portal, verificable contra los fuentes): reglas del parser Excel (§2 del inventario: COL_ALIAS con prioridad de aliases, header por ÍTEMS, meta de 13 filas, fmt_num/fmt_item/get, provincia .title(), contrato K-prefijo, region por hoja, `_es_item_valido`), parser PDF (§3: columnas por x0, líneas por top/4, footer, pegado de números, `_limpiar_num`, PROVINCIAS dict), regla de fila cargable y de plantilla (§4, con los TEXTOS exactos de faltas), resolución de contrato editado>maestro>archivo con desempate por id_item (§5), fallback de ptos_gasnor archivo>maestro>null, fecha = `YYYY-MM-01` del período de la UI, duplicado por `archivo_nombre` con los dos mensajes según nivel, deshacer por (archivo_origen, período), numéricos como STRING del parser al INSERT (raw SQL; MySQL castea — paridad B14), multi-contrato por archivo, cascada de edición de contrato por item_codigo en la UI, aviso no bloqueante de descuadre vs total_declarado (tolerancia 0.01).
- **Fixes conscientes** (todos con test): B1 owner del preview = cuil del claim; B2 item_existe revalidado server-side en batch al confirmar; B4 número de fila = fila REAL del Excel; B5 errores de carga con {hoja, fila, item_codigo, mensaje} y SIN truncar a 10; B6 mapeo de columnas por ÍNDICE resuelto una vez; B7 DDL: `sth_cert_cargas_log.contrato` → VARCHAR(60) (script one-off a las DOS bases); B8 confirmar server-authoritative (solo `contrato, provincia, cantidades, total_mes, excluida` editables, por rowId); B10 facts+log en UNA transacción Prisma; B11 DTOs class-validator (nada de JSON en form fields); B15 límite 20 MB vía multer `limits.fileSize` (rechaza antes de bufferizar de más); detalle_errores como JSON real; N+1 del preview resuelto con 2 queries batch (ítems del archivo + contratos del maestro).
- **Permisos por claim `cert`**: preview/confirmar → nivel `admin` o `carga` (lectura 403 "Solo niveles admin y carga pueden cargar certificaciones."); nivel carga: los contratos RESUELTOS deben ⊆ sus Ks, validado ANTES de insertar (403 con el K ofensor). Historial: admin/lectura ven todas (100), carga ve las propias (50, por cuil). Deshacer: solo admin.
- **Desvío consciente**: `.xls` legacy NO soportado (exceljs no lo lee) → 400 "Formato .xls no soportado: convertí el archivo a .xlsx." `.xlsx`/`.xlsm` → exceljs; `.pdf` → pdfjs-dist; otra extensión → 400.
- Preview store: Map en memoria TTL 30 min (PM2 proceso único — mismo precedente que el cache de incidencia), SIN bytes del archivo (OneDrive eliminado), clave uuid + owner cuil; "La sesión expiró (30 minutos). Volvé a subir el archivo." al vencer.
- SQL con bind params; NUNCA prisma migrate dev; DDL one-off a las dos bases; TDD estricto; deploy solo explícito con aviso pre-restart; tablas del frontend sin scroll horizontal.
- El portal sigue operativo vía vistas: nada de lo nuevo rompe sus INSERT (el DDL de B7 es ensanchar, compatible).

---

### Task 1: Parser Excel (puro TS)

**Files:** Create `src/certificaciones/carga/parser-excel.ts`, `src/certificaciones/carga/parser-tipos.ts`; Test `src/certificaciones/carga/parser-excel.spec.ts`.

**Interfaces (produce — las consumen T2-T6):**

```ts
// parser-tipos.ts
export interface FilaParseada {
  hoja_origen: string;
  archivo_origen: string;
  item_codigo: string;          // fmt_item aplicado (Excel); crudo en PDF
  nombre_contrato: string | null;
  tarea: string | null;
  contrato: string;             // upper, K-prefijado, fallback meta.k_gasnor, "" si nada
  unidad_medida: string | null;
  ptos_gasnor: string | null;   // STRING numérica normalizada (fmt_num) o null
  tipo: string | null;
  contratista: string | null;
  provincia: string;            // .title() o "" (Excel); dict PROVINCIAS en PDF
  region: string;               // "Norte" | "Sur" | ""
  cantidades: string | null;
  precio_unitario: string | null;
  total_mes: string | null;
  observaciones: string | null;
  fecha: string;                // "YYYY-MM-01" del período de la UI
  nro_np: string | null;
  tiene_error: boolean;         // solo "contrato no detectado" (Excel); + provincia vacía (PDF)
  fila_excel: number;           // fix B4: fila REAL en el archivo (1-based)
}
export interface ErrorParseo { hoja: string; fila: number; campo: string; mensaje: string }
export interface ResultadoParseo {
  archivo: string; hojas: string[]; filas: FilaParseada[];
  errores: ErrorParseo[]; periodo: string; total_declarado: number | null;
}
export function parsearExcel(contenido: Buffer, nombreArchivo: string, anio: number, mes: number): Promise<ResultadoParseo>;
```

- [ ] **Step 1**: Leer `docs/superpowers/specs/2026-09-02-inventario-carga-portal.md` §2 y el fuente `app/services/parser.py` del portal (ruta en el doc) — es la especificación a transcribir. Revisar también `tests/` del portal: si hay tests o fixtures del parser, portar sus casos.
- [ ] **Step 2 (RED)**: spec con fixtures construidas EN el test con exceljs (writer), cubriendo como mínimo estos casos con valores exactos:
  1. Hoja "CERTIF K8 NORTE" con header en la fila 5 y aliases mezclados ("ÍTEMS", "$ TOTAL MES", "UM") → columnas mapeadas; region "Norte"; k_gasnor "K8" del nombre de hoja.
  2. Números es-AR: total "1.234,56" → "1234.56"; "$ 39.072.433,92" en la meta TOTAL MES → total_declarado 39072433.92; cantidad "3,5" → "3.5".
  3. fmt_item: 431.0 (float de celda) → "431"; "431,2" → "431.2"; "116-a" → "116-a"; celda vacía → fila descartada por `_es_item_valido`.
  4. Fila de subtotal "TOTAL:" descartada; header repetido ("ÍTEMS") descartado.
  5. `fila_excel` correcto tras descartes (B4): con datos en filas 6,7(descartada),8 → las filas devueltas reportan 6 y 8.
  6. Headers duplicados (dos columnas "TOTAL") → el mapeo por índice toma la PRIMERA y no corrompe valores (B6).
  7. Contrato: celda "8" → "K8"; celda vacía con hoja "CERTIF K12 SUR" → "K12" de la meta; sin nada → tiene_error true + error "Contrato K no detectado.".
  8. "Cantidad es 0." se anota en errores pero tiene_error queda false.
  9. Hojas: libro con "CERTIF K8", "Resumen" → solo la primera; libro sin hojas CERTIF* → todas.
  10. Meta NRO NP: fila con "NRO. DE NP" y valor al lado → nro_np.
  11. provincia "salta" → "Salta"; literales "NAN"/"#N/A" → null.
- [ ] **Step 3 (GREEN)**: implementar `parsearExcel` transcribiendo parser.py con las reglas del inventario. Mapeo de columnas por índice (B6). `.xlsx`/`.xlsm` con exceljs; si exceljs no puede abrir → `ResultadoParseo` con error "No se pudo abrir el archivo: ..." (paridad).
- [ ] **Step 4**: `npx jest src/certificaciones/carga` + `npx tsc --noEmit` en verde. **Step 5**: Commit `feat(certificaciones): parser Excel de certificaciones (port de parser.py)`.

---

### Task 2: Parser PDF (puro TS)

**Files:** Create `src/certificaciones/carga/parser-pdf.ts`; Test `src/certificaciones/carga/parser-pdf.spec.ts`. Dependencia nueva: `pdfjs-dist` (agregar a package.json).

**Interfaces:** `parsearPdf(contenido: Buffer, nombreArchivo: string, anio: number, mes: number): Promise<ResultadoParseo>` — mismo shape que T1; `hojas = [nombreArchivo]`, `nombre_contrato = null`, `region = ""`, provincia vacía SÍ marca tiene_error, item_codigo SIN fmt_item, `_es_item_valido` PDF = `^[A-Za-z]?\d{3,}`.

- [ ] **Step 1**: leer inventario §3 + fuente `parser_pdf.py`. La estrategia: separar el algoritmo puro (funciones que reciben `PalabraPosicionada { text, x0, top, width }[]` y devuelven filas) de la extracción con pdfjs-dist (`getTextContent` → transform[4]=x, transform[5]=y — OJO: y de pdfjs crece hacia arriba; convertir a `top = alturaPagina - y` para calcar la semántica de pdfplumber).
- [ ] **Step 2 (RED)**: tests del algoritmo puro con palabras posicionadas sintéticas (sin PDF real): detección de columnas por x0 con límites a mitad de camino; agrupado por top/4; fila multilínea (tarea "juntar", numéricos "primero"); footer "FIRMA" corta; pegado "9"+".338,22" → "9.338,22" (gap<8); `_limpiar_num("$ 1.234,56 extra")` → "1234.56"; provincia "tucuman" → "Tucumán" y contratista con provincia pegada limpiado; total_declarado con monto partido.
- [ ] **Step 3 (GREEN)**: implementar; wrapper pdfjs-dist con 1 test de integración generando un PDF simple en el test (con pdf-lib o similar de devDependency) o, si resulta frágil, el wrapper queda cubierto por typecheck + el smoke del deploy (decidirlo y documentarlo en el reporte).
- [ ] **Step 4**: suite + tsc verdes. **Step 5**: Commit `feat(certificaciones): parser PDF de certificaciones (port de parser_pdf.py)`.

---

### Task 3: Validación y resolución de contrato

**Files:** Create `src/certificaciones/carga/validacion.ts` (puro), `src/certificaciones/carga/resolucion.service.ts`; Tests homónimos `.spec.ts`.

**Interfaces (produce):**

```ts
// validacion.ts (puro — textos de faltas EXACTOS del inventario §4)
export function esFilaPlantilla(f: { cantidades: string | null; total_mes: string | null }): boolean;
export function revalidarFila(f: FilaParseada, opts: { itemExiste: boolean; provinciasValidas: string[] }): { tieneError: boolean; detalle: string | null };
export function filtrarVisiblesPreview(filas: FilaParseada[]): FilaParseada[];

// resolucion.service.ts (Prisma; batch, sin N+1)
export interface MapaMaestro {
  // clave: item_codigo normalizado con REPLACE .→, ; valor: Ks ordenados por id_item
  contratosPorItem: Map<string, string[]>;
  existe(codigo: string): boolean;
}
export class ResolucionService {
  cargarMaestro(codigos: string[]): Promise<MapaMaestro>;      // 1 query batch
  resolverContratoFinal(mapa: MapaMaestro, itemCodigo: string, contratoArchivo: string | null, contratoEditado?: string | null): { contrato: string | null; fuente: 'editado' | 'maestro' | 'archivo' };
  resolverIds(filas: ...): ...; // id_item (código+K, fallback cualquier K por menor id_item), id_contrato por K, id_provincia UPPER=UPPER, ptos_gasnor con fallback al maestro — todo con queries batch
}
```

- [ ] **Step 1 (RED)**: tests puros de validación (plantilla: cant 0 y total null → true; cant "3" → false; unitario solo NO cuenta) y de resolución con MapaMaestro sintético (editado gana; maestro con archivo coincidente; maestro con desempate por PRIMER K en orden id_item; archivo solo si no está en maestro) + textos de faltas exactos.
- [ ] **Step 2 (GREEN)**: implementar; `cargarMaestro` con `WHERE REPLACE(item_codigo,'.',',') IN (...)` bindeado + JOIN a contratos `ORDER BY id_item`. **Step 3**: suite + tsc. **Step 4**: Commit `feat(certificaciones): validacion y resolucion de contrato de la carga`.

---

### Task 4: Preview store + CargaService (preview y confirmar server-authoritative)

**Files:** Create `src/certificaciones/carga/preview-store.ts`, `src/certificaciones/carga/carga.service.ts`, `src/certificaciones/dto/carga.dto.ts`; Modify `prisma/schema.prisma` (modelo `CertCargaLog` @@map sth_cert_cargas_log — columnas del inventario/DDL real: verificar con SHOW CREATE como en etapa 3), `certificaciones.module.ts`; Tests `carga.service.spec.ts`, `preview-store.spec.ts`. Create `docs/sql/2026-09-02-cargas-log-contrato.sql` (B7: `ALTER TABLE sth_cert_cargas_log MODIFY contrato VARCHAR(60) NULL;` — comentado con instrucciones: correr en las DOS bases en el deploy).

**Interfaces (produce):**

```ts
// preview-store.ts — Map en memoria, TTL 30 min, sin bytes
export interface PreviewSession {
  id: string; ownerCuil: string; archivo: string; anio: number; mes: number;
  filas: Map<string, FilaPreview>;   // rowId → fila (FilaParseada + anotaciones)
  creadaEn: number;
}
export interface FilaPreview extends FilaParseada {
  rowId: string; item_en_maestro: boolean; error_detalle: string | null;
  contrato_archivo: string; contrato_fuente: 'editado' | 'maestro' | 'archivo'; contrato_del_maestro: string | null;
}
export class PreviewStore { guardar(s): string; recuperar(id, ownerCuil): PreviewSession | null; limpiar(id): void }

// carga.dto.ts
export class EdicionFilaDto { rowId: string (uuid); contrato?: string; provincia?: string; cantidades?: string; total_mes?: string; excluida?: boolean }
export class ConfirmarCargaDto { previewId: string (uuid); @ValidateNested @ArrayMaxSize(5000) ediciones: EdicionFilaDto[] }

// carga.service.ts
preview(contenido, nombreArchivo, anio, mes, cert): Promise<RespuestaPreview>  // nivel admin|carga
confirmar(dto: ConfirmarCargaDto, cert, cuil): Promise<RespuestaConfirmar>
// RespuestaPreview = { previewId, archivo, hojas, periodo, resumen{total, con_error, total_mes, total_declarado}, filas: FilaPreview[], errores: ErrorParseo[] }
// RespuestaConfirmar = { mensaje, insertadas, omitidas, errores: {hoja, fila, item_codigo, mensaje}[] }  // sin truncar
```

Reglas del confirmar (en este orden): sesión (400 expiró / mismo mensaje del portal) → ownership por cuil → aplicar ediciones sobre las filas del store (SOLO los 5 campos del DTO; rowId desconocido → 400) → duplicado por `archivo_nombre` en `sth_cert_cargas_log` (mensajes exactos del portal según nivel admin/no-admin) → re-resolver contrato (`anotar_contrato_final` con ediciones) → revalidar TODO server-side (batch de maestro: item_existe incluido — B2; provincias activas) → filtrar cargables (excluida + revalidación) → permisos nivel carga: Ks resueltos ⊆ cert.ks ANTES de insertar (403 "No tenés acceso al contrato {K}") → 422 "No hay filas válidas para cargar" si vacío → resolver ids batch → **UNA transacción**: multi-INSERT raw a `sth_cert_certificaciones` (18 columnas del inventario §5, fecha como string 'YYYY-MM-01' — nunca Date JS) + create de `CertCargaLog` (contrato CSV, estado ok|parcial, detalle_errores JSON.stringify truncado a 2000) → limpiar sesión → respuesta.

- [ ] **Step 1**: verificar DDL real de `sth_cert_cargas_log` (script one-off, patrón etapa 3) y calcar el modelo. **Step 2 (RED)**: tests del store (TTL vencido → null; owner distinto → null) y del service con Prisma mockeado: expiración, ownership por cuil (B1), duplicado con ambos mensajes, edición de campo NO editable ignorada por el DTO (whitelist), item inexistente al confirmar → fila omitida CON contexto {hoja, fila, item_codigo} (B2+B5), permisos carga fail-closed antes del insert, transacción única ($transaction llamado 1 vez con inserts+log), plantillas nunca insertadas, ptos_gasnor fallback maestro, estado parcial cuando hay omitidas.
- [ ] **Step 3 (GREEN)** → **Step 4**: suite módulo + tsc. **Step 5**: Commit `feat(certificaciones): preview store y servicio de carga server-authoritative`.

---

### Task 5: Endpoints de carga + historial + deshacer

**Files:** Modify `certificaciones.controller.ts` (+`certificaciones.module.ts` si hace falta), Create `src/certificaciones/carga/historial.service.ts` + spec.

**Rutas (produce — las consume T6/T7):**
- `POST /certificaciones/carga/preview` — multipart (`FileInterceptor('archivo')` con multer `limits: { fileSize: 20 * 1024 * 1024 }`; campos `periodo_anio`, `periodo_mes` validados 2022..2100 / 1..12); extensión: .xlsx/.xlsm → excel, .pdf → pdf, .xls → 400 convertí, resto → 400. Claim como el resto del módulo.
- `POST /certificaciones/carga/confirmar` — JSON `ConfirmarCargaDto`.
- `GET /certificaciones/carga/historial` — admin/lectura: 100 últimas de todos; carga: 50 propias por cuil. Shape: `{ id, usuario_nombre, archivo_nombre, contrato, periodo, filas_cargadas, filas_error, estado, cargado_en (YYYY-MM-DD HH:mm) }` — cargado_en formateado con DATE_FORMAT en SQL (lección timezone).
- `DELETE /certificaciones/carga/:logId` — solo nivel admin; paridad del portal: borra fact por `(archivo_origen = log.archivo_nombre AND DATE_FORMAT(fecha,'%Y-%m') = log.periodo)` + borra el log, en UNA transacción; responde `{ mensaje: 'Carga deshecha', filasBorradas }`.

- [ ] Steps TDD estándar (tests del historial service: visibilidad por nivel; deshacer: transacción, 404 log inexistente, conteo). Al final `npx jest src/certificaciones` + `npm test` completo backend + `npx tsc --noEmit`. Commit `feat(certificaciones): endpoints de carga, historial y deshacer`.

---

### Task 6: Frontend — wizard de carga

**Files (repo Frontend):** Create `src/app/(protected)/certificaciones/carga/page.tsx` + `carga-page.test.tsx`, `src/features/certificaciones/carga/*` (pasos como componentes si la página crece), hooks en `src/lib/api/certificaciones.ts`; Modify `certificaciones-nav.ts` (entrada "Cargar", visible niveles admin y carga).

**Contrato con el backend:** las rutas de T5; el preview devuelve `filas: FilaPreview[]` con `rowId`; el confirmar manda `{previewId, ediciones: [{rowId, contrato?, provincia?, cantidades?, total_mes?, excluida?}]}` — el front acumula ediciones (estado local por rowId) y las manda TODAS al confirmar.

**UX (paridad §6 del inventario, estilo de la casa):** wizard de 4 pasos — (1) drop-zone + mes (default actual) y año (actual..2022), extensiones .xlsx/.xlsm/.pdf (sin .xls: mensaje de conversión), aviso de 20 MB validado también client-side ANTES de subir; (2) chips de hojas pre-seleccionadas según los Ks del claim con matching por límites de palabra (fix B9; para nivel admin todas) — filtro client-side como el portal; (3) tabla editable paginada 50/página (patrón etapa 3): Cargar(checkbox) · Hoja · Ítem · Tarea(truncada+title) · Contrato(select con cascada por item_codigo) · Provincia(select de useProvinciasAnalytics... usar el listado de provincias del módulo; si no existe hook, agregar `GET /certificaciones/carga/provincias` NO — reusar `useProvinciasAnalytics` que ya lista activas) · Cant.(input) · $Unit(RO) · $Total(input) · Estado(badge OK/⚠detalle/Excluida + aviso "archivo: K8 → K12" con tooltip cuando contrato_fuente='maestro' y difiere del archivo); métricas en vivo (a cargar / con problema / excluidas / total) + aviso no bloqueante de descuadre vs total_declarado (tolerancia 0.01, montos con 2 decimales); revalidación client-side espejo de `revalidarFila` (incluido item_en_maestro) — regla en `src/features/certificaciones/carga/revalidar.ts` con tests puros; (4) confirmación con "N filas insertadas · M omitidas" + detalle de errores {hoja, fila, ítem, mensaje} + botones Cargar otra / Ver resumen.

- [ ] TDD: tests de `revalidar.ts` (espejo de los textos) + tests de página (gate de nivel: lectura no ve "Cargar"; flujo feliz con mocks: subir→hojas→editar cantidad→confirmar payload con SOLO ediciones; exclusión; badge de reasignación; descuadre). Suite completa frontend + tsc. Commit(s).

---

### Task 7: Frontend — historial de cargas + deshacer

**Files (repo Frontend):** Create `src/app/(protected)/certificaciones/historial/page.tsx` + test; hooks `useHistorialCargas`, `useDeshacerCarga`; Modify `certificaciones-nav.ts` ("Historial", visible todos los niveles del módulo).

- Tabla (sin scroll horizontal): Usuario · Archivo (truncado+title) · Contratos (chips) · Período · Filas (cargadas/error) · Estado (chip ok/parcial) · Fecha · [Deshacer] solo nivel admin, con modal de confirmación que avisa "Borra las N filas de certificaciones de este archivo y período. No se puede deshacer." y muestra el error del backend si falla.
- [ ] TDD (render, gate del botón por nivel, confirmación llama al hook). Suite + tsc. Commit.

---

### Task 8: Cierre — smoke real y nota de deploy

**Files:** Create `docs/2026-09-xx-erp-etapa4-deploy.md`.

- [ ] **Step 1**: smoke real del parser contra un archivo real: buscar fixtures en `tests/` del portal (o pedirle al controller un Excel real de certificaciones); correr `parsearExcel` sobre él con un script one-off y comparar conteo de filas/total contra el parser Python (correr `python -c ...` del portal si el venv está disponible — está en `.venv` del repo del portal). Pegar ambas salidas en el reporte. Si no hay archivo real disponible, dejarlo EXPLÍCITO como paso 5 del checklist de deploy (paridad manual con el usuario).
- [ ] **Step 2**: nota de deploy: (1) merge PRs (TRES repos: portal sin cambios, verificarlo); (2) DDL B7 en las DOS bases (`docs/sql/2026-09-02-cargas-log-contrato.sql`); (3) VPS pull+install+prisma generate+build ambos (¡`pdfjs-dist` nuevo en package.json!); (4) AVISO + pm2 restart; (5) smoke: carga/preview 401 sin token, 403 con nivel lectura; PARIDAD: mismo Excel real → preview en misregistros vs portal (mismas filas, mismos errores, mismo total) y una carga de prueba chica con su deshacer; (6) aviso operativo: la carga se hace desde misregistros; upload.html del portal queda redundante — NO cargar el mismo archivo por los dos lados (el duplicado por archivo_nombre protege, pero igual); (7) documentar en los dos contextos. Commit.

---

## Self-review del plan (hecho)

- **Cobertura del spec etapa 4**: upload+parser+validación+escritura (T1-T5), pantallas (T6-T7), OneDrive eliminado (sin tarea — se omite el paso y el store no guarda bytes), tests de paridad (fixtures T1/T2 + smoke real T8 + paridad manual en deploy), carga_log (modelo + DDL B7).
- **Placeholders**: los parsers se especifican por referencia normativa (inventario §2-§3 + fuentes Python citados, que el ejecutor tiene en disco) con casos de test concretos con valores exactos — decisión consciente para una transcripción de ~500 líneas de reglas; los contratos entre tareas (interfaces, DTOs, rutas, shapes) están completos acá.
- **Consistencia**: `FilaParseada`/`FilaPreview`/`rowId`/ediciones idénticos entre T1↔T4↔T6; textos de faltas y mensajes centralizados en el inventario §4-§5; `fecha` string en todo el camino (lección timezone).
- **Riesgos nombrados**: pdfjs-dist (y coordenada y invertida) en T2; DDL real de cargas_log a verificar en T4 Step 1; `.xls` como desvío consciente a confirmar con el usuario; el smoke de paridad depende de conseguir un Excel real (T8 lo degrada a paso de deploy si no hay).
