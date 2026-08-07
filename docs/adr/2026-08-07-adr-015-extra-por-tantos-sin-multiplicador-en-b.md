# ADR-015 — Extra de "por tantos" sin multiplicador 1.5x, pagado en B, tabla propia

**Fecha:** 2026-08-07
**Estado:** Aceptado
**Afecta:** `src/liquidacion/calculo.service.ts` (fórmula de `por_tantos`),
`/liquidacion/quincena/detalle` (frontend: tabla nueva separada para
`por_tantos`).

## Contexto

El motor de cálculo (ADR-009/ADR-011) trata las horas equivalentes de "por
tantos" igual que jornalizado en todo sentido, incluido el multiplicador de
hora extra (×1.5) sobre el excedente de 88hs/quincena. Al revisar el panel
con datos reales, el dueño de producto marcó que ese supuesto está mal para
este régimen: el extra de un relevador **no lleva el 1.5x** (se paga al
mismo precio de su categoría, sin más) y además **siempre se paga en B**,
sin relación con el campo `modalidadPago` del empleado.

Se verificó primero que no había ningún bug en la traducción km→horas (esa
parte ya estaba bien — ver sesión previa de grilling); este es un ajuste de
regla de negocio nuevo, no una corrección de un error de cálculo.

## Decisión

- **Sin multiplicador**: para `regimen === 'por_tantos'`,
  `montoExtra = horasExtra × tarifaHora` (antes: `× 1.5`). Exclusivo de
  este régimen — `jornalizado` sigue con `× 1.5` sin cambios.
- **Siempre en B**: el monto extra de "por tantos" se etiqueta como pagado
  en B en la UI, independiente de `modalidadPago` (que ya no se usa ni se
  muestra para este régimen — el dueño de producto adelantó que ese campo
  se va a eliminar más adelante, pero no es parte de este cambio). No hay
  cálculo de descuentos: solo se identifica el monto.
- **Tabla propia en el detalle de quincena**: `/liquidacion/quincena/detalle`
  pasa a mostrar **dos tablas**: la de siempre (jornalizado/fijo/mensualizado,
  sin cambios) y una nueva exclusiva para `por_tantos` con columnas Empleado,
  Categoría, Km, Monto bruto, Horas totales, Horas CCT, Básico, Horas extra,
  **Extra (en B)**, Presentismo, Total — sin modalidad de pago. Comparte los
  filtros de Empleado/Categoría de la barra superior; el filtro de Contrato
  no le aplica (los relevadores no tienen `dias`/contrato asociado).
- El resto de la fórmula de `por_tantos` no cambia: básico, presentismo (20%
  del básico), plus de novedades y bono no remunerativo siguen igual.

## Alternativas consideradas

- **Mantener una sola tabla con una columna condicional.** Se descartó: las
  columnas de "por tantos" (km, monto bruto) no tienen sentido para el resto
  de los regímenes, y viceversa (modalidad de pago no aplica acá) — una tabla
  mixta con columnas que la mitad de las filas dejan vacías es más confusa
  que dos tablas con su propio shape.

## Consecuencias / notas

- Sin cambios de schema ni DDL — es puramente un cambio de fórmula
  (`calculo.service.ts`) y de presentación (frontend).
- `CalculoService.calcularQuincena` no tenía tests automatizados todavía
  (deuda ya señalada en §47 del contexto); se suma cobertura mínima de la
  fórmula de `por_tantos` como parte de este cambio.
