# Plan: hoja DIAS TRABAJADOS con 3 quincenas + total por mes (ADR-024)

Fecha: 2026-09-17. Rama: `feat/dias-trabajados-tres-quincenas` (worktree
`.claude/worktrees/dias-trabajados-3-quincenas`). Solo Backend; el Frontend
no cambia. Sin DDL.

## Decisiones cerradas en la entrevista

1. **Fuente:** al crear el cierre se congelan los días trabajados de **3
   quincenas corridas** (la cerrada + 2 anteriores) en `sth_cierre_dias_trabajados`.
   Misma tabla, más filas. Respeta ADR-021: el Excel es 100 % foto.
2. **Ventana:** siempre `quincenasHaciaAtras(anio, mes, quincena, 3)`.
   Sep 1q → 1/8 al 15/9. Sep 2q → 16/8 al 30/9.
3. **Día trabajado:** ≥1 registro con `estado != 'desaprobado'`. No cambia.
4. **Layout:** `Legajo | NOMBRE Y APELLIDO | días mes 1 | Total <Mes 1> | días mes 2 | Total <Mes 2>`.
   Sin total general. Total como número (convención de RESUMEN, sin fórmulas).
5. **Cierres viejos:** si la foto no tiene fechas previas a la quincena
   cerrada, la hoja se arma solo con esa quincena y su total. Ventana
   binaria (3 quincenas o solo la cerrada), nunca recortada a la mínima fecha.
6. **Empleados:** aparece todo cuil con ≥1 día en la ventana.
7. **Salvedad de pendientes:** sigue mirando SOLO la quincena cerrada.

## Defaults para las preguntas abiertas (a confirmar por el usuario)

- Encabezado del total: `Total Agosto` (inicial mayúscula).
- Total sin días en el mes: `0`, no vacío.
- Orden de empleados: `orderBy: [{ apellidoNombre: 'asc' }, { fecha: 'asc' }]` en el `findMany`.
- Reusar `NOMBRES_MES` en `src/certificaciones/carga/avisos.ts`: sí.
- Inserción: `createMany` anidado, y medir en la base `testing`.

## 0. Corrección previa

El ADR nuevo quedó numerado ADR-023, pero ese número ya lo usa
`docs/adr/2026-09-11-adr-023-horas-extra-pactadas-y-baja-modalidad.md`
(citado en código, schema y CONTEXT.md). El archivo nuevo pasa a **ADR-024**.

## 1. Qué se pide

Que la hoja DIAS TRABAJADOS muestre, además de la quincena cerrada, las dos
anteriores, agrupadas por mes calendario con una columna "Total <Mes>" al
final de cada bloque. Datos congelados al cerrar; cierres viejos siguen
mostrando solo su quincena.

## 2. Qué encontré en el código

- `src/common/quincena.ts:24-36` `quincenasHaciaAtras` (testeado, cruza año).
- `src/liquidacion/cierres.service.ts:172-188`: `desde/hasta` de la quincena se
  usan en DOS `groupBy` del mismo `Promise.all` (días y pendientes). Solo el de
  días cambia de rango.
- `cierres.service.ts:194-203`: `cuils` = unión de cálculo + `dias`; resuelve
  nombre/legajo desde `snuempleados`. Alcanza para cuils que solo aparecen en
  quincenas anteriores.
- `src/liquidacion/export-cierre.service.ts:177-216` `agregarHojaDiasTrabajados`:
  encabezado con `claveLocal`, `d.fecha` con `claveUtc`; ambas `"YYYY-MM-DD"`,
  comparables como string. Único lector de `cierreDiaTrabajado`.
- El export no usa fórmulas Excel; RESUMEN escribe números.
- `MESES` privado en `src/certificaciones/carga/avisos.ts:9-22`; no hay uno común.
- `prisma/schema.prisma:521` comentario "del período del cierre" queda viejo.
- Spec `docs/superpowers/specs/2026-08-30-cierre-liquidacion-export-design.md:195-198`
  punto abierto 3 anticipaba esta necesidad.
- Tests afectados: `export-cierre.service.spec.ts:197-219` (cuenta celdas `=== 1`
  en toda la fila; rompe con el total); `cierres.service.spec.ts:226-253`
  (asserta `diasTrabajados.create`). Los tests de export fijan
  `TZ=America/Argentina/Buenos_Aires` en `beforeAll`: los nuevos van en ese `describe`.

## 3. Pasos

Un solo PR de Backend.

### Etapa A — Docs previos

**Paso 1. Renumerar el ADR a 024.**
- Renombrar `docs/adr/2026-09-17-adr-023-dias-trabajados-tres-quincenas.md` →
  `docs/adr/2026-09-17-adr-024-dias-trabajados-tres-quincenas.md`; título
  `# ADR-024: …`; "Amienda" → "Enmienda".
- En `docs/adr/2026-08-30-adr-021-cierre-liquidacion-versionado.md` agregar nota
  de estado "Enmendado por ADR-024 (hoja DIAS TRABAJADOS)" con el formato que
  usa ADR-020 (`**Estado:** …`).
