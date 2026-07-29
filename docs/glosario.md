# Glosario — App de Registro de Horas

Términos del dominio. Ver también el ADR de roles: `docs/adr/2026-07-03-adr-001-modelo-de-roles.md`.

## Roles

- **Operario** — Empleado que trabaja y cuyas horas se registran. **No carga**; solo **consulta sus propias** horas (read-only, con detalle). Requiere login para consultar (provisión de usuarios diferida).
- **Jefe de Cuadrilla (JefeCuadrilla)** — Persona responsable que **carga** las horas del equipo (para cualquier empleado activo). Consulta **sus propias** horas y **las que cargó**. Opcionalmente puede cargar novedades, pero solo de los **tipos que le habilitaron** (ver `Tipo de novedad habilitado`, ADR-007) — sin ninguno habilitado, no ve la opción.
- **Jefe de Contrato (JefeContrato)** — Aprueba/desaprueba, reabre y edita registros de sus contratos. También puede cargar. Un contrato puede tener **varios** Jefes de Contrato (M:N, `sth_contratos_jefes`): cualquiera de ellos puede resolver — el primero que aprueba/desaprueba/reabre/corrige lo hace para todos, y queda registrado en `aprobadoPorCuil` quién fue puntualmente. Ver ADR-012.
- **Supervisor** — Carga novedades, de cualquier tipo, sin restricción.
- **Higiene y Seguridad (HyS)** — Aprueba específicamente las Ausencias.
- **Admin (IT)** — Acceso total; administra catálogos y usuarios. (1 persona)
- **Liquidador** — Ve el panel de liquidación: total a cobrar por empleado y quincena (horas, categoría UOCRA, régimen, extras, presentismo, plus de novedades, por tantos). Carga las tarifas vigentes y, para "por tantos", la cantidad (km) de cada período. Ver ADR-009.

## Entidades y campos clave

