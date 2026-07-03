# ADR-001 — Modelo de roles: reintroducir Jefe de Cuadrilla; Operario read-only

**Fecha:** 2026-07-03
**Estado:** Aceptado
**Supersede:** la decisión del 2026-07-02 (contexto §3: "el rol Jefe de Cuadrilla NO existe; todos son Operario").

## Contexto

En la etapa inicial se decidió eliminar el rol *Jefe de Cuadrilla* y que cualquier
Operario con login pudiera cargar horas (carga *ad hoc*: "un día carga uno, otro día
otro"). En la práctica esto genera desorden: muchas personas cargando aumenta el
riesgo de errores y descontrol.

Se quiere que **solo una persona responsable** cargue las horas del equipo, y que los
operarios comunes solo **consulten** las horas que se les cargaron.

## Decisión

Se reintroduce **Jefe de Cuadrilla** como rol y se redefinen las capacidades:

| Rol | Carga horas | Consulta | Aprueba |
|-----|-------------|----------|---------|
| **Operario** | ❌ | Solo **sus propias** horas (`operarioCuil` = él), read-only, con detalle | ❌ |
| **Jefe de Cuadrilla** | ✅ (para **cualquier empleado activo**) | **Sus horas** (`operarioCuil` = él) **+ lo que cargó** (`cargadoPorCuil` = él) | ❌ |
| **Jefe de Contrato** | ✅ | Registros de sus contratos (bandeja) | ✅ (aprueba/desaprueba, reabre, edita) |
| **Supervisor** | Solo novedades | — | — |
| **HyS** | — | — | ✅ Ausencias |
| **Admin** | ✅ | Todo | ✅ Todo |

**Detalles del modelo:**
- **Cargadores** (pueden `POST /registros-horas` y `/batch`): **Jefe de Cuadrilla, Jefe de Contrato, Admin**. El Operario **no** carga.
- **Alcance de carga del JdC:** cualquier empleado activo (el selector de operarios no se restringe). El dato legacy `snuempleados.codigocuadrilla` **no** sirve para agrupar cuadrillas (es casi único por persona; `detallecua` es una zona operativa), así que no se usa para autoscopear.
- **Vista del JdC:** dos pestañas — *Mis horas* (`operarioCuil` = él) y *Cargas que hice* (`cargadoPorCuil` = él, incluye filas de compañeros con su estado de aprobación).
- **Vista del Operario:** solo *Mis horas* (`operarioCuil` = él), read-only, con detalle. Nunca ve lo de compañeros.
- **Corrección (`PATCH /registros-horas/:id`):** la hace quien cargó (JdC) o Jefe de Contrato/Admin.

## Consecuencias

**Backend:**
- Reagregar el rol `JefeCuadrilla` en `sth_roles` (seed) — el rol existe en el enum de negocio pero fue quitado de los `@Roles`.
- `@Roles` de crear/batch/patch en `registros-horas.controller.ts`: pasar a `JefeCuadrilla, JefeContrato, Admin` (quitar `Operario`).
- `GET /registros-horas`: agregar filtro **`cargadoPorCuil`** (para "Cargas que hice" del JdC).

**Frontend:**
- Nav por rol: Operario → solo *Mis registros*; JdC → *Reporte diario* + *Mis registros* (2 pestañas); JefeContrato → *Reporte diario* + *Mis registros* + *Aprobaciones*.
- *Mis registros* pasa a ser rol-aware: JdC ve 2 pestañas (propias + cargadas); Operario ve solo las propias.
- *Reporte diario* deja de estar disponible para Operario.

**Operativo (riesgo abierto):**
- Dar login **read-only a cada operario** que quiera consultar implica potencialmente **~121+ usuarios** que el Admin debería crear a mano (email + password). Falta definir el mecanismo de provisión (alta masiva, self-service, o identificación por legajo).
- **Por eso se difiere**: en esta etapa se hace el cambio de **roles/permisos/nav + vista del JdC**; la **consulta read-only del Operario y su provisión de usuarios** se resuelven en una etapa siguiente.

## Alternativas consideradas

- **JdC con grupo asignado** (solo puede cargar a operarios de su cuadrilla): descartado por ahora — requiere crear la asignación JdC→operarios a mano (el dato legacy no sirve) y agrega fricción. Se prefiere "cualquier empleado activo" con el JdC como responsable.
- **Operario sin login** (consulta vía JdC/Contrato): descartado — se quiere que el operario pueda ver sus propias horas.
