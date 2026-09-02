# Inventario técnico — flujo de carga de certificaciones del portal (referencia para la etapa 4)

> Relevado el 2026-09-02 del código real del portal. Los archivos fuente (la
> verdad última para portar) están en
> `..\..\PortalCertificaciones\PortalCertificaciones_backend`:
> `app/routers/certificaciones.py`, `app/services/parser.py`,
> `app/services/parser_pdf.py`, `app/services/validacion.py`,
> `app/services/carga.py`, `app/services/cache.py`; y el frontend vanilla en
> `..\PortalCertificaciones_frontend\pages\upload.html` (JS inline).
> Este doc resume shapes, reglas y trampas; ante cualquier duda, leer el
> fuente Python citado.

## 1. Flujo actual (FastAPI)

- `POST /certificaciones/preview` — multipart: `archivo` (file), `periodo_anio` (int), `periodo_mes` (int). Cualquier autenticado. Límite 20 MB (validado DESPUÉS de leer a RAM). `.pdf` → parser PDF; el resto → parser Excel. Parsea TODAS las hojas `CERTIF*` (o todas si ninguna empieza así). Devuelve `{cache_id, archivo, hojas[], periodo, resumen{total, con_error, total_mes, total_declarado}, filas[], errores[]}`.
- Cada fila del preview (numéricos como STRING o null): `{hoja_origen, archivo_origen, item_codigo, nombre_contrato, tarea, contrato, unidad_medida, ptos_gasnor, tipo, contratista, provincia, region, cantidades, precio_unitario, total_mes, observaciones, fecha, nro_np, tiene_error, contrato_archivo, contrato_fuente('editado'|'maestro'|'archivo'), contrato_del_maestro, error_detalle, item_en_maestro}`.
- Edición: 100% cliente; al confirmar viaja el array entero (`filas_editadas` JSON en un form field) + `cache_id` + `hojas` (muerto en la práctica). El servidor CONFÍA en el navegador para casi todos los campos (bug B8).
- `POST /certificaciones/confirmar` — chequeo de duplicado por `carga_log.archivo_nombre` (global, sin período — mensaje según rol: admin → "eliminá la carga anterior desde el historial"; resto → "pedile a un administrador"), revalidación server (SIN item_existe — bug B2), `check_contrato_access` por K resuelto (DESPUÉS de resolver), inserta con `cargar_certificaciones`, escribe `carga_log`, responde `{mensaje, insertadas, omitidas, errores[..10]}`.
- `GET /certificaciones/historial` — admin/gerente: 100 últimas de todos; resto: 50 propias. Campos: id, usuario_nombre, archivo_nombre, contrato, periodo, filas_cargadas, estado, cargado_en.
- `DELETE /admin/cargas/{log_id}` — solo admin; borra `fact` por `(archivo_origen, DATE_FORMAT(fecha,'%Y-%m') = periodo)` y el log (bug B13: no hay FK log→facts).
- Cache preview→confirmar: dict en memoria, TTL 30 min, uuid4; guarda resultado completo + BYTES del archivo (para OneDrive, ya eliminado) + período + usuario_id (que para tokens Horas es 0 — bug B1 de ownership).

## 2. Parser Excel (`parser.py`) — reglas exactas

- `COL_ALIAS` (matcheo EXACTO sobre header UPPER con \s+→espacio y trim; gana el PRIMER alias de la lista):
  item_codigo: ÍTEMS|ITEMS|ÍTEM|ITEM · nombre_contrato: NOMBRE CONTRATO|NOMBRE_CONTRATO · tarea: TAREA|DESCRIPCION|DESCRIPCIÓN · contrato: K GASNOR|K_GASNOR|"K GASNOR "|K · unidad_medida: UM|UNIDAD|UNIDAD MEDIDA · ptos_gasnor: PTOS. GASNOR|PTOS GASNOR|PUNTOS GASNOR|PUNTOS|PTOS · tipo: TIPO · contratista: CONTRATISTA · provincia: PROVINCIA · cantidades: CANTIDADES|CANTIDAD · precio_unitario: $ UNITARIO MES|UNITARIO MES|$ UNITARIO|PRECIO UNITARIO|$ UNIT · total_mes: $ TOTAL MES|TOTAL MES|$ TOTAL|TOTAL CERTIFICADO|TOTAL · observaciones: OBSERVACIONES|OBS|OBSERVACION.
