# Fase 4 — Panel Admin (Design)

**Fecha:** 2026-07-04
**Proyecto:** App de Registro de Horas (ver `Backend/.claude/Contexto/contexto-proyecto.md`)
**Alcance:** El panel de administración (solo rol Admin): ABM de Usuarios, Contratos, Tareas, Móviles, Provincias y Tipos de novedad, más el **alta masiva de operarios**. En crudo sobre el sistema visual ya establecido.

---

## 1. Objetivo

Dar al Admin una interfaz para administrar todo lo que hoy solo existe vía API: crear/editar usuarios (incluye la provisión de logins de operarios), contratos, catálogos de tareas/móviles/provincias y tipos de novedad. Cierra la Fase 4 (§10 del contexto) y habilita la operación real (usuarios reales, contratos K2–K12, tareas/móviles/tipos reales).

El backend ya expone casi todo (`AdminController`, `@Roles('Admin')`); esta fase agrega **un endpoint** (alta masiva) y construye la UI.

## 2. Estructura de rutas (sub-rutas bajo `/admin`)

Layout `/admin` con **sub-navegación** propia (aside/tabs secundarios) y una ruta por sección:
- `/admin/usuarios`
- `/admin/contratos`
- `/admin/tareas`
- `/admin/moviles`
- `/admin/provincias`
- `/admin/tipos-novedad`

`/admin` redirige a `/admin/usuarios`. Todo el árbol requiere rol **Admin** (guard en el layout de `/admin`, además del guard general de `(protected)` y `canAccess`).

## 3. Secciones (ABM sobre endpoints existentes)

Cada sección = una tabla (lista) + un formulario de alta + acciones. Estilo: `PageHeader`, cards, `StatusBadge`/pills de activo, botones dorados, feedback con `toast.promise`.

- **Contratos** (`GET/POST/PATCH /admin/contratos`): lista (código, nombre, jefe, activo). Crear: código, nombre, jefe de contrato (buscar empleado con login — opcional). Editar: nombre, jefe, activo.
- **Tareas** (`GET/POST /admin/tareas`, `PATCH /admin/tareas/:id/activo`): selector de contrato → lista de tareas de ese contrato. Crear: contrato + nombre. Toggle activo por fila.
- **Móviles** (`GET/POST /admin/moviles`, `PATCH /admin/moviles/:id/activo`): lista. Crear: identificador + descripción. Toggle activo.
- **Provincias** (`GET/POST /admin/provincias`): lista + crear (nombre).
- **Tipos de novedad** (`GET/POST /admin/tipos-novedad`, `PATCH /admin/tipos-novedad/:id/activo`): lista (nombre, requiere HyS, genera plus, activo). Crear: nombre + checkboxes "requiere aprobación HyS" y "genera plus". Toggle activo.
- **Usuarios** (`GET/POST /admin/usuarios`, `PATCH /admin/usuarios/:cuil`): lista (cuil, empleado, email, rol, activo, contratos). Crear individual: buscar empleado (reusa `OperariosSelect`, uno) → email → contraseña → rol (de `GET /admin/roles`) → contratos habilitados (multiselect, de contratos; solo relevante para roles que cargan). Editar: email, rol, activo, contratos, cambiar contraseña (opcional). Más el **alta masiva** (sección 4).

## 4. Adición de backend: alta masiva de operarios

`POST /admin/usuarios/masivo` (`@Roles('Admin')`), DTO `CrearUsuariosMasivoDto { cuils: string[] }`.

Servicio `createUsuariosMasivo(cuils)`:
1. Resolver el `rolId` de **Operario**.
2. Para cada `cuil`:
   - Si ya existe usuario con ese cuil → **saltear** (reportar como omitido).
   - Traer el empleado de `snuempleados` (legajo, apellido_nombre). Si no existe/está inactivo → saltear.
   - **Email:** `<legajo>@st.local`. Si `legajo` es 0 o el email ya existe, usar `<cuil>@st.local`; si aún colisiona, sufijo incremental.
   - **Contraseña:** aleatoria por usuario (10 caracteres alfanuméricos).
   - Crear usuario rol Operario (sin contratos habilitados; los operarios no cargan).
