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

**Presentismo**:
20% del sueldo básico (mismo tope de 88hs). Se pierde siempre con una
Suspensión, o con una Ausencia injustificada (`estadoHys='desaprobada'`) o
aún sin resolver (`'pendiente'`). Con una Ausencia justificada (`'aprobada'`)
depende del caso: HyS decide explícitamente, al justificar, si esa ausencia
puntual pierde presentismo o no — no todas las justificadas se comportan
igual (ej. una licencia especial no lo pierde, una enfermedad común sí,
aunque ambas estén justificadas con certificado válido). Ver ADR-022, que
revierte parcialmente la decisión de 2026-08-19 ("cualquier Ausencia lo
pierde, sin importar el certificado").
_Avoid_: "toda ausencia pierde presentismo" (regla vieja, ya no vale para
las justificadas).

**`pierdePresentismoHys` (de una Ausencia)**:
Booleano nullable en `Novedad`, con valor únicamente cuando
`estadoHys='aprobada'` — en cualquier otro estado queda `null` y no se
consulta (esos casos siempre pierden presentismo por regla fija). Es de
carga obligatoria al justificar, sin default: HyS lo tilda en el mismo
diálogo donde ya deja el `descargoHys` (que es también donde escribe el
motivo de esta decisión puntual). Se resetea a `null` al reabrir la
novedad. Ver ADR-022.

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

### Carga de certificaciones (Naturgy)

**Certificación** (de Naturgy):
Documento mensual (Excel o PDF) que Naturgy emite por contrato K con las
filas de ítems certificados y un **total declarado**. Es un documento firmado:
lo cargado debe reflejarlo. Naturgy es poco prolija en el formato (columnas
que aparecen o cambian de nombre, montos sin centavos, etiquetas distintas
cada mes), por eso la carga es una lectura controlada y no una copia ciega.

**Total declarado** (de una certificación):
El "TOTAL MES" que Naturgy imprime en la cabecera del documento. Es la
referencia para la **cuadratura de la carga**: la suma de las filas cargables
más las filas manuales debe coincidir con él. Si no coincide, se muestra la
diferencia en pesos con un aviso fuerte, pero la carga se puede confirmar.
Cuando no viene o viene en cero (Excel agrupados de varias hojas), se avisa
que la carga no pudo controlarse.

**Fila que cuadra** (2026-09-07):
Fila cuya cantidad × precio unitario coincide con su total impreso, con
tolerancia de 1 peso porque Naturgy imprime sin centavos. Ninguna de las tres
cifras manda sola: si no cuadran, la fila queda **bloqueada** hasta que la
persona la corrija o la confirme a mano en el preview.
_Avoid_: recalcular el total (oculta un unitario mal leído), "lo impreso
manda" (deja pasar cantidades corridas de columna).

**Fila bloqueada** (del preview):
Fila que no puede cargarse tal como está: no cuadra, su ítem no está en el
maestro, su provincia no es válida o le falta cantidad o total. La carga no se
confirma mientras haya filas bloqueadas: la persona corrige o **excluye** cada
una explícitamente. Nunca se descartan en silencio ni en bloque. La provincia
se compara sin acentos ni mayúsculas de más (2026-09-07: 'Tucumán' del PDF de
Naturgy no se bloquea contra el maestro 'TUCUMAN') y, si matchea, la fila
adopta el nombre EXACTO del maestro — nunca se crea una provincia nueva por
variante de formato.

**Fila manual** (2026-09-07):
Fila que la persona agrega en el preview porque el parser no la reconoció en
el documento. El ítem se elige del maestro, limitado a los contratos a los que
la persona tiene acceso; trae contrato y tarea; la persona completa provincia,
cantidad y unitario, y el total propuesto es cantidad × unitario. Queda
marcada con origen manual en el preview, en la base y en el historial. Suma en
la cuadratura de la carga. Solo existe si el documento se pudo leer.
_Avoid_: carga manual completa sin documento (no es una fila manual, es otra
cosa que no existe hoy).

**Columna ignorada** (de una cabecera):
Columna del documento cuyo título el parser no reconoce (ej. "CUENTA"). Se
lista en el preview como aviso y sus valores no se asignan a ninguna otra
columna. El parser exige reconocer todas las columnas necesarias (ítem, K,
provincia, cantidad, unitario, total) para procesar la hoja o página.

**Contrato K resuelto** (de una fila):
El K que se carga: lo elige el maestro de ítems, después el contenido del
documento, y la persona puede cambiarlo a mano en el preview. El nombre del
archivo no decide nada: cuando la persona renombra el archivo para indicar a
qué contrato va la plata (ej. certificación K2 que se contabiliza en K11), el
sistema solo avisa que el nombre trae otro K y la persona edita el contrato.

**Regla de montos en texto** (2026-09-07):
En cualquier cifra leída como texto (PDF o celda de texto de Excel) el punto
es siempre separador de miles y la coma siempre decimal, sin adivinar por la
forma del número. "400.012" son cuatrocientos mil doce pesos. Si algún día
viniera al estilo inglés, la fila no cuadra y la persona lo ve.

**Horas extra pactadas** (de un perfil `fijo`, 2026-09-11):
Las horas extra que una persona de régimen **fijo** cobra **siempre**, sumadas
a las 88 del CCT, sin depender de lo que haya reportado: si tiene 12 pactadas
cobra 12 aunque haya cargado 200. Salen de dividir el monto que la persona
arregló con RRHH por el valor hora de su categoría — esa cuenta la hace el
Liquidador **afuera** y en el sistema se guarda el **resultado en horas**, no el
monto: así un aumento de convenio sube lo que cobra sin cambiar las horas que
exige ver el recibo.

Vive en la ficha de cada empleado (`PerfilLiquidacion.horasExtraPactadas`), no
en un catálogo de regímenes. **`null` es "falta cargarlo"** (alerta de perfil
incompleto, y el básico de 88 se calcula igual); **`0` es una respuesta válida**
— las 88 puras. El total es siempre `88 + pactadas`, y el ADR-023 absorbió así
al viejo régimen `fijo_105` (que eran estas mismas horas, con 17,5 escritas en
el código).
_Avoid_: horas extra fijas (se confunde con "el régimen fijo"), régimen 105 /
fijo_105 (ya no existe como régimen; sobrevive solo en los cierres congelados),
monto pactado (lo que se guarda son horas, nunca el monto).

**Modalidad de pago** (eliminada el 2026-09-11):
Fue un dato por empleado — "en B" o "con descuentos" — que **nunca entró en
ningún cálculo de montos**: solo producía una etiqueta para la columna
NOVEDADES. Se dio de baja por ADR-023 porque no se usaba. Los cierres ya
emitidos la conservan congelada; los nuevos no la traen.
_Avoid_: modalidad de hora extra (nombre viejo, ADR-011), "pago en B" como si
fuera una configuración vigente.

### Maestros (Admin)

**Móvil** (2026-09-11):
Vehículo o equipo de la empresa que se asocia a las cargas de horas y a las de
combustible. **Identificador y patente son la misma cosa**: un solo campo,
obligatorio, que en la conversación se nombra de las dos maneras y en pantalla
se rotula "Patente". Son patentes en mayúsculas y sin separadores (`AA615NF`,
`A166LHV`, `301IEG`), salvo cinco filas históricas de equipos que no tienen
patente y se identifican por nombre (`TACHO PAÑOL`, `TRACTOR - PICADA`,
`MOTO SOLDADOR`, `S/N`, y `HQJ 539` con espacio; 5 de 79 al 2026-09-11). Su
`descripcion` es el tipo de vehículo ("Moto Guardia", "Camioneta Toyota
Hilux") y puede ser nula.

El identificador **se guarda tal cual se escribe**, solo recortado: normalizar
al guardar rompería los que son nombres (juntaría las palabras y `[A-Z0-9]` se
come la Ñ). La normalización a `[A-Z0-9]` es **solo para buscar y comparar**,
aplicada a los dos lados — misma regla en la extracción de tickets de
combustible del Backend y en el buscador de Admin del Frontend.

_Avoid_: identificador interno, número de móvil (sugieren un código propio
paralelo a la patente; no existe, el campo es uno solo). Tampoco tratarlo como
"la patente" a secas: el que asume que siempre es una patente termina
normalizando y rompiendo los cinco que no lo son.
