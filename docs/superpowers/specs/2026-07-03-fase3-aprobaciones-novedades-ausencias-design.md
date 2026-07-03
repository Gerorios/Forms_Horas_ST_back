# Fase 3 — Aprobaciones + Novedades + Ausencias (Design)

**Fecha:** 2026-07-03
**Proyecto:** App de Registro de Horas (ver `Backend/.claude/Contexto/contexto-proyecto.md` y `docs/adr/2026-07-03-adr-001-modelo-de-roles.md`)
**Alcance:** Las tres bandejas de flujo de trabajo: **Aprobaciones** (Jefe de Contrato), **Novedades** (Supervisor) y **Ausencias** (HyS). Incluye 3 adiciones chicas de backend. En crudo (el rediseño visual es posterior, ver contexto §16).

---

## 1. Objetivo

Cerrar el flujo de aprobación de horas y el circuito de novedades/ausencias:
- El **Jefe de Contrato** revisa y aprueba/desaprueba/reabre las horas **de sus contratos**, viendo el contexto completo del día del operario.
- El **Supervisor** carga novedades (p. ej. Ausencia, Accidente).
- **HyS** aprueba/desaprueba las novedades que requieren su visto (las Ausencias).

El core de backend ya existe (`resolver`, `reabrir`, novedades `create`/`resolverHys`); esta fase agrega lo que falta y construye las 3 pantallas.

## 2. Backend — adiciones

### 2.1 `GET /catalogos/tipos-novedad`
En `CatalogosController` (guard `JwtAuthGuard`, cualquier usuario logueado): devuelve los tipos de novedad **activos** (`activo=true`), `select { id, nombre, requiereAprobacionHys }`, orden por nombre. Lo consume el form de novedad del Supervisor.

### 2.2 `GET /registros-horas/por-aprobar` (bandeja scopeada del Jefe de Contrato)
Nuevo endpoint en `RegistrosHorasController`, `@Roles('JefeContrato', 'Admin')`.

Lógica (`service.porAprobar(usuario)`):
1. **Mis contratos:** si `usuario.rol === 'Admin'` → todos los contratos; si `JefeContrato` → contratos donde `jefeContratoCuil === usuario.cuil`. (Set `misContratoIds`.)
2. **Pares de interés:** pares `(operarioCuil, fecha)` que tengan **al menos una** fila con `estado='pendiente'` y `contratoId ∈ misContratoIds`.
3. **Filas con contexto:** devolver **todas** las filas con `estado='pendiente'` cuyos `(operarioCuil, fecha)` estén en esos pares (incluidas filas de otros contratos), con el `INCLUDE_BASICO` habitual, más un campo calculado **`accionable: boolean`** = `misContratoIds.has(fila.contratoId)`.
4. Orden: por `fecha` desc, luego `operarioCuil`.

> Nota: se agrupa por `(operario, fecha)` porque el modelo guarda filas atómicas (1 contrato por fila); un "reporte" de un día de un operario puede abarcar varios contratos. El agrupado da el contexto completo del día; la acción es por fila.

### 2.3 Refuerzo de autorización en `resolver`
Hoy `resolver(id, dto, cuil)` solo valida el rol. Se agrega: cargar la fila con su `contratoId`, obtener el contrato y verificar que **`contrato.jefeContratoCuil === usuario.cuil` o el usuario es `Admin`**; si no, `ForbiddenException('No sos jefe del contrato de este registro')`. Para eso `resolver`/`reabrir` reciben `{ cuil, rol }` (como ya hace `update`). `reabrir` aplica el mismo check.

## 3. Frontend — Aprobaciones (`/aprobaciones`, JefeContrato)

- **Fuente:** `GET /registros-horas/por-aprobar` (hook `usePorAprobar()`).
- **Agrupado:** una utilidad pura `agruparPorOperarioFecha(filas)` arma grupos `{ operario, fecha, filas[] }`.
- **Render:** una **tarjeta por grupo** (operario + fecha). Dentro, una fila por registro:
  - Contrato · tarea · horas · móviles, con badge de **alerta >16h** si corresponde.
  - Si `accionable`: botones **Aprobar** (1 clic → `PATCH /registros-horas/:id/resolver` con `estado='aprobado'`) y **Desaprobar** (abre diálogo que pide **motivo** → `estado='desaprobado', motivoDesaprobacion`).
  - Si **no** `accionable`: la fila se muestra **atenuada (gris), solo contexto**, sin botones, con una nota "otro contrato".
- **Reabrir:** para una fila ya resuelta (aprobada/desaprobada) de mi contrato, botón **Reabrir** (`PATCH /registros-horas/:id/reabrir`). *(Las resueltas aparecen si sumamos un filtro de estado; en Fase 3 la bandeja `por-aprobar` trae solo pendientes — reabrir se ofrece desde un filtro opcional que consulta `GET /registros-horas?estado=aprobado&...`. Ver §6.)*
- Al resolver: **toast** + invalidar la query de la bandeja.