- Header: primera fila que contenga una celda == ÍTEMS/ITEMS/ÍTEM/ITEM (trim upper). Datos: desde header+1.
- Meta (primeras 13 filas): `k_gasnor` primero por regex `K\d+` en el NOMBRE de la hoja, si no primera celda `^K\d+$`; `nro_np` = celda siguiente a un "NRO. DE NP"/"NRO DE NP"; `total_declarado` = celda siguiente a un "TOTAL MES" (solo la PRIMERA hoja que lo traiga cuenta a nivel archivo); `fecha` = SIEMPRE `{anio}-{mes:02d}-01` del período de la UI (nunca del archivo).
- `get(campo)`: str(v).trim; vacíos = null si el valor upper ∈ {NAN, NAT, NONE, #N/A, ""}. Ojo: pandas ya floatea → "3.0".
- `fmt_num`: quita `$` y whitespace; coma Y punto → es-AR (punto=miles, coma=decimal); solo coma → coma=decimal. DEVUELVE STRING o null si no parsea.
- `fmt_item`: si es numérico (coma→punto), entero → str(int), si no → str(round(f,4)); si no es numérico, texto tal cual; null → "".
- `provincia`: strip().title() ("salta"→"Salta"; "SANTIAGO DEL ESTERO"→"Santiago Del Estero" — el match posterior es case-insensitive, NO hacerlo sensible).
- `contrato`: upper; si no empieza con K → "K"+lstrip("kK"); fallback al k_gasnor de la meta.
- `region`: del nombre de hoja — contiene NORTE → "Norte", SUR → "Sur", si no "".
- Filtro de filas (`_es_item_valido` sobre la celda de ítem): descarta null/NaN, "", NAN/NAT/NONE, repeticiones del header; acepta numéricos (coma→punto) o texto que matchee `^[A-Za-z0-9][A-Za-z0-9\s\-_,\.]*$` (los subtotales "TOTAL:" caen por los dos puntos; "TOTAL GENERAL" PASA y entra como fila).
- Errores del parser por fila: contrato no detectado → tiene_error=true; "Cantidad es 0." solo se anota (NO marca tiene_error). Provincia vacía NO es error del parser (sí de revalidar_fila).
- Bugs conocidos: B4 (número de fila reportado sobre el df filtrado, corrido vs el Excel real — fix: conservar el índice original), B6 (headers duplicados → columnas duplicadas → basura; fix: mapear por índice de columna resuelto una vez).

## 3. Parser PDF (`parser_pdf.py`)

- pdfplumber `extract_words()` con x0/top/width. Mismo shape de salida (hojas=[nombre_archivo], nombre_contrato=None, region="").
- Columnas por x0 del header (HEADER_PALABRAS: ÍTEMS/ITEMS→item_codigo, NOMBRE, TAREA, K, UM, PTOS., TIPO, CONTRATISTA, PROVINCIA, CANTIDADES, UNITARIO, TOTAL, OBSERVACIONES); límites de columna = punto medio entre x0 consecutivos + 5.
- Líneas por top cuantizado (round(top/4)*4); filas lógicas multilínea (línea que arranca con código de ítem en la banda de la 1ª columna abre fila; el resto concatena para tarea/observaciones, "primero" para el resto). Footer corta: FIRMA, ACLARACIÓN/ACLARACION, TOTAL A CERTIFICAR, PERIODO A CERTIFICAR.
- Pegado de números partidos: gap < 8 px y prev `^\d+$` y curr `^[\d\.,]` → concatenar.
- `_limpiar_num`: toma solo el PRIMER bloque `^[\d\.,]+` (tras quitar $), strip(".,"), misma regla coma/punto. `_es_item_valido` PDF: `^[A-Za-z]?\d{3,}` (más estricto que Excel).
- PROVINCIAS dict cerrado (salta/jujuy/tucumán/tucuman/santiago/catamarca, matching por substring sin tildes) con fallback .title(); limpia la provincia pegada del contratista. total_declarado: regex `TOTAL MES\s*\$?\s*((?:[\d\.,]+\s*)+)`.
- Diferencias vs Excel: provincia vacía SÍ marca tiene_error; el código de ítem NO pasa por fmt_item (queda crudo).

## 4. Validación (`validacion.py`) — regla canónica

- Fila de PLANTILLA (se oculta del preview, sin aviso): (cantidades null|0) Y (total null|0). El unitario solo NO cuenta como contenido.
- Fila CARGABLE (revalidar_fila): ítem en maestro + contrato K + provincia válida (match UPPER contra ma_provincias activo=1) + cantidad != 0 + total_mes presente (0 es válido; solo debe parsear). Unitario puede faltar. Detalle = faltas unidas por "; " con los textos exactos: "Ítem {c} no encontrado en el maestro", "Falta contrato K", "Falta provincia", "Provincia '{p}' inválida", "Falta cantidad", "Falta total mes".
- `filtrar_cargables`: descarta `excluida` y revalida IGNORANDO el tiene_error del cliente. BUG B2: no revalida item_existe al confirmar (default True) — el port DEBE revalidarlo server-side en batch.

## 5. Carga (`carga.py`)

- Resolución de contrato (regla única, preview y carga): editado > maestro (si el ítem está en varios K: el del archivo si coincide, si no el PRIMERO por `ORDER BY di.id_item`) > archivo (solo si el ítem no está en el maestro). `anotar_contrato_final` es idempotente y preserva `contrato_archivo`.
- `_resolver_id_item`: por código+K primero (REPLACE '.'→',' ambos lados), fallback cualquier K (LIMIT 1 sin ORDER BY — no determinista con duplicados).
- `_ptos_gasnor_con_fallback`: archivo si trae valor; si no, el del maestro (dim_item); si no, null. (Regla PBI: pgn del archivo manda; maestro fallback — clave para K12.)
- `_resolver_id_provincia`: UPPER=UPPER contra ma_provincias.
- INSERT a fact (18 columnas): id_item, nombre_contrato, tarea, id_contrato, unidad_medida, ptos_gasnor, tipo, contratista, id_provincia, region, cantidades, precio_unitario, total_mes, observaciones, fecha ('YYYY-MM-01'), hoja_origen, archivo_origen, cargado_por (= nombre del usuario). Errores de negocio ("Contrato {k} no encontrado", "Ítem {c} no encontrado", "Provincia '{p}' no encontrada") acumulan y omiten la fila, no abortan.
- carga_log: usuario_id, usuario_nombre, archivo_nombre, contrato (CSV de Ks — ¡columna varchar(10), overflow con 2+ Ks, bug B7!), periodo 'YYYY-MM', filas_cargadas, filas_error, estado 'ok'|'parcial' ('error' nunca se escribe — B3), detalle_errores = repr() Python truncado a 2000 (no JSON).
- Transaccionalidad rota (B10): commit de facts y commit de log separados; puede quedar fact sin log.
- Respuesta confirmar: errores[..10] con {"fila": índice en filas_ok} — inútil (B5): el port reporta {hoja, fila_excel, item_codigo, mensaje}.

## 6. Frontend (upload.html) — UX a replicar en React

1. Paso 1: drop-zone + selects mes (default actual) y año (actual..2022) → preview. Extensiones cliente: .xlsx/.xls/.xlsm/.pdf.
2. Paso 2: chips de hojas pre-seleccionadas según los K del usuario (matching substring — B9: usar límites de palabra). Solo filtra cliente.
3. Paso 3: tabla editable — columnas: Cargar(checkbox exclusión) · Hoja · Ítem · Tarea · Contrato✏️(select) · Provincia✏️(select) · Cant.✏️ · $Unit(RO) · $Total✏️ · Estado(badge OK/⚠detalle/Excluida). Aviso de reasignación "archivo: K8 → K12" cuando el maestro pisa el K del archivo. Edición de contrato EN CASCADA por item_codigo (todas las filas del mismo ítem). Métricas en vivo (a cargar / con problema / excluidas / total) + aviso NO bloqueante de descuadre contra total_declarado (tolerancia 0.01).
4. Paso 4: confirmación → "N filas insertadas · M omitidas" + Cargar otra / Ver resumen.
- Historial (pages/historial.html): tabla de cargas (usuario, archivo, contrato, período, filas, estado, fecha) + para admin el botón de deshacer carga.

## 7. Restricciones y datos duros

- 20 MB máx; multi-hoja nativo; multi-contrato por archivo soportado (CSV en carga_log); PDF multipágina.
- Duplicado SOLO por archivo_nombre global (falso positivo con mismo nombre otro mes; renombrar lo evade). El deshacer borra por (archivo_origen, período).
- Cualquier autenticado puede cargar en el portal (incluso gerente) — el port lo restringe.
- Dependencias port: pandas/openpyxl → exceljs (ya en el backend; .xls legacy NO soportado por exceljs); pdfplumber → pdfjs-dist (algoritmo x0/top portable); multipart → multer con limits.fileSize.

## 8. Bugs del portal relevantes al port (B1..B16 — resumen)

B1 ownership de cache con usuario id=0 (Horas) · B2 item_existe no revalidado al confirmar · B3 estado 'error' muerto · B4 números de fila corridos · B5 errores sin contexto · B6 headers duplicados · B7 carga_log.contrato varchar(10) vs CSV · B8 el navegador es fuente de verdad de campos no editables · B9 permiso de hoja por substring · B10 commits separados facts/log · B11 json.loads sin manejo · B12 IN() vacío en resumen (ya resuelto en etapa 2) · B13 deshacer borra por archivo+período sin FK · B14 numéricos como strings end-to-end · B15 límite 20MB tras leer a RAM · B16 cache in-process con bytes.
