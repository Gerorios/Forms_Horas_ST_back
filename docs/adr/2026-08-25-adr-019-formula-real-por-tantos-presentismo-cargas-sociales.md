# ADR-019 — Fórmula real de "por tantos": presentismo/cargas sociales en la conversión km→horas y el monto en B (amienda ADR-015)

**Fecha:** 2026-08-25
**Estado:** Aceptado
**Afecta:** `src/liquidacion/calculo.service.ts` (fórmula de `por_tantos`),
`src/features/liquidacion/tabla-por-tantos.tsx` (frontend, columnas de la
tabla de relevadores).

## Contexto

ADR-009 fijó la conversión de "por tantos" (relevador de fugas) como
`horasTotal = montoKm ÷ tarifaHora`, sin ningún ajuste — el monto de km
(km × precio del rango) se dividía directo por la tarifa de categoría para
sacar las horas equivalentes.

Al contrastar el panel contra un recibo real (OSCAR, relevador, junio 2026
1ra quincena) se detectó que el extra en B no coincidía: el sistema daba un
monto y el recibo real otro. Se probaron y descartaron dos hipótesis
intermedias antes de llegar a la fórmula correcta:

1. `horasTotal = montoKm ÷ (tarifa × 0.815)` (18.5% de cargas sociales como
   descuento multiplicativo directo) — descartada, no cerraba contra ningún
   caso real.
2. `horasTotal = montoKm ÷ (tarifa ÷ 1.0185)` — descartada tras confirmar
   con un segundo caso real (CORBALAN, julio) que tampoco reproducía el
   monto en B correcto.

La explicación real, dada por el dueño de producto: el monto de km **ya es
neto** (dinero en mano, sin el bono no remunerativo si no hay). Ese mismo
monto neto también se puede escribir como
`horas × tarifa × 1,2 (presentismo +20%) × 0,815 (cargas sociales −18,5%)`
— de esa igualdad se despeja `horasTotal`. El bono no remunerativo queda
totalmente afuera de esta ecuación: es una línea separada, no entra ni en
el lado del monto neto ni en el lado de la conversión.

Validado al centavo contra los dos casos reales:

- **OSCAR** (junio 1Q, sin bono): básico $460.680, presentismo $92.136
  (ambos ya correctos antes del cambio), monto en B **$170.655** — cierra
  exacto con `montoKm − básico×0,978` usando el km ya cargado (no era un
  problema de dato, era la fórmula).
- **CORBALAN** (julio 2Q, con bono $33.550): monto en B **$434.079,31** —
  confirmado que el bono no participa de este cálculo.

## Decisión

- **`horasTotal`**: `montoKm ÷ (tarifa × 1,2 × 0,815)` — es decir,
  `montoKm ÷ (tarifa × 0,978)`. Constante fija en el código (no editable
  por período): `PRESENTISMO_Y_CARGAS_SOCIALES_FACTOR = 1.2 * 0.815`. Se
  sigue usando `horasCct = min(horasTotal, 88)` y
  `horasExtra = max(horasTotal − 88, 0)` sin cambios, como umbral y como
  dato informativo (Hs Totales / Hs Extra en la UI) — pero **el monto en B
  ya no sale de `horasExtra × tarifa`**.
- **Monto en B (el campo que antes ADR-015 llamaba "extra")**: cuando
  `horasExtra > 0`, es el residual `montoKm − (básico_88hs × 0,978)`. Si
  `horasTotal ≤ 88`, no hay residual — es el "cálculo común" que ya existía
  (básico = horasTotal × tarifa completa, sin B).
- **Básico** (`tarifaHora × horasCct`) sigue usando la tarifa **completa**
  de categoría, sin ningún ajuste — el factor 0,978 solo se usa para
  despejar horas y para el residual del monto en B, nunca para el valor por
  hora pagado directamente.
- **El bono no remunerativo no participa de esta cuenta** — ni del lado
  del "monto neto" ni del residual. Sigue siendo, como ya era, una columna
  totalmente aparte que se suma al final.
- **Frontend — rediseño de columnas de la tabla de relevadores**
  (`tabla-por-tantos.tsx`, pedido del dueño de producto tras validar la
  fórmula): "Monto bruto" pasa a llamarse **"Monto neto"** (nunca fue
  bruto). Se elimina la columna "TOTAL" y se reemplaza por dos columnas al
  final: **"Monto A"** (Total bruto + Presentismo + Bono) y **"Monto B"**
  (el residual de arriba, mismo valor que antes mostraba "$$ Hs Extras en
  B" — se saca esa columna del medio de la tabla y se deja solo al final,
  junto a Monto A).

## Qué NO cambia

- `montoKmBruto` (km × precio del rango) sigue calculándose exactamente
  igual — el nombre de la variable interna no cambió, aunque en la UI ahora
  se llame "Monto neto".
- Presentismo (20% del básico) y bono no remunerativo: cálculo y columnas
  sin cambios.
- Sin multiplicador ×1,5 en el extra (ADR-015 sigue vigente en ese punto) —
  de hecho, ahora es aún más explícito que no aplica, porque el monto en B
  no se calcula multiplicando horas por nada.
- Sin cambios de schema ni DDL.
- Se aplica sin corte por fecha — el motor de cálculo recalcula en vivo
  cualquier quincena que se consulte, pasada o futura, con la fórmula
  vigente (mismo criterio que el resto del motor: no versiona fórmulas por
  fecha).

## Consecuencias / notas

- Recalcula automáticamente TODAS las quincenas de relevadores ya
  liquidadas la próxima vez que se abran — es una corrección de fórmula,
  no un cambio de alcance temporal.
- De paso se corrigió un bug no relacionado, encontrado mientras se
  investigaba este caso: la comparación de "resuelto" en Tarifas
  (`liquidacion.service.ts`) usaba `new Date(anio, mes-1, 1)` en hora
  local (el server corre en `America/Buenos_Aires`, UTC-3), lo que hacía
  fallar silenciosamente la comparación contra `vigenteDesde` (guardado
  como medianoche UTC exacta). Corregido a `Date.UTC(...)` /
  `getUTCFullYear()`/`getUTCMonth()` — no afectaba el cálculo de
  liquidación en sí (ese usa comparación a nivel SQL, que sí toleraba el
  desfase), solo la pantalla de Tarifas mostraba "sin resolver" para
  períodos que en realidad sí lo estaban.