3. Devolver `{ creados: [{ cuil, apellido_nombre, email, password }], omitidos: [{ cuil, motivo }] }`.

> La contraseña en claro se devuelve **solo en la respuesta** (para distribuir); no se persiste en claro. No hay flujo de cambio de contraseña todavía (queda como pendiente conocido).

## 5. Frontend — datos y estado

- Hooks TanStack Query en `lib/api/admin.ts`: `useRoles`, `useContratos`/`useCrearContrato`/`useEditarContrato`, `useTareas`(admin)/`useCrearTarea`/`useToggleTarea`, `useMoviles`(admin)/`useCrearMovil`/`useToggleMovil`, `useProvincias`(admin)/`useCrearProvincia`, `useTiposNovedad`(admin)/`useCrearTipoNovedad`/`useToggleTipoNovedad`, `useUsuarios`/`useCrearUsuario`/`useEditarUsuario`/`useCrearUsuariosMasivo`.
  - Nota: los GET de catálogos de admin traen **todos** (incluidos inactivos), distintos de los `/catalogos/*` (solo activos) que ya existen para el reporte.
- Mutaciones con `toast.promise` (loading/success/error) e invalidación de la query correspondiente. Botones deshabilitados mientras procesan (patrón ya usado).
- Utilidades puras testeables donde aplique (p. ej. armado del payload de alta masiva).

## 6. Manejo de errores

- Validación de formularios inline (campos requeridos; email válido; contraseña mínima 8 en alta individual).
- Conflictos del backend (ej. CUIL/email/identificador ya existe → 409): toast con el mensaje.
- Alta masiva: la respuesta lista **creados** (con credenciales) y **omitidos** (con motivo); ambos se muestran. Botón para **copiar** la tabla de credenciales.
- 401/403: interceptor/guard existentes.

## 7. Estructura de archivos

**Backend:**
```
src/admin/dto/usuario.dto.ts        # + CrearUsuariosMasivoDto
src/admin/admin.service.ts          # + createUsuariosMasivo()
src/admin/admin.controller.ts       # + POST usuarios/masivo
```

**Frontend:**
```
src/app/(protected)/admin/layout.tsx          # sub-nav + guard Admin
src/app/(protected)/admin/page.tsx            # redirect a /admin/usuarios
src/app/(protected)/admin/usuarios/page.tsx
src/app/(protected)/admin/contratos/page.tsx
src/app/(protected)/admin/tareas/page.tsx
src/app/(protected)/admin/moviles/page.tsx
src/app/(protected)/admin/provincias/page.tsx
src/app/(protected)/admin/tipos-novedad/page.tsx
src/features/admin/                            # forms + tablas + alta-masiva
src/lib/api/admin.ts                           # hooks
```

## 8. Testing

- **Backend:** verificación por integración/curl del alta masiva (crea, saltea existentes, devuelve credenciales; email por legajo con fallback a cuil).
- **Frontend (Vitest + RTL):**
  - Usuarios: el form de alta individual valida y envía el payload correcto; el alta masiva muestra la tabla de credenciales tras la respuesta.
  - Al menos una sección de catálogo (ej. Móviles o Tipos de novedad): crear llama la mutación con el payload correcto; toggle activo llama la mutación.
  - Guard: un rol no-Admin no accede a `/admin/*` (canAccess ya lo cubre; test del guard del layout si aplica).

## 9. Nav / permisos

- El item "Admin" del nav ya existe (`/admin`, rol Admin). Se agrega la sub-nav dentro de `/admin`. `canAccess('Admin', '/admin')` ya es true; los no-Admin no ven el item ni pueden entrar.

## 10. Fuera de alcance (Fase 4)

- Flujo de **cambio de contraseña** por el propio usuario (no existe backend; las contraseñas las setea/reset el Admin).
- Borrado físico de registros/usuarios (se usa activo/inactivo, no delete).
- Edición de tareas/móviles más allá de activar/desactivar (el backend solo expone toggle; alta y toggle cubren la operación).
- Rediseño adicional: se usa el sistema visual ya establecido.
- Vista SQL de liquidación (externo, a coordinar con sistemas).