- Verificación: `rg -n "ADR-023" docs/adr/2026-09-17-*` vacío; `rg -n "adr-024" docs/adr` lo encuentra.

### Etapa B — Congelar 3 quincenas en `crearCierre` (TDD)

**Paso 2. Tests que fallan primero** en `src/liquidacion/cierres.service.spec.ts`:
- Sep 1q: la llamada a `registroHoras.groupBy` cuyo `by` incluye `'fecha'`
  tiene `where.fecha = { gte: new Date(2026, 7, 1), lte: new Date(2026, 8, 15) }`;
  la llamada con `estado: 'pendiente'` mantiene `gte: new Date(2026, 8, 1)`.
- Sep 2q: `gte new Date(2026, 7, 16)`, `lte new Date(2026, 8, 30)`.
- Ene 1q 2026: `gte new Date(2025, 11, 1)`, `lte new Date(2026, 0, 15)`.
- Cuil que solo trabajó en la quincena anterior queda congelado con nombre y
  legajo de `snuempleados` (test de regresión; probablemente ya pasa).
- Verificación: `npm test -- src/liquidacion/cierres.service.spec.ts` → los 3
  primeros FALLAN (hoy `gte` es 1/9).

**Paso 3. Implementar en `src/liquidacion/cierres.service.ts`.**
- Importar `quincenasHaciaAtras`.
- `const [primera] = quincenasHaciaAtras(anio, mes, quincena, 3);`
  `const desdeVentana = rangoQuincena(primera.anio, primera.mes, primera.quincena).desde;`
- `groupBy` de días: `fecha: { gte: desdeVentana, lte: hasta }`. El de
  pendientes NO se toca.
- Comentario explicando la ventana (ADR-024) y que pendientes es de la quincena.
  Actualizar JSDoc de la clase.
- `diasTrabajados: { create: dias.map(...) }` → `diasTrabajados: { createMany: { data: dias.map(...) } }`
  (un INSERT multi-fila). Ajustar `cierres.service.spec.ts:245-250`.
- Verificación: spec verde; `npm run build`.

### Etapa C — Hoja con ventana, bloques por mes y totales (TDD)

**Paso 4. Helper de mes en `src/common/quincena.ts`.**
- `export const NOMBRES_MES = ['enero', …, 'diciembre']` y
  `export function nombreMes(mes: number): string` → `'Agosto'`.
- Tests en `src/common/quincena.spec.ts` (`nombreMes(8)`, `nombreMes(12)`).
- `src/certificaciones/carga/avisos.ts` importa `NOMBRES_MES` y borra su copia;
  `npm test -- src/certificaciones/carga/avisos.spec.ts` verde.
- Verificación: `npm test -- src/common/quincena.spec.ts`.

**Paso 5. Tests que fallan primero** en `src/liquidacion/export-cierre.service.spec.ts`,
dentro del `describe('generarExcelPrincipal')`. Fechas de foto con
`new Date(Date.UTC(...))`. `values` de ExcelJS es 1-based: `[1]` Legajo, `[2]` Nombre.
- Sep 1q con foto de 3 quincenas: Perez `2026-08-01` y `2026-09-01`; Gomez solo
  `2026-08-20`. Encabezado 50 columnas: `[3]='01/08'`, `[33]='31/08'`,
  `[34]='Total Agosto'`, `[35]='01/09'`, `[49]='15/09'`, `[50]='Total Septiembre'`.
  `rowCount=3`. Perez: `[3]=1`, `[34]=1`, `[35]=1`, `[50]=1`. Gomez: `[22]=1`,
  `[34]=1`, `[50]=0`, ninguna otra celda de día marcada.
- Sep 2q: `[3]='16/08'`, `[18]='31/08'`, `[19]='Total Agosto'`, `[20]='01/09'`,
  `[49]='30/09'`, `[50]='Total Septiembre'`.
- Cierre viejo (adaptar el test existente): 18 columnas, `[3]='01/09'`,
  `[17]='15/09'`, `[18]='Total Septiembre'`; `fila.slice(3, 18)` tiene un solo 1;
  `fila[18]=1`. Conservar el comentario del caso borde UTC-3.
- Ventana cruza el año: ene 1q 2026 con foto `2025-12-20` → `[3]='01/12'`,
  `[34]='Total Diciembre'`, `[50]='Total Enero'`.
- Foto vacía: `rowCount=1`, 18 columnas.
- Verificación: spec → los nuevos FALLAN.

**Paso 6. Implementar en `src/liquidacion/export-cierre.service.ts`.**
- Importar `quincenasHaciaAtras, nombreMes`.
- Método privado `ventanaDiasTrabajados(dias, anio, mes, quincena)`:
  `hayPrevias = dias.some(d => claveUtc(new Date(d.fecha)) < claveLocal(desdeCerrada))`
  (strings, nunca Date contra Date). Sin previas → quincena cerrada; con
  previas → `desde` de la primera de `quincenasHaciaAtras(..., 3)`. Justificar
  en comentario por qué binaria y no recortada a la mínima fecha.
