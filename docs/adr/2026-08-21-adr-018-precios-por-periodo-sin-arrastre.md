# ADR-018: Precios por período, sin arrastre entre meses (amienda ADR-010)

## Contexto

ADR-010 definió la "ronda mensual de tarifas": una fila por tabla de precios
(`TarifaCategoriaUocra`, `MontoNovedadPlus`, `RangoKmPorTantos`,
`BonoNoRemunerativo`, `SueldoMensualizado`) con `vigenteDesde` = día 1 de un
mes, y el cálculo (`CalculoService.masVigente()`) toma la fila con
`vigenteDesde` más reciente ≤ la fecha de la quincena liquidada.

Se detectó (2026-08-21, revisando la liquidación de un empleado) que esto
permite un **arrastre silencioso**: si un período no tiene fila propia para
un campo, el cálculo usa la fila del período anterior sin que quede
registrado que "así se decidió" para el período actual. Caso real: el bono no
remunerativo de la categoría Oficial ($33.550, cargado en julio 2026) siguió
aplicando en agosto 2026 porque nadie cargó (ni marcó "sin bono") agosto —
`masVigente()` no distingue "agosto decidió heredar julio" de "agosto nunca
se resolvió".

Una auditoría sobre los 3 períodos ya cargados (jun/jul/ago 2026) confirmó
que hoy es el único caso real de arrastre en producción, pero el riesgo está
latente en las 5 tablas por compartir el mismo mecanismo.

## Decisión

Se elimina el fallback "vigencia más reciente ≤ fecha" de `masVigente()`. El
cálculo de liquidación busca una fila con `vigenteDesde` exactamente igual al
período que se liquida — nunca una anterior.

- **Campos obligatorios** (tarifa por categoría, monto de novedad con plus,
  rango de km, sueldo mensualizado): sin fila exacta del período, es un
  **precio sin resolver** — se muestra como alerta en la tabla de
  preliquidación (mismo patrón que `datoFaltante`), sin bloquear el cálculo
  de otros períodos ni de otras categorías/empleados.
- **Bono no remunerativo** (único campo opcional): "sin bono este mes" pasa a
  ser una decisión explícita que graba una fila real (no la ausencia de
  fila). Sin fila para el período, también es "sin resolver" — igual que los
  obligatorios — no se infiere $0 por default.
- Se elimina el relleno automático de huecos de `POST
  /liquidacion/tarifas/ronda` (ADR-010, punto 1–4): cargar un período ya no
  copia automáticamente los meses salteados intermedios. Cada carga resuelve
  únicamente el período que se está cargando; el formulario prellena con el
  último valor conocido como sugerencia editable, pero grabar es obligatorio
  para que ese período quede resuelto.
- Los períodos son independientes entre sí: no hay bloqueo ni orden
  obligatorio para cargarlos (a diferencia de lo que proponía originalmente
  este ADR en su borrador — se descartó por decisión de producto: un mes sin
  resolver no debe impedir liquidar otro).

## Qué NO cambia

- La edición de un período ya cargado (amendment 2026-08-04 de ADR-010) sigue
  igual en espíritu: auditoría completa por cambio de valor. Deja de haber
  distinción entre "cargar por primera vez" y "editar" — cada sección hace
  upsert directo contra su propio período; el diálogo de confirmación al
  pisar un valor ya resuelto pasa a ser responsabilidad del frontend (lo
  decide con el flag `resuelto` que devuelve cada GET), no del backend.

## Consecuencia: `RondaTarifas` queda deprecada

La tabla `sth_rondas_tarifas` (ADR-010) ya no se lee ni se escribe: con
períodos independientes por sección, "qué mes está resuelto" es una pregunta
por campo (categoría, tipo de novedad, etc.), no una sola respuesta por mes.
Se deja la tabla en la base (tiene 3 filas históricas, jun–ago 2026) sin
borrarla — no vale el riesgo de un DROP TABLE por algo puramente informativo
que ya no se usa. El selector de período del frontend deja de arrancar en
"el último cargado" y arranca siempre en el mes actual.

## Alternativas consideradas

- **Bloquear el avance a un período nuevo si el anterior no está resuelto**
  (mantener la garantía "nunca hay huecos" de ADR-010 tal cual) — descartada:
  decisión de producto de que los períodos sean independientes.
- **Seguir permitiendo arrastre pero solo un mes hacia atrás** — descartada:
  no resuelve el problema de fondo (seguiría sin quedar registrado que el
  período actual "decidió" heredar), solo lo acota.
