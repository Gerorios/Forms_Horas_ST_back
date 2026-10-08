# Formulario Horas — Backend

Sistema interno integral de Sertec, llamado **Central Sertec** desde el
2026-09-21 (antes "Registro de Horas"): carga, aprobación y liquidación de
horas del personal de obra (UOCRA) y de estructura, novedades y ausencias,
certificación y facturación por contrato, km de relevadores y combustible.

## Language

### Sistema y navegación

**Central Sertec** (2026-09-21):
El nombre del sistema interno completo, tal como lo ven las personas en la
barra lateral, el login y la pestaña (título completo; una pestaña angosta lo
recorta a "Central"). Abreviado "CS" en la barra plegada. Ver ADR-025.
_Avoid_: Registro de Horas, Formulario Horas (nombres del origen del sistema;
solo sobreviven en los nombres de los repositorios), Gestión de cuadrillas.

**Área** (de módulos):
Agrupación de módulos en la barra lateral y el inicio según qué mueve en la
empresa: **Operación** (reporte diario, mis registros, aprobaciones, control
general, km por tantos, combustible), **Personas** (novedades, ausencias),
**Resultados operativos** (liquidación con quincena, análisis, cierres,
perfiles y tarifas; certificaciones y facturación) y **Administración**
(usuarios y catálogos), y desde 2026-10-07 **Seguridad** (reportes, mis
puntos, panel de HyS, ranking y períodos). El área da contexto al encabezado de cada módulo. No decide
permisos: eso sigue siendo del rol; un área sin módulos visibles para la
persona no se muestra.
_Avoid_: sección, categoría del menú, "Dinero" (nombre descartado del área de
resultados).

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

**Días trabajados** (de un cierre, 2026-09-17):
Los días con al menos un registro no desaprobado, congelados al cerrar para
**tres quincenas corridas**: la cerrada y las dos anteriores. Alimentan la hoja
DIAS TRABAJADOS del Excel, que los agrupa por mes calendario con un total por
mes; sirve para pagar feriados, cuya regla mira un mes hacia atrás.
_Avoid_: días de la quincena (la ventana es más larga que el período cerrado).

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

**Baja de Operario** (2026-10-05):
Novedad con la que un supervisor informa que una persona dejó de trabajar,
porque la base de sueldos (`snuempleados.activo`) tarda en reflejarlo o no lo
refleja nunca. Una sola vigente por persona. Ver ADR-026.
_Avoid_: egreso, desvinculación (no distinguen nada acá); "dar de baja" como
sinónimo de anular una novedad.

**Fecha de baja**:
El **último día trabajado** — no el primero sin trabajar. Ese día todavía se
cargan y se liquidan horas; desde el siguiente, no. Es la fecha de inicio de
la novedad; la fecha de fin no aplica.
_Avoid_: fecha de egreso, primer día sin trabajar.

**Baja informada / baja confirmada**:
Informada = cargada por el supervisor, pendiente de HyS: se ve, pero no tiene
ningún efecto. Confirmada = aprobada por HyS: bloquea la carga de horas
posteriores en todos los contratos y pega en la liquidación. Rechazada = sin
efecto. Para corregir la fecha o registrar un reingreso, HyS anula la baja.

**Baja dentro de la quincena** (amarillo):
Baja confirmada cuya fecha cae dentro de la quincena que se liquida: es la
**liquidación final** de esa persona y corresponde pagarla. Los montos no se
tocan, salvo que nada con fecha posterior a la baja se liquida (horas, plus
de novedades, ausencias). Un fijo sale con sus 88 hs y la fecha de baja: el
prorrateo lo hace el liquidador de sueldos.

**Baja previa** (rojo / gris):
Baja confirmada anterior al primer día de la quincena: esa persona no trabajó
ni un día, y se liquida **$0 en todo**, sea cual sea su régimen. La fila sigue
apareciendo para que nadie la pierda de vista: en rojo mientras
`snuempleados` la tenga activa, en gris cuando ya figura `activo = 'N'`.
Nadie entra ni sale de la liquidación por `activo`. El cierre la congela, pero
el **Excel no la manda a pagar**: las hojas de pago llevan solo a quien tiene
algo para cobrar. Las rojas (activas en sueldos) van a la hoja **BAJAS A
REGULARIZAR**, para que el liquidador de sueldos las dé de baja en su
sistema; las grises no se informan, porque ya están regularizadas.
_Avoid_: excluir de la liquidación (en la app la fila no desaparece, sale en $0).