- **Empleado (`snuempleados`)** — Tabla legacy de solo lectura, PK `cuil`, sincronizada automáticamente desde un sistema externo (ERP/liquidador de sueldos) que la sobreescribe periódicamente — por eso nunca se le insertan filas a mano. No todos los empleados tienen usuario/login.
- **Usuario (`sth_usuarios`)** — Quien inicia sesión. PK `cuil` (un CUIL es un dato personal, lo tiene cualquiera sea o no empleado). Tiene un rol. Puede o no corresponder a una fila real de `snuempleados` — ver `Usuario fuera de nómina`.
- **Usuario fuera de nómina** — Un `Usuario` cuyo `cuil` no tiene fila en `snuempleados` (ej. dueño o socio gerente, sin relación de dependencia). Su nombre para mostrar sale de `Usuario.nombreFueraNomina` (cargado a mano por el Admin), no de `snuempleados.apellido_nombre`. Disponible para cualquier rol al crear el usuario, vía un interruptor "En nómina / Fuera de nómina" en el alta. Ver ADR-008.
- **`operarioCuil`** — En un registro, el **dueño de las horas** (a quién le corresponden). Puede ser cualquier empleado activo.
- **`cargadoPorCuil`** — Quién **hizo la carga** (siempre un usuario con login: JdC / JefeContrato / Admin).
- **Contrato habilitado (`sth_contratos_habilitados`)** — M:N que cuelga del **usuario que carga**: define de qué contratos puede elegir tareas al cargar.
- **Registro de horas (`sth_registros_horas`)** — Fila `{fecha, operario, contrato, horas, provincia, GPS}` con estado `pendiente|aprobado|desaprobado`. Las **tareas** (varias, del maestro) cuelgan en `sth_registro_tareas` (M:N) y los **móviles** en `sth_registro_moviles` (M:N). Las horas son **del contrato**, no por tarea (ver ADR-002).
- **Línea de carga** — `{ contrato, horas, tareas[], observacion? }`. Una línea por contrato; ≥1 tarea. Las tareas salen del maestro `tareas_catalogo` (estandarizadas), sin horas por tarea. La **observación** es texto libre opcional (productividad, viajes a otra localidad, justificación de las horas) — una por línea, compartida por todos los operarios de esa carga en ese contrato, igual criterio que las horas (ver ADR-005). Listado de materiales y tickets de combustible quedan explícitamente diferidos, no forman parte de esto.
- **Carga (`loteId`)** — Un envío del formulario de reporte (individual o masivo). Produce **N operarios × M líneas** = N×M filas en `sth_registros_horas` (ver ADR-002), todas con el mismo `loteId` (UUID generado una vez por envío — ver ADR-004). Es la unidad de **aprobación**: el Jefe de Contrato aprueba/desaprueba una carga completa (su porción, según contrato) de una sola vez, no fila por fila.
- **Reporte diario** — El formulario de carga (`POST /registros-horas` individual o `POST /registros-horas/batch` masivo). Móviles compartidos por toda la carga.
- **Novedad** — Ítem tipificado (p. ej. "Accidente", "Ausencia", "Viáticos"). Solo las **Ausencias** requieren aprobación de HyS.
- **Tipo de novedad habilitado (`sth_tipos_novedad_habilitados`)** — M:N que cuelga del **usuario que carga la novedad**: define qué tipos puede usar. Mismo patrón que `Contrato habilitado`, pero hoy solo se aplica a JefeCuadrilla — Supervisor/JefeContrato/Admin no tienen restricción (ver ADR-007).
- **Quincena** — Período 1–15 / 16–fin de mes, calculado por fecha (sin tabla ni cierre).
- **Perfil de liquidación (`PerfilLiquidacion`)** — 1:1 con `snuempleados.cuil` (no con `Usuario`, la mayoría de los empleados no tienen login): régimen (`jornalizado` / `fijo` / `mensualizado` / `por_tantos` / `administrativo`) + categoría UOCRA + modalidad de pago. Solo lo asignan Admin/Liquidador. Un empleado queda fuera del panel de liquidación en dos casos: **sin perfil todavía** (no revisado) o **con régimen `administrativo`** (revisado, se liquida por otro circuito). Ver ADR-009 y ADR-011 (5 regímenes reales, no 4).
- **Categoría UOCRA** — Catálogo propio de esta app (no se reusa `snuempleados.categoria`, esa columna externa está incompleta). Cada categoría tiene una tarifa por hora.
- **Tarifa vigente** — Patrón que se repite para casi todo monto de este dominio: una tabla versionada por período (`vigenteDesde`, siempre día 1 de un mes), se toma la fila con vigencia más reciente ≤ la fecha de la quincena liquidada. Se usa para: tarifa por categoría UOCRA, monto por día de novedad con plus, y precio por rango de km (por tantos). El multiplicador de hora extra es la excepción: es fijo en 1.5, no se versiona. Ver ADR-009 y ADR-010 (cómo se cargan estos valores).
- **Ronda de tarifas (`RondaTarifas`)** — Las 3 tarifas vigentes (categorías UOCRA, montos de novedad con plus, rangos de km) se ajustan **todas juntas, una vez por mes**, no por separado. `RondaTarifas { anio, mes }` registra qué períodos quedaron efectivamente cargados. Si el Liquidador se salteó un mes, ese hueco se completa automáticamente copiando el último valor conocido (no hay forma de "recordar" retroactivamente un valor distinto); para el mes que sí está cargando, puede elegir copiar el último valor o escribir uno nuevo. Garantiza que "qué precio regía en tal mes" siempre tenga una respuesta explícita, nunca implícita. Ver ADR-010.
- **Modalidad de pago (`modalidadPago`)** — Dato fijo por empleado (no por quincena): "en B" (horas extra y presentismo pagados de forma informal, sin descuentos) o "con descuentos" (parte del sueldo formal). Cubre horas extra **y** presentismo juntos, no son dos modalidades separadas — corregido en ADR-011 (antes se llamaba "modalidad de hora extra" y sonaba a que solo aplicaba a las extras).
- **Régimen "mensualizado"** — Sueldo bruto fijo, cargado a mano por el Liquidador cada período (no depende de categoría UOCRA ni de horas trabajadas). No genera horas extra (no hay concepto de horas), pero sí presentismo (20% del monto). Ver ADR-011.
- **Régimen "por tantos"** — Pago por cantidad en vez de por hora. Hoy el único caso es relevamiento de fugas, medido en km: el Liquidador carga a mano el total de km de cada relevador por quincena (se mide en otra app, no en esta), y se paga todo al precio del rango en el que cae el total (no progresivo por tramos). El monto resultante se convierte a **horas equivalentes** (monto ÷ tarifa de su categoría UOCRA) y de ahí se corre la misma fórmula que jornalizado (básico, horas extra si supera 88) — el recibo tiene que mostrarlo como pago por hora. Por eso este régimen sí necesita categoría UOCRA asignada. Ver ADR-009 y ADR-011.
- **Columna "NOVEDADES" (reporte)** — Es una etiqueta de texto para el recibo (ej. "Hs Extra y Presentismo en B"), no un monto a calcular — resume en palabras qué componentes no estándar tiene esa persona en el período. Ver ADR-011.
- **Presentismo** — 20% del sueldo básico (con el mismo tope de 88hs). Se pierde con una Ausencia desaprobada por HyS (certificado inválido/inasistencia injustificada) o con una Suspensión en el período. Ver ADR-009.
- **Suspensión** — Tipo de novedad nuevo (disciplinaria), sin aprobación de HyS — a diferencia de Ausencia, no depende de un certificado médico. Su sola presencia en la quincena quita presentismo. Ver ADR-009.

