# ADR-017 — Régimen `mensualizado` con horas extra habilitadas (flag, no un régimen nuevo)

**Fecha:** 2026-08-12 (corregido 2026-08-13)
**Estado:** Aceptado
**Afecta:** `sth_perfiles_liquidacion` (columna nueva), `CalculoService#calcularQuincena` (rama
`mensualizado`), pantalla de asignación de perfil (`/liquidacion/perfiles`).

## Contexto

Apareció un caso real: un operario cobra un sueldo fijo mensual pero, a diferencia de los demás
mensualizados, **sí puede cobrar horas extra**. Hoy es un único operario.

Diseñado con `/grill-with-docs`. La pregunta inicial era si hacía falta un régimen nuevo.

**Corrección 2026-08-13:** la primera versión de este ADR encuadró mal el régimen base — asumió
`fijo` (básico = tarifa de categoría × 88hs) porque la primera respuesta del dueño de producto,
frente a la opción binaria "monto libre vs. tarifa×88", eligió tarifa×88. Probando en vivo contra
el recibo de sueldo real, el dueño de producto corrigió: el básico aparece como "1 × sueldo
básico" — el patrón exacto de `mensualizado` (ver ADR-016: `horasCct=1`, básico = monto), no el de
`fijo`. Coincide además con el pedido original ("a diferencia de los **otros mensualizados**"),
que ya nombraba el régimen correcto. Se corrige acá; el resto de la decisión (flag vs. enum) no
cambia.

## Decisión

**No se agrega un 6to valor al enum `regimen`.** Se agrega un flag `permiteHorasExtra: Boolean`
(default `false`) a `PerfilLiquidacion`, válido únicamente cuando `regimen = 'mensualizado'` (no
aplica a los demás regímenes). Un enum nuevo por combinación (`mensualizado_con_extras`) no escala
si el patrón se repite en otro régimen; un flag ortogonal a "cómo se calcula el básico" sí.

### Semántica de "horas declaradas" para este caso — la parte no obvia

A diferencia de `jornalizado` (donde `RegistroHoras.horas` es el **total** trabajado ese día, y el
motor resta 88 a nivel de quincena para sacar el extra), este operario **declara directamente el
excedente**: su jornal de 8hs/día nunca pasa por el Reporte diario, solo carga un registro cuando
trabaja de más. Por eso la fórmula no resta nada — ya no hay nada que restar:

- `horasCct = 1` (formalismo de `mensualizado`, sin cambios — ver ADR-016).
- `basico = monto vigente` (`SueldoMensualizado`, sin cambios respecto a `mensualizado` normal — no
  usa la categoría UOCRA).
- `horasExtra = horasDeclaradas` (tal cual, sin restar nada).
- `montoExtra = horasExtra × tarifaCategoria × 1.5` (mismo multiplicador que `jornalizado`) — esto
  sí necesita categoría UOCRA, aunque el básico no la use. Un mensualizado normal puede tener
  categoría asignada solo para el bono no remunerativo (ADR-016); con este flag, además pasa a ser
  necesaria para valorizar el extra.
- `horasTotal = horasCct + horasExtra` (= 1 + declaradas) — se mantiene el `+1` formal de
  `mensualizado` (no representa horas reales, es el mismo formalismo que ya usa esa columna para
  cualquier mensualizado) en vez de mostrar solo el extra.
- Si falta el sueldo vigente, ese `datoFaltante` tiene prioridad (bloquea todo el básico); si el
  sueldo está pero falta categoría/tarifa para el extra, se informa un `datoFaltante` distinto y
  puntual — el básico se calcula igual, solo el extra queda en $0 hasta que se asigne la categoría.
- Presentismo: 20% del básico, mismas reglas de pérdida (Ausencia desaprobada / Suspensión) — sin
  cambios respecto al resto de los regímenes.

### Alertas de Control general (>13hs/día, ≥16hs/día) — deliberadamente sin tocar

Esas alertas suman `RegistroHoras.horas` del día tal cual, pensadas para "esto es lo que la
persona trabajó". Para este operario, lo cargado es solo el excedente — un día con 5hs "extra"
cargadas en realidad fue una jornada de 13hs reales, pero la alerta ve "5hs" y no se acerca al
umbral. **Decisión consciente de no ajustar** esas alertas por este caso: es 1 solo operario, caso
conocido y controlado aparte; si el patrón crece a más gente, se revisa.

### Reporte diario / Aprobaciones — sin cambios

Este operario carga y se aprueba exactamente igual que cualquier otro (mismo flujo, mismo
`loteId`, misma bandeja de aprobación). El flag solo afecta el motor de cálculo de liquidación.

## Alternativas consideradas

- **Nuevo valor de enum (`mensualizado_con_extras`)** — descartado: conflaciona dos dimensiones
  distintas (cómo se calcula el básico vs. si genera horas extra) en un solo campo; no escala si
  aparece un segundo caso similar en otro régimen.
- **Reusar `jornalizado` con básico "forzado"** — descartado: `jornalizado` calcula el básico a
  partir de las horas reales declaradas (con tope 88); acá el básico es un monto fijo
  independiente de lo declarado, y lo declarado no es "horas totales" sino directamente "horas
  extra" — son semánticas incompatibles, forzarlo ensuciaría la rama de `jornalizado` con un caso
  especial.
- **Ajustar las alertas de Control general para sumar el jornal implícito** — descartado por ahora:
  agregaría una excepción de caso único a un panel general; no vale la pena para 1 operario, se
  revisa si el patrón crece.

## Consecuencias / notas

- Migración manual (BD compartida, nunca `prisma migrate`/`db push`): `ALTER TABLE
  sth_perfiles_liquidacion ADD COLUMN permite_horas_extra TINYINT(1) NOT NULL DEFAULT 0`. La
  columna es genérica a nivel de tabla (no ligada a un régimen en el schema) — corregir a qué
  régimen aplica fue un cambio solo en `CalculoService` y en el frontend, sin tocar el DDL.
- `CalculoService` gana una rama condicional dentro de `regimen === 'mensualizado'`: si
  `perfil.permiteHorasExtra`, además del básico (monto vigente), lee `horasAprobadasPorCuil` (ya
  se calcula hoy para `jornalizado`) y calcula `horasExtra`/`montoExtra`/`horasTotal` como se
  describe arriba.
- La pantalla `/liquidacion/perfiles` no tiene edición individual separada: el mismo panel de
  "asignación masiva" (checkboxes + régimen/categoría/modalidad) se usa igual para 1 empleado que
  para muchos, vía `UpsertPerfilLiquidacionDto` (que `UpsertPerfilesMasivoDto` extiende). El campo
  nuevo se agrega ahí: un checkbox "Permite horas extra", visible solo cuando el régimen elegido es
  `mensualizado`, viajando en el mismo payload que `regimen`/`categoriaUocraId`/`modalidadPago`.
  Para este caso puntual se aplica seleccionando únicamente a ese operario.
