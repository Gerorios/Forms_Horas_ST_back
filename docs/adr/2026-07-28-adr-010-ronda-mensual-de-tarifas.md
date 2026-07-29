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