## Flujos

- **Carga** → JdC/JefeContrato/Admin crea registros (estado `pendiente`), todos con el mismo `loteId`.
- **Aprobación** → JefeContrato aprueba/desaprueba **una carga completa** (su porción, según contrato) de una sola acción; puede excluir filas puntuales antes de confirmar. También puede reabrir/editar filas individuales.
- **Corrección** → quien cargó (o JefeContrato/Admin) edita la fila desaprobada → vuelve a `pendiente` + auditoría.
- **Corrección de horas por línea** (distinta de la anterior) → el Jefe de Contrato, tras auditar el GPS de la carga, corrige la hora declarada de una línea completa (todos los operarios de ese contrato en ese lote): rechaza esas filas y crea filas nuevas ya `aprobado` con la hora corregida, enlazadas por `loteIdOrigen` al lote rechazado. No pasa por `pendiente` de nuevo — quien corrige es quien decide el valor real. Ver ADR-006.
- **Consulta** → Operario ve lo suyo (`operarioCuil`); JdC ve lo suyo + lo que cargó (`cargadoPorCuil`).
- **Reset de contraseña** → el Admin resetea la contraseña de un usuario individual a su propio CUIL
  (determinístico, sin generar nada al azar). Ver ADR-003 — es una decisión de seguridad consciente, no
  un autoservicio: el usuario final no puede resetear su propia contraseña sin pasar por el Admin
  (autoservicio por email queda diferido, no hay infraestructura de envío de mail ni email real para la
  mayoría de los usuarios de alta masiva, que reciben `<legajo>@st.local`, no enviable).

## Ideas a futuro (no implementadas)

- **Duplicación de horas entre contratos** — Un mismo operario puede repartir sus horas reales de un
  día entre contratos distintos (ej. 6hs en K9/K10 y otras 6hs en K2/K6 el mismo día), sin que ningún
  Jefe de Contrato lo note: cada uno ve solo su porción y le "parece razonable" en aislamiento. El
  `alertaHoras` actual (>16hs/día, ver `registros-horas.service.ts`) no cubre este caso — el total
  puede ser perfectamente plausible (12hs) y aun así ser una duplicación. Detectarlo requiere ver, por
  operario y día, el total real cruzando **todos** los contratos/lotes (solo filas `pendiente` +
  `aprobado`; lo `desaprobado` se excluye porque puede ser justamente una duplicación ya detectada y
  rechazada).
- **Duplicación de horas, vista por Liquidador** — La vista cruzada por operario/día (todos los
  contratos, no agrupada por `loteId`) que serviría para detectar la duplicación de arriba encaja
  naturalmente en el panel de Liquidador (ADR-009, ya en diseño) — se decidió explícitamente que
  **no** es responsabilidad de `/aprobaciones` (Jefe de Contrato), que se mantiene agrupado por
  `loteId` únicamente.