- En `agregarHojaDiasTrabajados`: iterar fechas de la ventana, agrupar en
  bloques por mes calendario (clave año-mes sobre Date locales, bucle
  genérico), encabezado por bloque `…dd/mm, Total <Mes>`, por empleado
  marcas `1 | ''` y luego el conteo como número.
- `findMany` con `orderBy: [{ apellidoNombre: 'asc' }, { fecha: 'asc' }]`.
- Actualizar JSDoc citando ADR-024 y spec §5.1.5.
- Verificación: spec verde; `npm run build`.

### Etapa D — Suite completa, docs y contexto

**Paso 7.** `npm test` y `npm run build` completos sin fallos.

**Paso 8. Docs.**
- `prisma/schema.prisma:521-523` solo comentario → "tres quincenas corridas
  (ADR-024)". `npx prisma validate`; `git diff prisma/` sin nada más.
- Spec de export: en §5.1.5 y punto abierto 3, "Resuelto por ADR-024 (2026-09-17)".
- Verificación: `rg -n "ADR-024" prisma docs`.

**Paso 9. Medición en `testing`** (riesgo 1): crear un cierre de una quincena
real contra la base `testing` con el código nuevo y anotar la duración de la
transacción. Si roza los 30 s, subir `timeout` con comentario. Lo corre el
orquestador con OK del usuario (escribe en `testing`, no en producción).

> **Resultado (2026-09-17):** `testing` tiene solo 6 registros de horas, así
> que un cierre real no medía nada. Se midió la inserción de 4.500 filas
> sintéticas (100 empleados x 45 días) dentro de una transacción, cuatro
> rondas alternadas: `createMany` 4,3 s / 2,5 s / 1,0 s; `create` anidado
> 2,3 s / 3,6 s / 1,0 s. Las dos formas quedan lejos de los 30 s; Prisma ya
> agrupa el `create` anidado. Se mantiene `createMany` y no se toca el
> timeout. Los cierres de prueba se borraron de `testing`.

**Paso 10. Contexto de sesión.** Sección `## 88.` al final de
`.claude/Contexto/contexto-proyecto.md`: pedido, decisión, archivos, cómo se
ve la hoja, lo que no cambia, pendiente de deploy.

Después el orquestador muestra el cambio al usuario antes del PR.

### Etapa E — Fix agregado al PR (2026-09-17): plus individual del relevador

**Bug reportado:** el plus individual (Tarifas > Plus individual) no le
impactaba a un relevador (régimen `por_tantos`). Causa: `montoA` y `montoB`
se congelaban sin él; el Excel usa `montoA` como TOTAL del relevador y RESUMEN
suma eso; el Frontend calcula "Monto A" con la misma fórmula. `total` sí lo
sumaba, por eso los demás regímenes andaban.

**Decisión del usuario:** el plus del relevador va a la **parte B**
(`montoB = montoHorasExtra + plusIndividual`), A no cambia. En el detalle se
muestra como en los demás empleados (monto + motivo). Los plus de novedades
quedan como están. Cierres viejos: se corrigen con recierre, no se tocan.

**Paso 11 (HECHO).** `cierres.service.ts`: `montoB` suma `plusIndividual`.
`export-cierre.service.ts`: PRODUCTIVIDAD de un `por_tantos` ya no incluye el
plus individual (viaja en B). Tests rojos primero en `cierres.service.spec.ts`
(esperaba 7000, recibía 5000) y `export-cierre.service.spec.ts` (esperaba 300,
recibía 2300); después 36/36 en verde.

**Paso 12 (PENDIENTE).** Suite completa + build; `code-review` del fix;
actualizar la sección 88 del contexto con el fix; mostrar al usuario; PR.

**Paso 13 (PENDIENTE, repo Frontend, PR par).** `src/features/liquidacion/
tabla-por-tantos.tsx`: columna "Monto B" = `montoExtra + plusIndividual`; la
fila expandida muestra el plus individual con su motivo como hace
`detalle-empleado.tsx`. Sin cambio de API.

## 4. Riesgos

1. **Timeout de la transacción de cierre (alto-medio).** De ~1.500 a ~4.500
   filas por cierre contra BD remota compartida. Mitigación: `createMany`
   anidado + medir en `testing` (paso 9). Rollback = revertir el PR.
2. **Regresión en la salvedad de pendientes.** Mitigación: test del paso 2.
3. **Test existente de la hoja.** Mitigación: adaptar a rango de columnas de
   días + assert del total, sin perder el caso borde UTC-3.
4. **Zona horaria.** Comparar siempre claves string; tests con TZ argentino.
5. **Recierres.** Una versión nueva trae la hoja completa; la anterior queda
   corta. Decidido en el ADR.
6. **Cuil ausente de `snuempleados`.** Sale el cuil como nombre (fallback
   existente). Baja probabilidad.
7. **Datos:** solo inserciones nuevas desde el próximo cierre. Sin migración.

## 5. Fuera de alcance

- Frontend. Relleno de cierres viejos. DDL. Regla de "día trabajado".
  `analisis.service.ts`. Total general. Fórmulas Excel. Deploy.
