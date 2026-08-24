# Formulario Horas — Backend

Sistema de carga, aprobación y liquidación de horas trabajadas para personal
de obra (UOCRA) y de estructura, con novedades (ausencias, viáticos, guardias)
y control de contratos por jefe.

## Language

### Precios y liquidación

**Período de tarifas**:
Un mes calendario (`anio`, `mes`) para el cual el Liquidador debe fijar
explícitamente los precios vigentes de ese mes — tarifa por categoría, bono no
remunerativo, monto de novedad con plus, rango de km por tantos, sueldo
mensualizado. Cada período es independiente: no hereda ni bloquea a otros.
_Avoid_: mes de la ronda, vigencia (ambiguo — no aclara si es del período
pedido o de uno anterior heredado).

**Precio resuelto** (de un período):
Existe una fila propia con `vigenteDesde` = el día 1 exacto de ese período,
para ese campo (categoría/tipo de novedad/etc.) — grabada por una carga o
edición explícita del Liquidador, nunca copiada automáticamente por el
sistema entre períodos.
_Avoid_: precio cargado, precio vigente (no distingue "resuelto para este
período puntual" de "heredado de un período anterior").

**Precio sin resolver**:
Un período para el que no existe fila propia en un campo obligatorio. Se
muestra como alerta en la tabla de preliquidación (mismo mecanismo que
`datoFaltante`); nunca se completa en silencio con el valor de otro período,
y no bloquea el cálculo de otros períodos.

**Campo obligatorio** (de precios):
Tarifa por categoría, monto de novedad con plus, rango de km por tantos,
sueldo mensualizado. Sin fila propia para el período, es un **precio sin
resolver** — alerta, nunca un default silencioso.

**Campo opcional** (de precios):
Único caso: el bono no remunerativo. "UOCRA no anunció bono este mes" es una
decisión de negocio real y válida — se registra con una fila explícita (valor
$0 o equivalente), no con la ausencia de fila. Ausencia de fila ≠ decisión de
"sin bono": significa que el período todavía no fue revisado.

**Plus individual** (2026-08-21):
Un monto extra que el Liquidador carga a mano para un empleado puntual en una
quincena puntual, con un motivo — independiente de su categoría UOCRA y del
bono no remunerativo (un empleado puede tener ambos a la vez, o solo uno).
No es un "precio" versionado por período: es un dato puntual de esa
liquidación, mismo patrón que `KmPorTantos` — vive en la pantalla de Tarifas
como una sección más (agrupación de UI, decisión de producto 2026-08-21),
pero conceptualmente sigue sin pasar por la ronda mensual de tarifas: no
tiene "resuelto"/"sugerencia" como el resto de las secciones, y puede
cargarse a varios empleados a la vez si comparten monto y motivo.
_Avoid_: bono particular, bono individual (confunde con el bono no
remunerativo, que es por categoría y por mes, no por persona y por quincena).
