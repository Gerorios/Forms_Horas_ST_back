# ADR-011: Motor de cálculo de liquidación — hallazgos contra datos reales

## Contexto

Antes de construir el motor de cálculo (Fase 2), el usuario compartió un
extracto real del excel que usa hoy para liquidar. Contrastarlo con el
diseño de ADR-009 confirmó varias fórmulas exactas, pero también corrigió
supuestos equivocados. Este ADR documenta los hallazgos.

## Fórmulas confirmadas exactas contra los números reales

- **Horas CCT** (horas que cuentan para el básico) = `min(horas declaradas, 88)`.
- **Sueldo básico** = `tarifa categoría × horas CCT`.
- **Horas extra** = `horas declaradas - 88` (si es positivo).
- **$ Horas extra** = `horas extra × tarifa categoría × 1.5`.
- **Presentismo** = `20% × sueldo básico` — confirmado que aplica igual sin
  importar el régimen (jornalizado, fijo, mensualizado, por tantos), siempre
  que no se haya perdido por Ausencia desaprobada o Suspensión (ver ADR-009).

## Correcciones al régimen (ADR-009 quedaba incompleto)

**Son 5 regímenes, no 4** (se agrega `mensualizado`):

1. **`jornalizado`** — sin cambios: básico según horas reales declaradas.
2. **`fijo`** — sin cambios: básico = tarifa categoría × 88 (fijo, no depende
   de horas reales). Existe como caso real, distinto de mensualizado.
3. **`mensualizado`** *(nuevo)* — un sueldo bruto fijo cargado **directamente
   por el Liquidador cada período**, sin categoría UOCRA ni fórmula de horas
   de por medio. No genera horas extra (no hay concepto de horas). Sí genera
   presentismo (20% de ese monto, confirmado con datos reales).
4. **`por_tantos`** — se confirma que sigue siendo un régimen exclusivo
   (aparte de jornalizado/mensualizado), pero con un mecanismo más específico
   de lo que se había asumido: el monto que le corresponde por los km del
   período **se convierte a horas equivalentes** (`monto ÷ tarifa de su
   categoría`), y con esas horas equivalentes se corre la **misma fórmula de
   jornalizado** (horas CCT, básico, horas extra si supera 88) — porque el
   recibo de sueldo tiene que mostrarlo como pago por hora, no como un monto
   suelto. Por eso `por_tantos` **sí necesita categoría UOCRA asignada**
   (ADR-009 decía que no aplicaba — estaba mal). Estas horas equivalentes
   **reemplazan** cualquier hora real declarada por reporte diario, no se
   suman a ella.
5. **`administrativo`** — sin cambios: excluido del circuito.

Lo que **no** cambia: la corrección que se creyó necesaria al ver "Jornalizado/X
Tanto" en el excel (pensar que "por tantos" era un plus combinable, no un
régimen exclusivo) **era un malentendido** — ese texto era una anotación
personal de quien arma la planilla ("es jornalizado pero hay que convertirlo
a horas"), no una indicación de régimen doble. `por_tantos` sigue siendo
mutuamente excluyente con los demás.

## Corrección a "modalidad de hora extra"

El campo `PerfilLiquidacion.modalidadHoraExtra` (en_b / con_descuentos) en
realidad describe la modalidad de **horas extra Y presentismo juntos**, no
solo de horas extra — confirmado por la columna de texto "Hs Extra y
Presentismo en B" del excel real. Se renombra a `modalidadPago` para que el
nombre no induzca a error (sigue siendo el mismo tipo de dato, mismos dos
valores).

## Columna "NOVEDADES" del excel: es texto, no un monto

No hay que calcular ningún importe para esa columna — es una etiqueta
descriptiva generada para el recibo (ej. "Hs Extra y Presentismo en B",
"VIATICOS Y HS Extra"), que resume en texto qué componentes no estándar tiene
esa persona en el período. Se arma como parte de la presentación del
resultado, no como parte del cálculo numérico.

## Columnas de plus confirmadas

- **PRODUCTIVIDAD** (nombre real de la columna, aunque el usuario prefiere
  llamarlo internamente "viáticos/gastos") = novedad "Viáticos" × monto por
  día vigente, exactamente el mecanismo de `MontoNovedadPlus` ya diseñado en
  ADR-009. Sin cambios de diseño, solo se confirma el mapeo.
- **GUARDIAS** = novedad "Guardia Pasiva" × monto por día (típicamente
  sábado + domingo), mismo mecanismo. Sin cambios.
- **NO REMUNERATIVO** = bonos extraordinarios que UOCRA otorga
  periódicamente, que no cuentan para aguinaldo ni otros cálculos legales.
  **Todavía no está modelado** — a diferencia de los plus de novedad (que
  dependen de que un operario tenga una Novedad puntual cargada), esto suena
  a un bono que UOCRA anuncia y que aplicaría de forma más general (¿por
  categoría? ¿a todos?). Queda pendiente de una nueva ronda de preguntas
  antes de implementarlo.

## Monto mensualizado — variable por persona y por período

Cambia seguido (no es un dato estable del perfil): se agrega a la **ronda
mensual de tarifas** (ADR-010) una sección más, `MontoMensualizado { cuil,
vigenteDesde, monto }` — mismo patrón "tarifa vigente" que las demás, pero
por `cuil` (una fila por cada empleado con régimen `mensualizado`) en vez de
por categoría. Sigue el mismo mecanismo de huecos: si se saltea un mes, se
copia el último monto conocido; para el mes que se está cargando, se
prellena y se puede dejar igual o cambiar.

## Bono no remunerativo — por categoría, monto fijo o porcentaje

Varía por categoría UOCRA (no es un monto único para todos), y puede
cargarse de dos formas distintas según lo que anuncie UOCRA ese período:
- **Monto fijo** — un $ directo para esa categoría.
- **Porcentaje** — un % que se aplica sobre la **tarifa por hora** de la
  categoría (no sobre el básico ya multiplicado por horas — no depende de
  cuánto trabajó esa persona en la quincena).

Se agrega `BonoNoRemunerativo { categoriaUocraId, vigenteDesde, tipo:
'monto_fijo' | 'porcentaje', valor }` — mismo patrón de tarifa vigente,
también parte de la ronda mensual. Si no hubo anuncio ese mes, queda en 0
(no hace falta forzar carga como con las demás tarifas — este es opcional
por naturaleza).

## Pendiente para cerrar antes de implementar Fase 2

1. Formato exacto del reporte/pantalla final (columnas, exportación a
   Excel/PDF si hace falta).
