# Plan — Horas con un decimal (totales sumados en el Frontend)

Fecha: 2026-09-22 · Carril completo (5+ archivos de código; sin DDL, sin API) ·
Planificador Fable/high · Código en el worktree Frontend
`.claude/worktrees/redisenio-central-sertec`, rama `fix/horas-un-decimal` (desde
origin/main `cf3ab34`). Tests: `npx vitest run <archivo>`; suite `npm test`.

## 1. Qué se pide

Pedido textual (2026-09-22): "hay montos de tarjetas que se ven mal, por
ejemplo en cargas que hice con uno de los usuarios se ven como hasta 8
decimales, se podría redondear ese número a un único decimal? y revisar en
todo el proyecto si ese problema también existe en otras secciones y abordar
la solución de la misma manera".

Los totales de horas que el Frontend suma en coma flotante
(`0.1 + 0.2 + 0.3 = 0.6000000000000001`) se muestran redondeados a **un
decimal**, con un helper compartido en vez de `Math.round(x * 10) / 10`
repetido inline, en todas las pantallas donde pasa. Sin tocar Backend ni API.

## 2. Diagnóstico

- La base guarda todo con ≤ 2 decimales (`horas` Decimal(4,2); litros, monto,
  km Decimal(8,2)/(12,2)). Las colas largas nacen en sumas en JS.
- El Backend YA redondea a 2 decimales casi todos sus totales sumados
  (`registros-horas.service.ts:893,899,1025,1171,1282`). El único que no es
  `totalHorasDia` (`:761`).
- **Sumas del Frontend que se muestran crudas (el bug):**
  - `src/lib/agrupar.ts:92` `totalHoras` → `components/resumen-carga.tsx:25`
    (`{grupo.totalHoras} hs totales`), usado por `lote-resumen-card.tsx` (mis
    registros y aprobaciones resueltas) y `features/aprobaciones/lote-card.tsx`.
  - `features/mis-registros/cargas-agrupadas.tsx:45` → `:104` `{total} hs`
    (`text-4xl`). **Es la tarjeta que vio el usuario.**
  - `features/mis-registros/registros-cards.tsx:84-92` → `:121` `{total} hs`.
  - `lote-card.tsx:147` y `lote-resumen-card.tsx:108` `{f.totalHorasDia}hs ese
    día` (flotante del Backend). La comparación `>= 16` NO se toca.
- **Ya redondean a 1 decimal inline** (criterio del repo, a unificar):
  `app/(protected)/page.tsx:135`, `control-general/page.tsx:394-396`,
  `features/control-general/ranking-operarios.tsx:61-62`.
- **No tienen el problema:** `subtotalHoras` (un solo `Number(f.horas)`, y
  alimenta el input de `CorregirHorasDialog`), `{r.horas}`/`{f.horas}` (string
  de Prisma), `dia.totalHoras` y el ranking (2 decimales del Backend), sumas
  de importes de certificaciones/liquidación (`fmtMoneda`/`formatMoney`).
  No hay sumas de litros/monto/km en el front.
- **Convención de render fijada por tests:** número crudo + ` hs`, sin coma
  decimal ni ceros de relleno (`'14 hs'`, `'8 hs totales'`, `'20hs ese día'`).
  Por eso el helper devuelve `number`, no string: `8` sigue viéndose "8".

## 3. Pasos (pares test rojo → implementación)

### Par A — helper compartido
`src/lib/horas.ts` (nuevo) + `src/lib/horas.test.ts` (nuevo).
`redondearHoras(n: number): number = Math.round(n * 10) / 10`, con comentario
del porqué. Test rojo: `Cannot find module './horas'`; casos: suma
0.1+0.2+0.3 → 0.6; 8.25 → 8.3; 8.24 → 8.2; 8 → 8; 12.5 → 12.5; 0 → 0.

### Par B — `agruparPorLote`: `totalHoras` redondeado
`src/lib/agrupar.ts:92` + `agrupar.test.ts`. Test rojo con tres filas de
contratos distintos `'0.1'`, `'0.2'`, `'0.3'` → `totalHoras` 0.6 (hoy
0.6000000000000001). Implementación: envolver el reduce en `redondearHoras`.
NO tocar `subtotalHoras` (:74, :82) ni `>= 16` (:53). Verificar también
`src/components` y `src/features/aprobaciones`.

### Par C — Mis registros: las dos tarjetas grandes
`cargas-agrupadas.tsx:45` + su test; `registros-cards.tsx:84-92` + su test.
Tests rojos: tres registros (lotes distintos en cargas-agrupadas) con horas
`'0.1'`, `'0.2'`, `'0.3'` → `getByText('0.6 hs')` (hoy
`0.6000000000000001 hs`). Implementación: `redondearHoras(...)` sobre el
reduce en ambos.

### Par D — badge "Xhs ese día" (flotante del Backend)
`lote-card.tsx:147` + `lote-card.test.tsx`; `lote-resumen-card.tsx:108` +
`lote-resumen-card.test.tsx`. Test rojo: fila con
`totalHorasDia: 16.000000000000004`, expandir "Ver detalle", esperar
`'16hs ese día'` (hoy `16.000000000000004hs ese día`); sigue mostrando el
badge (la alerta no se apaga). Implementación: solo el texto,
`{redondearHoras(f.totalHorasDia)}hs ese día`; la condición queda igual.

