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
Único caso: el bono no remunerativo. "UOCRA no anunció bono" es una decisión
de negocio real y válida — se registra con una fila explícita (valor $0 o
equivalente), no con la ausencia de fila. Ausencia de fila ≠ decisión de
"sin bono": significa que el período todavía no fue revisado.
**Desde 2026-08-30 el bono se resuelve por QUINCENA** (categoría + año + mes
+ quincena), no por mes: UOCRA puede anunciar un bono para una quincena
puntual. Las demás tarifas siguen siendo mensuales.
_Avoid_: bono mensual (granularidad vieja, ya no existe).

**Cierre de liquidación quincenal** (2026-08-30):
Snapshot versionado del cálculo de una quincena: congela en tablas de hechos
propias (`sth_cierres_liquidacion` + detalle + días trabajados) el resultado
por empleado, con todos los valores desnormalizados. **No bloquea nada**: las
horas, novedades y precios del período siguen editables; si algo cambia, el
cierre no se entera — es la foto de lo que se envió al liquidador de sueldos.
El Excel de la preliquidación sale ÚNICAMENTE de un cierre, nunca del cálculo
en vivo.
_Avoid_: cierre de quincena como bloqueo (acá no existe candado), liquidar
(eso lo hace el liquidador de sueldos en el sistema de sueldos real).

**Versión vigente** (de un cierre):
La de `version` más alta de esa quincena — derivada, no un flag. Recerrar
crea una versión nueva (con nota obligatoria explicando el motivo); las
anteriores quedan intactas para siempre, para poder responder "¿qué le
enviamos al liquidador el día X?".

**Salvedad** (de un cierre):
Problema conocido al momento de cerrar (horas pendientes de aprobar, empleado
sin perfil, precio sin resolver, sin km, sin zona). El cierre avisa y exige
confirmación, pero **nunca bloquea** — las salvedades quedan grabadas en el
cierre para que quien mire la versión después sepa con qué se cerró.

**Liquidador de sueldos** (externo):
La persona/estudio que carga la preliquidación en el sistema de sueldos real
y emite los recibos. Recibe el Excel del cierre, con el personal separado en
hojas por zona porque resuelve cada grupo de manera distinta. No es un rol de
esta app.
_Avoid_: confundirlo con el rol **Liquidador** de la app (quien preliquida).

**Zona (NORTE / SUR)** (2026-08-30):
Partición del personal para el liquidador de sueldos, que resuelve cada grupo
de manera distinta. Se deriva de `snuempleados.provincia` (domicilio del ERP,
mantenido al día por la empresa): **NORTE = SALTA + JUJUY, SUR = TUCUMAN**.
La localidad no participa (viene sucia; manda la provincia). Una provincia
vacía o no mapeada = empleado **sin zona**: alerta visible, nunca cae en una
zona por default silencioso.
_Avoid_: sede, sucursal, región (no existen como conceptos acá); deducir la
zona por localidad.

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

### Control general (panel del Jefe de Contrato)

**Mis contratos** (de un jefe):
Los contratos en los que el usuario figura como jefe. Para Admin son todos.
Definen qué puede aprobar y editar, y quiénes son sus operarios — nunca
recortan las horas que se le muestran de esas personas.

**Operario del jefe** (2026-09-03):
Persona con al menos una carga en alguno de mis contratos en la quincena
consultada. Los filtros del panel (contrato, provincia, operario) achican esta
lista de personas, nunca sus horas. Es la única regla de inclusión del panel:
tiles, ranking, histórico, Detalle diario y zona de revisión la comparten.
_Avoid_: operario de mi contrato, mi operario (sugiere que la persona es
exclusiva del contrato; en la práctica trabaja para varios).

**Horas completas** (de un operario, 2026-09-03):
Todas las horas del operario en la quincena, sumando todos los contratos
(míos y ajenos), pendientes más aprobadas, sin las desaprobadas. Es el número
que muestran el tile "Horas de la quincena", el ranking, el histórico y el
total de la jornada del Detalle diario, y sobre el que se evalúa el umbral de
horas extra (88 hs por quincena). Lo que el jefe controla es a la persona, no
al contrato: ver solo las horas de su contrato le ocultaba una jornada real
mayor y llevaba a controles equivocados.
_Avoid_: horas del contrato, horas propias (es el número parcial que confundía).

**Horas en mis contratos**:
La porción de las horas completas cargada en mis contratos. Se muestra de
forma discreta junto al total ("incluye N hs en otros contratos", tooltip del
ranking) para que el jefe sepa de dónde sale la diferencia. Las filas
pendientes de revisar sí se cuentan solo sobre mis contratos: las ajenas las
aprueba otro jefe.