**Días de ausencia** (de una fila de liquidación):
Días corridos de Ausencia dentro de la quincena (y hasta la baja), separados
por estado HyS: injustificada, justificada y sin resolver. Se congelan en el
cierre y salen en columnas propias del Excel para que el liquidador de sueldos
descuente sin cruzar con lo que le pasa HyS — sin ellas, a un fijo se le
pagaba el sueldo completo más los días caídos. El sistema **informa**, no
descuenta.

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
la persona tiene acceso y, desde 2026-09-21, a los contratos (K) de las hojas
elegidas en el paso 2 (si ese filtro no deja ningún ítem, se ofrecen todos);
trae contrato y tarea; la persona completa provincia,
cantidad y unitario, y el total propuesto es cantidad × unitario. Queda
marcada con origen manual en el preview, en la base y en el historial. Suma en
la cuadratura de la carga. Solo existe si el documento se pudo leer.
_Avoid_: carga manual completa sin documento (no es una fila manual, es otra
cosa que no existe hoy).

**Columna ignorada** (de una cabecera):
Columna del documento cuyo título el parser no reconoce (ej. "CUENTA"). Se
lista en el preview como aviso y sus valores no se asignan a ninguna otra
columna. El parser exige reconocer las columnas necesarias (ítem, K,
cantidad, unitario, total) para procesar la hoja o página. **Provincia**: en
PDF sigue siendo obligatoria en la cabecera; en Excel dejó de serlo el
2026-09-21 (formato K12, que no la trae): las filas sin provincia quedan
bloqueadas por "Falta provincia" y la persona la elige por fila en el
preview.

