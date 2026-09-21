# Plan: certificación K12 en Excel (provincia, total, contrato) + desborde del formulario manual

Fecha: 2026-09-21. Carril completo. Backend rama `fix/cert-k12-provincia-total`,
Frontend rama `fix/cert-form-manual-overflow` (worktrees `quitar-chip-16h`).

## Diagnóstico (reproducido)

1. **Backend, 0 filas.** El Excel K12 (hoja `k12`, header en fila 6: Item,
   DESCRIPCION, CANTIDAD, K, Puntos, $ Unit, TOTAL CERTIFICADO, Acumulado
   Anterior) no trae PROVINCIA, que es requerida → la hoja se descarta. Además
   la columna K trae `653.32` (coeficiente, no un código K), el total está en
   una fila "TOTAL CERTIFICADO EN E…" que el parser no reconoce, y el período
   viene sin año.
2. **Frontend, formulario manual desbordado.** El `<select>` de ítems trae
   cientos de opciones de todos los contratos con rótulos de ~130 chars; la
   grilla `fr` no acota el mínimo → el resto de columnas queda fuera del
   recuadro con scroll horizontal.

## Premisa corregida por el planificador

El maestro `sth_cert_contratos` NO tiene provincia (solo id, codigo_k,
descripcion, activo) y no hay ABM. Lo que sí hay: cada certificación cargada
guarda `id_contrato` e `id_provincia`. **"Provincia del contrato" = la única
provincia del histórico de `sth_cert_certificaciones` para ese K**; con 0 o
más de una, la elige la persona por fila (select ya existente en el paso 3).
Sin DDL.

## Verificado en las dos bases (2026-09-21, solo lectura)

- K12 existe en `sth_cert_contratos` (id 8, "Inspeccion de gnc y Redes") y
  sus 5 ítems del archivo (1130, 1131, 1136, 1137, 1138) están en el maestro.
- **Todos los contratos tienen varias provincias en el histórico** (K12: Jujuy,
  Salta, Santiago del Estero, Tucumán). La resolución automática por
  histórico (A4 del planificador) caería siempre al respaldo → **se descarta**.

## Decisiones cerradas

1. Provincia ausente → **la asigna la persona por fila** en el paso 3 con el
   selector que ya existe (opción 1 elegida por el usuario). Sin UI nueva, sin
   resolución automática. Naturgy sigue igual (si la columna está, se usa).
2. `total_declarado` = fila cuyo rótulo empieza con "TOTAL CERTIFICADO".
3. Preguntas abiertas resueltas con el default: histórico NO (descartado);
   "Visitas de inspección" se ignora; filtrar selector por K de las hojas SÍ;
   combobox/asignar-a-todas NO; WK N° SÍ; período sin año NO.

## Preguntas abiertas (con default)

1. Fuente de provincia: histórico (A, sin DDL) vs. columna nueva en contratos
   (B, DDL en las dos bases). **Default A.**
2. K12 sin histórico → primera carga pide provincia por fila. **Default sí.**
3. Fila "Visitas de inspección" sin código: se ignora y se informa el
   descuadre. **Default: no cambiar el parser.**
4. Filtrar el selector de ítems por los K de las hojas elegidas. **Default sí**
   (hojas ∪ contratos de filas visibles; vacío → todos).
5. Combobox con búsqueda / "asignar provincia a todas": UI nueva, mockup.
   **Default: no en este PR.**
6. Leer `WK N° 362000594` como nro. de NP (A6): **sí**. Período sin año: **no**.

## Etapa A — Backend (PR propio, sin DDL, API aditiva)

- **A1 (par).** `procesarFila`: la celda K vale como contrato solo si matchea
  `/^K?\d{1,3}$/i`; si no, `meta.k_gasnor` (nombre de hoja/archivo). Rojo: fila
  con K=653.32 en hoja `k12` → `contrato === 'K12'`.
