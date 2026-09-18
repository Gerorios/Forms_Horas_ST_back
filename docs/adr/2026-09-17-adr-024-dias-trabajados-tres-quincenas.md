# ADR-024: La foto de días trabajados del cierre congela tres quincenas corridas

**Fecha:** 2026-09-17
**Enmienda ADR-021 §2 y §3** (hoja DIAS TRABAJADOS).

## Contexto

La hoja DIAS TRABAJADOS del Excel de cierre se usa para pagar feriados. El
liquidador de sueldos necesita ver, junto con la quincena que se cierra, los
días trabajados del mes anterior: la regla del feriado mira hacia atrás. Hasta
hoy `sth_cierre_dias_trabajados` congelaba solo los días de la quincena cerrada,
así que la hoja quedaba corta y el liquidador completaba a mano.

## Decisión

Al crear un cierre se congelan los días trabajados de **tres quincenas
corridas**: la cerrada y las dos anteriores (equivale a "un mes atrás"). La
regla de "día trabajado" no cambia: al menos un registro no desaprobado ese
día. Aparece todo empleado con al menos un día en la ventana, aunque no tenga
ninguno en la quincena cerrada. La hoja muestra los días agrupados por mes
calendario con un **Total por mes** al final de cada bloque, sin total general.

Los cierres creados antes de este cambio no se rellenan: si la foto no tiene
días previos a la quincena cerrada, la hoja se arma solo con esa quincena. Un
recierre con nota genera la ventana completa.

## Opciones descartadas

- **Leer los cierres vigentes de las quincenas anteriores al exportar.** Si
  una quincena no se cerró, la hoja sale vacía para ese tramo, y el archivo
  deja de depender de un solo cierre.
- **Leer los registros vivos al exportar.** Mezcla foto congelada con datos
  editables: rompe la garantía de ADR-021 de que el archivo que viajó y lo que
  quedó registrado son la misma cosa.

## Consecuencias

- La tabla no cambia de forma (sin DDL): solo triplica aproximadamente sus
  filas por cierre.
- Un mismo día trabajado queda congelado hasta en tres cierres distintos. Eso
  es deliberado: cada cierre es una foto autónoma de lo que viajó.
- `sth_cierre_dias_trabajados` deja de ser "los días del período del cierre";
  el único lector (la exportación) deriva la ventana de las fechas presentes.
