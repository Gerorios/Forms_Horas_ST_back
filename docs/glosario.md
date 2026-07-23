# Glosario — App de Registro de Horas

Términos del dominio. Ver también el ADR de roles: `docs/adr/2026-07-03-adr-001-modelo-de-roles.md`.

## Roles

- **Operario** — Empleado que trabaja y cuyas horas se registran. **No carga**; solo **consulta sus propias** horas (read-only, con detalle). Requiere login para consultar (provisión de usuarios diferida).
- **Jefe de Cuadrilla (JefeCuadrilla)** — Persona responsable que **carga** las horas del equipo (para cualquier empleado activo). Consulta **sus propias** horas y **las que cargó**.
- **Jefe de Contrato (JefeContrato)** — Aprueba/desaprueba, reabre y edita registros de sus contratos. También puede cargar. (3 personas)
- **Supervisor** — Carga novedades.
- **Higiene y Seguridad (HyS)** — Aprueba específicamente las Ausencias.
- **Admin (IT)** — Acceso total; administra catálogos y usuarios. (1 persona)

## Entidades y campos clave

- **Empleado (`snuempleados`)** — Tabla legacy de solo lectura, PK `cuil`. No todos los empleados tienen usuario/login.
- **Usuario (`sth_usuarios`)** — Quien inicia sesión. PK `cuil` (referencia a `snuempleados`). Tiene un rol.
- **`operarioCuil`** — En un registro, el **dueño de las horas** (a quién le corresponden). Puede ser cualquier empleado activo.
- **`cargadoPorCuil`** — Quién **hizo la carga** (siempre un usuario con login: JdC / JefeContrato / Admin).
- **Contrato habilitado (`sth_contratos_habilitados`)** — M:N que cuelga del **usuario que carga**: define de qué contratos puede elegir tareas al cargar.
- **Registro de horas (`sth_registros_horas`)** — Fila `{fecha, operario, contrato, horas, provincia, GPS}` con estado `pendiente|aprobado|desaprobado`. Las **tareas** (varias, del maestro) cuelgan en `sth_registro_tareas` (M:N) y los **móviles** en `sth_registro_moviles` (M:N). Las horas son **del contrato**, no por tarea (ver ADR-002).
- **Línea de carga** — `{ contrato, horas, tareas[], observacion? }`. Una línea por contrato; ≥1 tarea. Las tareas salen del maestro `tareas_catalogo` (estandarizadas), sin horas por tarea. La **observación** es texto libre opcional (productividad, viajes a otra localidad, justificación de las horas) — una por línea, compartida por todos los operarios de esa carga en ese contrato, igual criterio que las horas (ver ADR-005). Listado de materiales y tickets de combustible quedan explícitamente diferidos, no forman parte de esto.
- **Carga (`loteId`)** — Un envío del formulario de reporte (individual o masivo). Produce **N operarios × M líneas** = N×M filas en `sth_registros_horas` (ver ADR-002), todas con el mismo `loteId` (UUID generado una vez por envío — ver ADR-004). Es la unidad de **aprobación**: el Jefe de Contrato aprueba/desaprueba una carga completa (su porción, según contrato) de una sola vez, no fila por fila.
- **Reporte diario** — El formulario de carga (`POST /registros-horas` individual o `POST /registros-horas/batch` masivo). Móviles compartidos por toda la carga.
- **Novedad** — Ítem tipificado (p. ej. "Accidente", "Ausencia"). Solo las **Ausencias** requieren aprobación de HyS.
- **Quincena** — Período 1–15 / 16–fin de mes, calculado por fecha (sin tabla ni cierre).

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
- **Rol Liquidador** — Rol aún no existente en el sistema (no está en el glosario de roles ni
  implementado). Sería el destinatario natural de un panel que muestre esa vista cruzada por
  operario/día — se decidió explícitamente que **no** es responsabilidad de `/aprobaciones` (Jefe de
  Contrato), que se mantiene agrupado por `loteId` únicamente.