- **A2 (par).** Fila cuyo ítem empieza con `TOTAL CERTIFICADO` → `total_declarado`
  desde su columna TOTAL (si aún null) y NO es fila de ítem. Rojo: libro K12
  sintético → 5 filas, `total_declarado === 7088522`, sin aviso
  `sin_total_declarado`.
- **A2 — hallazgos del archivo real (2026-09-21):** el rótulo es "TOTAL
  CERTIFICADO EN EL PERIODO SIN IVA" y el monto está en la celda combinada
  H13:K13 (maestra en la columna Puntos): se lee la celda maestra. El total
  real es `7088522.000000001` (SUM con ruido flotante): las aserciones usan
  tolerancia. Debajo del total hay pie: `IVA`, `Total con IVA`, `FIRMA Y
  SELLO RESPONSABLE CONTRATISTA`, que pasan `esItemValido`.
- **A3 (par).** Quitar `provincia` de `COLUMNAS_REQUERIDAS_XLS` (solo Excel)
  **y la fila TOTAL CERTIFICADO cierra la zona de datos de la hoja** (después
  de leer su monto se deja de procesar filas: lo de abajo es pie, como hace
  `parser-pdf` con `FOOTER_PALABRAS`). Rojo: libro sin PROVINCIA y con pie
  (IVA / Total con IVA / FIRMA) → sin error de header, 5 filas exactas con
  `provincia ''` bloqueadas por "Falta provincia", ninguna fila de pie.
- **A4. DESCARTADO** (resolución por histórico): todos los K tienen varias
  provincias. Las filas sin provincia quedan bloqueadas por "Falta provincia"
  y la persona la elige por fila en el paso 3. Sin aviso nuevo ni cambio de
  API: `TipoAviso` no cambia.
- **A3 — hallazgos (2026-09-21):** en la celda combinada del total, el origen
  numérico/texto se consultaba en la esclava → el total salía como texto y la
  regla es-AR lo leía 7.088.522.000.000.001 (arreglado en A3, dos líneas). La
  columna `TIPO` del bloque lateral NO se cuela (no está en el header). Sonda
  del archivo real tras A1-A3: 5 filas, ítems 1137/1136/1138/1130/1131,
  provincia vacía en las 5, total 7088522.000000001, sin error de header; pero
  la fila 7 trae `0` en la columna K y `ES_CODIGO_K` lo acepta → contrato
  **K0**. Decisión: **`0` no es un código K** (no existe contrato K0); el
  patrón lo excluye y esa fila cae a `meta.k_gasnor` = K12. Va en A5.
- **A5 (par).** (a) Excluir el `0` de `ES_CODIGO_K` con test rojo en
  `parser-excel.spec.ts` (celda K = `0` en hoja `k12` → contrato K12). (b)
  `parser-real.spec.ts`: caso K12 real (copiar el archivo a
  `CERT_XLS_DIR`): sin error de header, 5 filas K12, total ≈ 7.088.522
  (tolerancia por ruido flotante), sin filas de pie. **Los tres Excel reales
  de Naturgy ya no existen** (el usuario los borró, 2026-09-21): sus casos en
  `parser-real.spec.ts` no se pueden correr; la regresión de Naturgy queda
  cubierta por los ~30 tests sintéticos de `parser-excel.spec.ts`. Anotarlo
  en el PR.
