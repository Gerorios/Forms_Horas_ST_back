# ADR-016 — Sueldos mensualizados: patrón "vigente" gestionado desde Tarifas

**Fecha:** 2026-08-10
**Estado:** Aceptado
**Afecta:** `sth_montos_mensualizados` (se borra), tabla nueva `sth_sueldos_mensualizados`,
`GET`/`PUT /liquidacion/tarifas/sueldos-mensualizados`, sección nueva en el frontend de
Tarifas, `/liquidacion/quincena/detalle` (fila de mensualizado pasa a solo lectura).

## Contexto

El régimen `mensualizado` (sueldo fijo, sin depender de categoría UOCRA ni de horas — ver
ADR-011) usaba `MontoMensualizado`, una tabla con clave exacta `{cuil, año, mes, quincena}`:
había que cargar el sueldo de cada persona en cada quincena puntual, incluso si no cambiaba
respecto a la anterior. La tabla nunca llegó a usarse con datos reales (0 filas en `testing` y
en producción) — el dueño de producto pidió, antes de que arrancara a usarse, poder gestionar
estos sueldos desde la pantalla de Tarifas (igual que el resto de los precios del sistema) y
poder aplicar incrementos porcentuales a todos los mensualizados de una.

## Decisión

- **Patrón "vigente"** (igual que `TarifaCategoriaUocra`): tabla nueva `SueldoMensualizado
  { cuil, vigenteDesde, monto }`, versionada por mes (`vigenteDesde` siempre día 1 de un
  mes) — se carga una vez y aplica en todas las quincenas de ahí en adelante hasta el
  próximo cambio. Reemplaza directamente a `MontoMensualizado`, que se borra (sin datos que
  migrar).
- **Sección propia dentro de Tarifas** ("Sueldos mensualizados"): lista de todos los
  empleados con `PerfilLiquidacion.regimen = 'mensualizado'` + campo editable, separada del
  formulario corto de categorías UOCRA/rangos de km/plus de novedades — es una lista por
  persona (hoy 11, puede crecer), no un catálogo fijo de pocas filas.
- **Fila explícita todos los meses** (misma regla que ADR-010, "nunca un mes sin resolver
  explícitamente"): al abrir un mes se prellena con el valor del mes anterior (huecos
  completados automáticamente) y al guardar se crea una fila real para ese mes por cada
  empleado, cambie o no — permite auditar/editar cualquier mes puntual después.
- **Comparte el estado de "mes resuelto" con la ronda de tarifas**: usa la misma tabla
  `RondaTarifas{anio,mes}` que ya trackea categorías/km/plus/bono. **Sin orden obligatorio**:
  cualquiera de las dos secciones (ronda de categorías o sueldos mensualizados) puede "abrir"
  un mes nuevo primero; la otra la reutiliza.
- **Incremento por %**: el botón "aplicar X% a todos" es puramente de UI — recalcula
  `último vigente × (1 + %)` y rellena los campos editables de la lista, pero **no guarda
  nada** hasta tocar "Guardar" (mismo criterio que ya usa la ronda de tarifas). Mientras
  tanto se puede pisar a mano el valor de cualquier persona puntual antes de confirmar — las
  dos vías (edición 1x1 y % masivo) conviven, la segunda es solo un atajo para prellenar la
  primera. Un mensualizado nuevo sin ningún sueldo vigente previo queda con el campo vacío
  (el % no tiene de dónde partir); se carga a mano la primera vez.
- **`/liquidacion/quincena/detalle` pasa a ser de solo lectura** para el monto de
  mensualizado — mismo criterio que ADR-014 con el km de "por tantos": una sola fuente de
  verdad (Tarifas), el Liquidador ya no edita el sueldo ahí.
- **Auditoría**: cada carga o edición de un sueldo mensualizado (nuevo o ya cargado) deja
  fila en `sth_auditoria` (quién, cuándo, valor anterior → nuevo), igual que el resto del
  módulo de Tarifas.

## Alternativas consideradas

- **Mantener la clave exacta por quincena** (`MontoMensualizado` tal cual, solo agregando un
  atajo de "copiar del mes anterior" y un botón de % en esa misma pantalla). Descartado: no
  resuelve el problema real — seguiría existiendo el concepto de "falta cargar esta
  quincena" incluso cuando el sueldo no cambió, y no encaja con la idea de gestionarlo desde
  Tarifas como el resto de los precios del sistema.
- **Meter los sueldos dentro del mismo formulario único de la ronda** (categorías + km +
  plus + bono + sueldos, un solo submit). Descartado: es una lista por persona que puede
  crecer, no un catálogo fijo de pocas filas — mezclarla en el mismo formulario corto lo
  vuelve largo y confuso a medida que crece la nómina de mensualizados.
- **Huecos implícitos** (el motor de cálculo toma el último valor cargado sin necesidad de
  una fila por mes). Descartado explícitamente por el dueño de producto: prefiere mantener
  la misma regla que el resto de Tarifas (fila explícita siempre), a pesar de ser más
  trabajo de storage, para tener un registro real de "en tal mes valía tanto" auditable mes
  a mes.
- **Tracking de "mes resuelto" independiente por sección** (una tabla nueva solo para
  sueldos). Descartado explícitamente por el dueño de producto: prefiere un solo concepto de
  "mes cargado" en toda la pantalla de Tarifas, reusando `RondaTarifas`.

## Consecuencias / notas

- Migración manual (BD compartida, nunca `prisma migrate`/`db push`): `DROP TABLE
  sth_montos_mensualizados` (0 filas, confirmado en `testing` y `Horas_Sertec`) + `CREATE
  TABLE sth_sueldos_mensualizados` (mismo patrón de columnas/constraints que
  `sth_tarifas_categoria_uocra`).
- El motor de cálculo (`CalculoService`) deja de leer `MontoMensualizado` por
  `{cuil,anio,mes,quincena}` exacto y pasa a resolver el sueldo vigente de cada mensualizado
  con el mismo patrón `masVigente` que ya usa para tarifas de categoría — sin cambios en el
  resto de la fórmula (horasTotal=1, horasCct=1, básico=monto, sin extra, presentismo 20%).
- Los 11 perfiles `mensualizado` que ya existen en producción (con categoría UOCRA asignada,
  que el cálculo ignora) quedan sin ningún sueldo vigente hasta que el Liquidador los cargue
  por primera vez desde la sección nueva.