**Fila de total** (de una hoja Excel, 2026-09-21):
Fila cuyo ítem empieza con "TOTAL CERTIFICADO" (formato K12: "TOTAL
CERTIFICADO EN EL PERIODO SIN IVA"). Aporta el total declarado del archivo
cuando la cabecera no trae "TOTAL MES" y **cierra la zona de datos**: lo que
sigue es pie (IVA, total con IVA, firma) y no son ítems.
_Avoid_: tratarla como ítem, leer subtotales sueltos como total declarado.

**Contrato K resuelto** (de una fila):
El K que se carga: lo elige el maestro de ítems, después el contenido del
documento, y la persona puede cambiarlo a mano en el preview. En Excel, la
celda de la columna K solo cuenta si es un código K (`8`, `K8`, `K12`; nunca
`0`); si trae otra cosa, como el coeficiente 653,32 del formato K12, el K sale
del nombre de la hoja o del archivo. El nombre del archivo no decide nada:
cuando la persona renombra el archivo para indicar a qué contrato va la plata
(ej. certificación K2 que se contabiliza en K11), el sistema solo avisa que el
nombre trae otro K y la persona edita el contrato.

**Número de WK** (de una certificación en Excel):
El número de orden de compra que Naturgy imprime en la cabecera. Se lee del
rótulo "NRO. WK" con el número en la celda siguiente (formato Naturgy) o de
la misma celda cuando viene como "WK N° 362000594" (formato K12, fila
"ORDEN DE COMPRA"). Solo informa el preview; si no se detecta, aviso débil.
_Avoid_: NP (es el mismo dato con el nombre viejo), tomar un año o un código
de ítem como número de WK.

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

**Excepción de zona** (de un perfil, 2026-09-11):
La hoja del Excel en la que sale una persona se deriva de su **provincia**
(NORTE = Salta + Jujuy, SUR = Tucumán). La excepción
(`PerfilLiquidacion.zonaOverride`) la fuerza por encima de esa regla, para
casos que la provincia no explica — el primero: un empleado de Santiago del
Estero que por acuerdo se liquida con Tucumán. `null` (todos los perfiles al
2026-09-11) significa "manda la provincia".

Se resuelve en **un solo lugar** (`zonaDePerfil`), y el cálculo la deja ya
resuelta en la fila: el panel, los cierres y el Excel la leen de ahí. Quien
vuelva a llamar a `zonaDeProvincia` por su cuenta se saltea la excepción.
_Avoid_: zona manual, zona forzada por localidad (la localidad nunca decide
nada: viene sucia, y la excepción es por persona, no por lugar).

**Modalidad de pago** (eliminada el 2026-09-11):
Fue un dato por empleado — "en B" o "con descuentos" — que **nunca entró en
ningún cálculo de montos**: solo producía una etiqueta para la columna
NOVEDADES. Se dio de baja por ADR-023 porque no se usaba. Los cierres ya
emitidos la conservan congelada; los nuevos no la traen.
_Avoid_: modalidad de hora extra (nombre viejo, ADR-011), "pago en B" como si
fuera una configuración vigente.

### Autogestión de la Seguridad (2026-10-07, en diseño)

**Autogestión de la Seguridad**:
Módulo para medir de forma individual la actitud ante la seguridad con
**reportes de seguridad**: los que sube cualquier persona suman puntos a su
autor, y las **inspecciones de seguridad** de HyS restan puntos a quienes
observa. Es el primer módulo abierto a todos los usuarios, sin importar el
rol.
_Avoid_: "módulo de HyS" (HyS aprueba e inspecciona, pero lo usan todos),
Métrica+ (nombre de un programa anterior de HyS del que sale este módulo).

**Reporte de Seguridad**:
Lo que sube cualquier usuario para informar algo de seguridad visto en campo.
Tiene un **tipo** que decide qué campos pide, además de los comunes. Si HyS
lo aprueba, el autor suma puntos; la **inspección de seguridad** es el único
tipo que resta.
_Avoid_: aviso de riesgo como nombre general (es uno de los tipos), novedad
(la Novedad es otra cosa: ausencias, bajas, plus), incidente como nombre
general (es otro de los tipos).

**Tipo** (de un Reporte de Seguridad):
Fijo, no un catálogo: cada tipo tiene campos y reglas propias, así que sumar
uno siempre es desarrollo. **Aviso de riesgo** e **incidente** (evento sin
baja) piden naturaleza y control del riesgo; **paralización de trabajos**
pide motivo de paralización y control; **propuesta de mejora** es una idea,
sin riesgo ni control. **Inspección de seguridad** la cargan HyS y los
**inspectores** que habilite, con el mismo formulario, y resta puntos a sus
involucrados. La paralización exige además el **punto GPS**. *Accidente* y
*tolerancia 0* esperan definición de HyS (¿el accidente con baja va por acá?,
¿tolerancia 0 es un tipo o un caso de inspección?).

**Motivo de paralización**:
Por qué se detuvo una tarea: catálogo de Admin (viento/clima, condición del
área, interferencia con equipos, falta de personal, falta o falla de
herramientas, procedimiento insuficiente, condición eléctrica, riesgo no
previsto, falta de comunicación, cambio en las condiciones de trabajo). Es
propio de la paralización, no una naturaleza.

**Autor** (de un Reporte de Seguridad):
El usuario que lo sube, tomado de la sesión. Es el único que suma los puntos
del reporte: la medición es de su actitud. Nadie carga reportes a nombre de
otro.
_Avoid_: responsable del aviso (rótulo de la planilla de HyS; se confunde con
el responsable del riesgo).

**Fecha del reporte**:
El día en que se vio la situación. La elige el autor y puede ser anterior a
la **fecha de envío**, que es el momento (día y hora) en que lo subió y la
registra el sistema.

**Actividad** (de un Reporte de Seguridad):
Qué se estaba haciendo: un contrato y una tarea de ese contrato, ambos
obligatorios y elegidos de los mismos catálogos que la carga de horas. Lo que
no es de un K va al contrato **OTROS** (Capacitación, Estructura, Taller
Mecánico…). Se elige entre todos los contratos activos, no solo los
habilitados del usuario: reportar no es imputar horas.
_Avoid_: área / contrato (rótulo de la planilla de HyS), contrato habilitado
(eso decide qué horas carga alguien, no dónde puede ver un riesgo).

**Provincia** (de un Reporte de Seguridad):
Donde pasó lo reportado, elegida siempre por el autor, sin precarga: no es
la provincia de su domicilio (alguien de Tucumán puede reportar en Salta).
_Avoid_: derivarla de `snuempleados.provincia` (eso es la zona de
liquidación, otra cosa).

**Ubicación** (de un Reporte de Seguridad):
Dónde exactamente pasó ("Ruta 9 km 1580", "depósito Salta"), en texto libre
y opcional. Se lee en el detalle, nunca se agrupa en tableros: para agrupar
están la actividad, la provincia y la naturaleza.
_Avoid_: área, lugar (sugieren un catálogo, que no existe).

**Involucrados** (de un Reporte de Seguridad):
Las personas de la nómina que estaban en la situación. En los tipos
comunes son opcionales, no suman ni restan puntos y no ven el reporte: lo
ven solo el autor, HyS y Admin. En una **inspección de seguridad** son las
personas observadas, y cada una pierde los puntos de la inspección.
_Avoid_: operario/s (rótulo de la planilla; se confunde con el autor y con
el rol Operario).

**Naturaleza** (de un Reporte de Seguridad):
La clasificación del riesgo en un aviso de riesgo o incidente: una sola,
elegida de un catálogo que
mantiene únicamente Admin (Acto inseguro, Caída de objetos, Comunicación,
Condición peligrosa, E.P.P, Herramientas y Maquinaria, Orden y limpieza,
Señalización, Siniestro vial, Tropiezos). Una naturaleza en desuso se
desactiva, nunca se borra.
_Avoid_: tipo de riesgo, categoría, tipo (el tipo es del reporte, no del
riesgo).

**Control del riesgo** (de un Reporte de Seguridad):
Lo que el autor hizo **él mismo** en campo para eliminar o reducir el
riesgo (señalizar, vallar, sacar de uso, ordenar, corregir), en texto
obligatorio. Es el corazón de la autogestión: elevar el problema a otro
("avisé al supervisor") no es gestionarlo. Quien juzga si alcanzó es HyS, al
aprobar o desaprobar: el autor no declara si el riesgo quedó controlado
(2026-10-07, pedido de HyS).
_Avoid_: acción correctiva (suena a un circuito con responsable y plazo, que
no existe), solución, riesgo controlado sí/no (se descartó: no lo declara
nadie).

**Fotos del riesgo / fotos del control** (de un Reporte de Seguridad):
Dos grupos de fotos: lo que se vio y lo que se hizo. Hasta 3 por grupo, solo
imágenes, y por ahora ninguna es obligatoria (HyS puede exigir la del riesgo
más adelante). Cada foto se saca **con la cámara** desde la app o se elige
**de la galería**; solo las de cámara prueban que el autor estaba en el lugar.
_Avoid_: adjunto, certificado (eso es de las novedades), registro fotográfico.

**Punto del reporte** (en el mapa):
La ubicación geográfica de lo reportado (latitud, longitud y error en
metros), para saber de qué obra se trata y para un futuro mapa de calor.
Manda el **punto GPS** que el autor toma con el botón "Tomar mi ubicación"
(2026-10-08: obligatorio en la paralización, opcional en el resto); sin él,
la foto sacada con la cámara desde la app con menor error. Si el celular no
consigue ubicación (sin señal GPS, permiso negado), la paralización igual se
envía **sin ubicación**, con la referencia del lugar obligatoria: el reporte
más urgente nunca queda trabado. Nunca sale del
momento de envío (se puede reportar desde casa algo visto ayer) ni de fotos
de galería. El navegador pide el permiso una vez; la app nunca sigue a nadie,
y el punto lo ven solo el autor, HyS y Admin.
_Avoid_: ubicación (es el texto libre), geolocalización del usuario (no se
ubica a la persona, se ubica el riesgo).

**Calificación** (de un Reporte de Seguridad):
HyS **aprueba** o **desaprueba** el reporte, y al aprobarlo le pone un
puntaje de 0 a 10: son los **puntos** del autor. La aprobación depende de la
gestión: un reporte completo sin nada gestionado se desaprueba y vale 0.
Lleva un comentario opcional que el autor ve. HyS puede recalificar; queda
quién calificó y cuándo.
_Avoid_: nota, semáforo (el verde/rojo de HyS son los puntos que suman y los
que restan, no un color por nota).

**Estado** (de un Reporte de Seguridad):
**Pendiente** (recién enviado), **aprobado** (con su puntaje),
**desaprobado** (0 puntos, con motivo) o **anulado** (el autor lo retiró
mientras estaba pendiente, con motivo: duplicado o error). Solo mientras está
pendiente el autor puede editarlo; calificado, queda fijo para él. HyS puede
**reabrirlo** (volver a pendiente), lo que borra su movimiento de puntos, y
puede **corregirlo** en cualquier estado (2026-10-08: los operarios confunden,
p. ej., un aviso con una propuesta): si estaba aprobado, sus movimientos se
recalculan en el acto. Cada corrección queda en auditoría con el antes y el
después.
_Avoid_: descartado (desaprobar es una decisión de calidad; el error o el
duplicado se anulan).

**Alarma** (en el panel de HyS):
Marca de un reporte pendiente de **paralización de trabajos**, el único tipo
que habla de un riesgo inminente: va arriba de todo y suma al contador del
menú. Se apaga cuando HyS
lo califica. Es solo visual: lo urgente se sigue avisando por WhatsApp, y el
reporte es el registro, no el canal de aviso.
_Avoid_: notificación (el sistema no envía nada fuera de la app).

**Inspección de seguridad**:
Tipo de reporte que cargan en campo HyS y los **inspectores**, con el mismo
formulario que cualquier otro. Sigue el mismo circuito: queda pendiente y HyS, ya en el
panel, la aprueba poniéndole el puntaje a restar (0 a 10), que pierde cada
involucrado. Quien la carga no suma nada. No tiene relación con los reportes de las personas
observadas: alguien que nunca reportó nada puede tener puntos negativos.
_Avoid_: descuento, sanción (suenan disciplinarios o de RRHH), observación.

**Inspector** (de seguridad):
Usuario que, sin ser HyS, puede cargar inspecciones porque HyS lo habilitó
uno por uno (al 2026-10-08, algunos supervisores). HyS siempre puede. La
habilitación es por persona, no por rol, y no le da acceso al panel: sus
inspecciones las aprueba HyS.

**Movimiento de puntos**:
Cada vez que una persona gana o pierde puntos: un + para el autor de un
reporte aprobado, un − para cada involucrado de una inspección aprobada. Lo
genera el sistema al aprobar, recalificar o desaprobar, nunca se carga a
mano. El **puntaje** de una persona en un período es la suma de sus
movimientos; nunca se guarda un total.

**Rango** (de los puntos):
Las fechas desde/hasta con que se consultan puntos, ranking y tableros:
cada uno elige el que quiere (mes, trimestre, semestre, año o libre), y por
defecto es el año en curso. No hay períodos guardados (2026-10-08: se
descartaron). Los puntos caen según la **fecha del reporte** (cuando pasó),
no la de aprobación: el ranking de un rango puede cambiar mientras HyS siga
aprobando reportes atrasados.
_Avoid_: período (sugiere algo definido y guardado, que ya no existe).

**Ranking** (de un rango):
Las personas con al menos un movimiento en el rango, ordenadas por
puntaje; los empates comparten puesto. Quien tiene 0 por +10 y −10 aparece;
quien no tiene ningún movimiento, no. Un reporte desaprobado no genera
movimiento.

**Mis puntos**:
Lo que cada persona ve de sí misma: sus reportes con estado, puntaje y
comentario de HyS; sus movimientos del rango, y las inspecciones que la
restaron (fecha, naturaleza, descripción y puntos), sin las fotos, sin quién
de HyS la cargó y sin los otros involucrados. Ve además su **posición** en el
ranking y los puntajes de quienes están delante, sin nombres. El ranking con
nombres es solo de HyS y Admin.

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