- **A6 (par).** `nro_np` desde `WK N° 362000594` en la misma celda.
- **A7.** `CONTEXT.md` (provincia ya no requerida en Excel; "Provincia del
  contrato"), contexto §90, este plan.
- Verificación: `npx jest src/certificaciones/carga`, `npm run test:cert-real`,
  `npx tsc --noEmit`, suite completa + build al final.

## Etapa B — Frontend (PR propio, independiente en runtime)

- **B1 (par).** `fila-manual-form.tsx`: grilla con `minmax(0, Xfr)` en cada
  pista, `min-w-0` en los labels, `w-full min-w-0` en los selects. Test de
  clases (jsdom no calcula layout) + verificación en navegador a 1280 px:
  `scrollWidth === clientWidth`.
- **B2 (par).** `page.tsx`: `itemsParaManual` filtrado por los K de
  `hojasSel` ∪ contratos de `filasEnHojas`; vacío → todos. Rótulo "Ítem del
  maestro (contratos de las hojas elegidas)".
- **B3. DESCARTADO** junto con A4 (no hay aviso nuevo).
- Verificación: vitest de los dos archivos, lint, tsc, suite completa, y
  comprobación en navegador del formulario a 1280 px.

## Etapa B, pares agregados tras la prueba del usuario (2026-09-21)

El usuario probó en local: "me reconoce correctamente el archivo y los
montos". Observaciones visuales, decididas por él:

- **B4 (par). Solo avisos urgentes.** En el paso 3 se ocultan los avisos
  débiles (`fuerte: false`: columnas ignoradas, WK no detectado, etc.) y el
  bloque "Avisos de lectura" con errores de parseo por fila (ya se ven en la
  fila bloqueada). Se muestran solo los avisos `fuerte: true` y los errores
  de `campo === 'header'` (una hoja descartada sí es urgente). Textual del
  usuario: "no me interesa qué columna ignoraste ni al usuario; solamente
  muéstrame un aviso cuando sea de urgencia".
- **B5 (par). Aviso de provincia faltante.** Si hay filas visibles de las
  hojas elegidas con `provincia === ''`, un aviso urgente en el paso 3: "N
  filas sin provincia: el archivo no la trae. Asigná la provincia en cada fila
  para poder cargarlas" (con N y plural). Desaparece cuando todas la tienen.
  Textual: "recomendar asignar una provincia para que se cargue
  correctamente y que el usuario no deba adivinar".
- **B6 (par). Tarjeta TOTAL A CARGAR.** El monto (p. ej. "$ 7.088.522,00") se
  sale del recuadro. Debe entrar: tipografía que se achique o que quiebre
  con `break-words`/`tabular-nums`, sin agrandar la tarjeta ni provocar
  scroll. Test de clases + comprobación visual.

## Pasos R (hallazgos high del verificador, Frontend, 2026-09-21)

- **R1 (par).** `page.tsx` `itemsParaManual`: el respaldo "vacío → todos" solo
  cubre `ks.size === 0`; si el K de la hoja no tiene ítems en el maestro (el
  riesgo 1 del plan), el filtro deja **cero ítems** y no se puede agregar
  ninguna fila manual. Arreglo mínimo: si el filtrado queda vacío, devolver
  todos los ítems. Test rojo: hoja `CERTIF K12` con maestro sin ítems K12 →
  el select ofrece todos.
- **R2 (par).** `carga-page.test.tsx` ~902: el test "por el nombre de la hoja"
  no aísla esa vía porque `filaBase()` trae `contrato: 'K12'`. Usar
  `contrato: ''` en esa fila para que la única vía sea el nombre de la hoja.
  (Se ve rojo quitando temporalmente el bucle por `contratosDisponibles`.)

## Antes de ejecutar: verificar en las bases (solo lectura)

Provincias por K en el histórico, existencia de K12 y presencia de los ítems
1137/1136/1138/1130/1131 en `sth_cert_items`. Si faltan, el parser puede quedar
perfecto y las filas seguir bloqueadas por "Ítem no encontrado en el maestro".

## Riesgos

- Ítems K12 fuera del maestro (alto para la percepción): verificar antes.
- Histórico con una provincia equivocada propaga el error; mitigado por el
  aviso que nombra K y provincia antes de confirmar.
- Mock por texto SQL en `carga.service.spec.ts`: rutear la query nueva antes.
- "TOTAL CERTIFICADO" en libros Naturgy: rótulo estricto + `test:cert-real`.
- `TIPO` del bloque ajeno puede poblar `tipo` con `CAPEX`: mirar en el preview.
- Sin DDL ni escritura de datos: nada irreversible.

## Fuera de alcance

`parser-pdf.ts`; ABM/columna de provincia en contratos; `esItemValido`;
combobox con búsqueda; interpretar K=653.32; cargar ítems K12 al maestro
(tarea del usuario si faltan); deploy.