## 4. Frontend — Novedades (`/novedades`, Supervisor)

- **Lista:** `GET /novedades` (todas), hook `useNovedades()`. Tabla: operario, tipo, fecha inicio/fin, estado HyS (chip: `no_aplica`/`pendiente`/`aprobada`/`desaprobada`), quién cargó.
- **Nueva novedad:** botón que abre el form:
  - **Operario** (reusa `OperariosSelect`, búsqueda ≥3) — un solo operario.
  - **Tipo** (select de `GET /catalogos/tipos-novedad`).
  - **Fecha inicio** (requerida) y **fecha fin** (opcional).
  - **Justificación** (texto opcional). Sin adjunto.
  - Envía `POST /novedades` (`useCrearNovedad()`); éxito → toast + invalida la lista + limpia el form.

## 5. Frontend — Ausencias (`/ausencias`, HyS)

- **Bandeja:** `GET /novedades?estadoHys=pendiente` (hook `useNovedadesPorEstado('pendiente')`). Tabla: operario, tipo, fechas, justificación.
- **Acciones:** **Aprobar** / **Desaprobar** → `PATCH /novedades/:id/resolver-hys` con `estadoHys='aprobada'|'desaprobada'` (`useResolverHys()`). Toast + invalida.
- **Filtro de estado:** selector para ver también `aprobada`/`desaprobada` (historial), reusando el mismo hook con otro parámetro.

## 6. Datos y estado

- **TanStack Query** para todas las lecturas; **mutaciones** para resolver/crear/resolver-hys, invalidando la query correspondiente al éxito.
- Utilidades **puras y testeables**: `agruparPorOperarioFecha(filas)`; chip de estado HyS y de estado de registro (mapa de clases).
- Tipos nuevos en `domain.ts`: `RegistroPorAprobar` (= `RegistroHoras` + `accionable`), `TipoNovedad`, `Novedad`, `CrearNovedadInput`, `EstadoHys`.

## 7. Manejo de errores

- Desaprobar sin motivo: el diálogo lo exige (Zod) — el backend también rechaza (`BadRequestException`).
- 403 al resolver una fila que no es de mi contrato: no debería pasar (la UI solo habilita `accionable`), pero si el backend responde 403, toast con el mensaje.
- Errores de red / 401: interceptor ya maneja el 401 (re-login). El resto → toast.

## 8. Estructura de archivos

**Backend:**
```
src/catalogos/catalogos.controller.ts   # + GET tipos-novedad
src/catalogos/catalogos.service.ts       # + getTiposNovedad()
src/registros-horas/registros-horas.controller.ts  # + GET por-aprobar; resolver/reabrir reciben {cuil,rol}
src/registros-horas/registros-horas.service.ts      # + porAprobar(); check de contrato en resolver/reabrir
```

**Frontend:**
```
src/app/(protected)/aprobaciones/page.tsx
src/app/(protected)/novedades/page.tsx
src/app/(protected)/ausencias/page.tsx
src/features/aprobaciones/  # grupo-card, desaprobar-dialog
src/features/novedades/     # nueva-novedad-form
src/lib/api/aprobaciones.ts # usePorAprobar, useResolverRegistro, useReabrirRegistro
src/lib/api/novedades.ts    # useNovedades, useNovedadesPorEstado, useCrearNovedad, useResolverHys, useTiposNovedad
src/lib/agrupar.ts          # agruparPorOperarioFecha (pura) + test
```

## 9. Testing

- **Backend:** verificación por integración/curl: `tipos-novedad` responde; `por-aprobar` con un JdC devuelve solo sus pares con contexto y `accionable` correcto; `resolver` de una fila de otro contrato → 403. (Backend sigue sin suite automatizada.)
- **Frontend (Vitest + RTL):**
  - `agruparPorOperarioFecha`: unit test (agrupa bien, ordena, separa por fecha/operario).
  - Aprobaciones: filas `accionable` tienen botones y las no-accionables no; desaprobar exige motivo; aprobar llama la mutación con el id correcto.
  - Novedades: el form valida (operario+tipo+fecha inicio requeridos) y envía el payload correcto.
  - Ausencias: aprobar/desaprobar llama `resolver-hys` con el estado correcto.

## 10. Nav / permisos

Sin cambios de nav (ya existen `/aprobaciones` → JefeContrato, `/novedades` → Supervisor, `/ausencias` → HyS). Se agregan las páginas reales detrás de esas rutas. Guard por rol ya vigente.

## 11. Fuera de alcance (Fase 3)

- **Edición** de la fila desde la bandeja del Jefe de Contrato (el `PATCH /registros-horas/:id` existe; la UI de edición queda para después).
- Provisión de logins read-only de operarios (diferido de Fase 2).
- Rediseño visual (posterior, contexto §16).
- Notificaciones (no hay push/email por diseño).
