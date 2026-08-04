# ADR-010: Ronda mensual de tarifas (reemplaza el date-picker de ADR-009)

## Contexto

ADR-009 definió el patrón "tarifa vigente": cada tabla de precios
(`TarifaCategoriaUocra`, `MontoNovedadPlus`, `RangoKmPorTantos`) tenía un campo
`vigenteDesde` de tipo fecha (cualquier día), y el cálculo tomaba la fila con
vigencia más reciente ≤ la fecha buscada.

Al usarlo en la práctica, el usuario encontró dos problemas reales:
1. **Elegir un día no tiene sentido** — los ajustes de tarifas son mensuales,
   no diarios. Un date-picker de día sugiere una precisión que no existe.
2. **Sin garantía de continuidad** — si un mes se olvida cargar, "qué precio
   regía en ese mes" queda ambiguo/implícito (se infiere del último cargado,
   pero nunca se decide explícitamente qué pasó ese mes).

También surgió un dato de dominio nuevo: **las 3 tarifas (categorías UOCRA,
montos de novedad con plus, rangos de km) se ajustan todas juntas, en una
misma ronda mensual** — no hay ajustes independientes por tarifa.

## Decisión

Se reemplaza el date-picker por día por una **ronda mensual única**: una sola
pantalla "Cargar tarifas de [mes/año]" que junta las 3 tarifas.

### Garantía: nunca hay huecos

Se agrega `RondaTarifas { anio, mes }` (PK compuesta) que registra qué
períodos quedaron efectivamente cargados. Al cargar una ronda para un
mes/año objetivo:
1. Se calculan los meses **faltantes** entre el último período cargado
   (exclusive) y el objetivo (exclusive).
2. Esos meses faltantes se completan **automáticamente copiando el último
   valor conocido** de cada categoría/tipo de novedad/rango — no hay otra
   opción para ellos: nadie puede recordar retroactivamente un valor distinto
   para un mes que no se revisó en su momento.
3. Para el mes objetivo (el que el Liquidador realmente quiere cargar), se le
   ofrece elegir: **copiar** el último valor conocido (igual que los meses
   faltantes) o **cargar a mano** valores nuevos — la pantalla igual
   prellena con el último valor conocido como punto de partida editable.
4. Si no hay huecos (el objetivo es exactamente el mes siguiente al último
   cargado), se salta directo al formulario prellenado, sin preguntar nada.
5. Si es la primera carga de todas (no hay `RondaTarifas` previa), no hay
   nada que copiar — el formulario arranca vacío.

Con esto, "qué precio regía en tal período" siempre tiene una fila explícita
que responde la pregunta, generada por el sistema (copia) o por el
Liquidador (carga manual), nunca implícita.

### Qué NO cambia

- Las tablas `TarifaCategoriaUocra`/`MontoNovedadPlus`/`RangoKmPorTantos`
  siguen existiendo con la misma forma; `vigenteDesde` sigue siendo la
  columna de fecha, pero ahora **siempre** es el día 1 del mes de la ronda
  (por convención de la app, no una restricción de base).
- El catálogo de Categorías UOCRA (alta, activar/desactivar) sigue siendo
  una pantalla aparte — la ronda mensual solo carga el **precio** de las
  categorías ya existentes, no las crea.

### Consecuencia operativa

Se borran las tarifas/montos/rangos de prueba cargados con el date-picker
viejo (tenían días arbitrarios, no día 1) para arrancar la primera ronda
real desde cero. Las categorías UOCRA y los perfiles de empleados no se
tocan.

## Alternativas consideradas

- **Aviso no bloqueante, permitir huecos** — descartada: el usuario prefirió
  la garantía dura de que un hueco se resuelve antes de poder seguir, para
  que la pregunta "qué precio regía" nunca quede sin respuesta.
- **Rondas independientes por tarifa** (categorías, novedades, km cada una
  con su propio ciclo) — descartada: en la práctica las 3 se ajustan juntas
  en la misma ronda mensual.

## Amendment 2026-08-04 — edición de períodos cargados

Decisión de producto: los valores de un período **ya cargado** ahora se
pueden editar, no solo agregar hacia adelante. Se agregan:

- `GET /liquidacion/tarifas/ronda/:anio/:mes` — trae los valores vigentes de
  ese período puntual (tarifas por categoría, montos de novedad con plus,
  rangos de km, bonos por categoría) para prellenar la edición. 404 si el
  período no tiene `RondaTarifas`.
- `PUT /liquidacion/tarifas/ronda/:anio/:mes` — sobrescribe esos valores,
  con auditoría completa en `Auditoria` (quién, cuándo, valor anterior →
  nuevo) por cada campo que cambió. Si el valor no cambió, no se genera
  fila de auditoría.

### Por qué

La inmutabilidad estricta del diseño original resultó demasiado rígida en
la práctica: UOCRA a veces corrige un monto que ya había publicado, o el
Liquidador detecta un error de tipeo en una ronda cargada hace semanas, y
la única forma de corregirlo bajo la regla vieja era esperar a la próxima
ronda — dejando el período histórico con un valor que todos saben que está
mal. La necesidad real de corregir precios pesa más que la garantía de
inmutabilidad; el **rastro de auditoría reemplaza** a la inmutabilidad como
mecanismo de confianza: "qué precio regía en tal mes" se sigue pudiendo
responder, pero ahora es "el valor actual, más su historia de cambios en
la auditoría" en lugar de "un valor que nunca se tocó".

La UI debe avisar, al editar un período ya cargado, que el cambio puede
implicar un **recálculo retroactivo** de liquidaciones ya calculadas con
el valor viejo (no hay concepto de "cierre de quincena" que lo bloquee).

### Qué NO cambia

- La regla forward-only de `POST /liquidacion/tarifas/ronda` (carga de
  **períodos nuevos**, con relleno automático de huecos) sigue intacta —
  este amendment solo habilita editar valores de un período que ya tiene
  fila en `RondaTarifas`, no saltar ni recargar rondas fuera de orden.
- Los rangos de km, al editarse, se reemplazan por completo (no hay un id
  estable por rango para hacer diff campo a campo) — la auditoría de ese
  reemplazo guarda el array viejo y el nuevo completos, serializados.