### Par E — reemplazar los `Math.round` inline por el helper
`app/(protected)/page.tsx:135`, `control-general/page.tsx:394-396`,
`features/control-general/ranking-operarios.tsx:61-62`. Refactor sin cambio
de comportamiento: sin test rojo posible (decirlo en el commit); red de
seguridad `control-general-page.test.tsx:242-253` y `charts.test.tsx`.
Opcional: guarda nueva en `page.test.tsx` con rol Operario y registros
0.1/0.2/0.3 → tile "Horas cargadas" `'0.6'` (nace verde).
Al final `grep -rn "Math.round(.*\* 10) / 10" src` no debe devolver nada de
horas (quedan los `* 1000) / 10` de porcentajes).

### Paso R1 — high de la revisión: doble redondeo (2026-09-22)

**Hallazgo (verificador):** el Par B redondea `totalHoras` en la capa de datos
(`agrupar.ts:93`) y el Par C vuelve a redondear la suma de esos totales en
`cargas-agrupadas.tsx:49`. Escenario reproducido: dos lotes de 8.25 hs → cada
lote 8.3 → la tarjeta grande muestra **16.6 hs** donde corresponde 16.5 (tres
lotes de 0.25 → 0.9 en vez de 0.8); el error crece 0.05 por lote. Alcanzable:
el `step="0.5"` del input es solo el spinner, tipear 8.25 pasa (validación
`> 0`, DTO `@IsNumber()`, columna Decimal(4,2)). Es precisión que el fix
introduce, distinto del caso "una fila 8.25 se ve 8.3" aceptado en §4.

**Arreglo mínimo:** `agrupar.ts:93` vuelve al reduce crudo (sin
`redondearHoras`, sin import si queda sin uso); el redondeo pasa al único
render de ese campo, `src/components/resumen-carga.tsx:25`
(`{redondearHoras(grupo.totalHoras)} hs totales`). `GrupoLote.totalHoras` no
tiene otros consumidores ni comparaciones (verificado por grep; el `>= 16`
usa `totalHorasDia`).

**Tests:** (1) `cargas-agrupadas.test.tsx`: dos lotes distintos con horas
`'8.25'` → `getByText('16.5 hs')` en el tile grande — **rojo hoy (16.6 hs)**;
(2) el test de `agrupar.test.ts` que esperaba `totalHoras` 0.6 pasa a esperar
la suma cruda (`toBeCloseTo(0.6)`, documentando que el redondeo es del
render); (3) test en `lote-resumen-card.test.tsx` o `resumen-carga` (donde
haya fixture de grupo): lote con contratos `'0.1'`, `'0.2'`, `'0.3'` → texto
`'0.6 hs totales'` — rojo con el reduce crudo antes de tocar `resumen-carga`.

### Cierre
Suite completa una vez + `tsc` + lint; comprobación manual en el worktree
(Mis registros con cargas de 0.1/0.2/0.3; Aprobaciones con "Ver detalle" de
un día ≥ 16 hs); mostrar el diff al usuario antes del PR. Deploy solo del
Frontend, cuando se pida.

## 4. Riesgos

- Tests existentes con totales exactos: todos enteros o un decimal, quedan
  verdes (`Math.round(8*10)/10 === 8`).
- `agrupar.ts` es compartido por tres flujos; se cambia una sola línea.
- `>= 16` no se redondea: redondear ahí movería la alerta (15.96 → 16.0).
- Inconsistencia residual: una fila `8.25` se ve "8.25 hs" y su total
  "8.3 hs totales". Hoy las cargas van en pasos de 0.5; caso borde.
- `totalHorasDia` sigue saliendo flotante del Backend; fix de presentación.
  Follow-up chico anotado (fuera del plan): `registros-horas.service.ts:761`.

## 5. Preguntas abiertas (con default)

1. ¿Total entero se ve "8" o "8,0"? **Default: "8"** (como hoy y como fijan
   los tests).
2. ¿Coma es-AR ("8,5 hs") o punto? **Default: punto**, es lo que muestran hoy
   estas tarjetas y las filas individuales.
3. ¿Redondear también los valores que ya llegan con 2 decimales de la base
   (`{f.horas}`, `subtotalHoras`, control general)? **Default: NO**; no tienen
   el problema y `subtotalHoras` alimenta el diálogo de corrección. Si se
   pide "un decimal en todo", se agrega un par F con el mismo helper.
4. ¿Follow-up Backend para `totalHorasDia`? **Default: no ahora** (decisión
   cerrada sin Backend); queda en pendientes.

## 6. Fuera de alcance

Backend y API; valores individuales por fila; `combustible/page.tsx:147-148`
y `detalle-carga.tsx:437-439` (litros/monto/km sin separador de miles: otro
pedido); importes de liquidación y certificaciones; `fmtHoras` del análisis
de liquidación (2 decimales es-AR, criterio propio).

## 7. Resultado (2026-09-22)

Pares A-E + R1 ejecutados (rojo → verde en todos). Suite 830/830, tsc y lint
limpios. Revisión: 0 urgent, 1 high (R1, arreglado), 2 minor, 3 descartados.
PR Frontend #79 (`0009141`), mergeado y **deployado** el mismo día junto con
el rediseño (`docs/2026-09-22-central-sertec-deploy.md`). Contexto §92.
