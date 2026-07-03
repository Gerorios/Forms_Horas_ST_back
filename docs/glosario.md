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
- **Registro de horas (`sth_registros_horas`)** — Fila atómica `{fecha, operario, contrato, tarea, horas, provincia, móviles, GPS}` con estado `pendiente|aprobado|desaprobado`.
- **Reporte diario (carga masiva)** — Una carga produce **N operarios × M líneas** = N×M filas atómicas (vía `POST /registros-horas/batch`).
- **Novedad** — Ítem tipificado (p. ej. "Accidente", "Ausencia"). Solo las **Ausencias** requieren aprobación de HyS.
- **Quincena** — Período 1–15 / 16–fin de mes, calculado por fecha (sin tabla ni cierre).

## Flujos

- **Carga** → JdC/JefeContrato/Admin crea registros (estado `pendiente`).
- **Aprobación** → JefeContrato aprueba/desaprueba; puede reabrir/editar.
- **Corrección** → quien cargó (o JefeContrato/Admin) edita la fila desaprobada → vuelve a `pendiente` + auditoría.
- **Consulta** → Operario ve lo suyo (`operarioCuil`); JdC ve lo suyo + lo que cargó (`cargadoPorCuil`).
