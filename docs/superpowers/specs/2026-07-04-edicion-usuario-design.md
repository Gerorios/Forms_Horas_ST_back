# Edición completa de usuario (inline) — Design

Fecha: 2026-07-04
Estado: aprobado, listo para plan

## Contexto

El Panel Admin (Fase 4) lista usuarios y solo permite **activar/desactivar**
(toggle `PillActivo`). Falta la edición completa: cambiar email, rol, contratos
habilitados y resetear contraseña.

**Hallazgo:** el backend ya soporta todo. `PATCH /admin/usuarios/:cuil`
(`UpdateUsuarioDto` + `AdminService.updateUsuario`) acepta `email`, `password`,
`rolId`, `activo` y `contratosIds`. El hook `useEditarUsuario` del frontend ya
manda todos esos campos. **El gap es exclusivamente la UI de edición.**

Por lo tanto este trabajo es **solo frontend**. No se toca el backend.

## Alcance

Agregar edición de un usuario existente desde `/admin/usuarios`, con patrón de
**fila expandible inline** (no modal).

### Fuera de alcance
- Cambiar el empleado/CUIL de un usuario (es la PK, inmutable).
- El toggle de activo (`PillActivo`) — se mantiene tal cual, sin cambios.
- Eliminación de usuarios (descartado explícitamente).
- Flujo de cambio de contraseña por el propio usuario (otro pendiente global).

## Diseño

### Componente nuevo: `UsuarioEditRow`
`src/features/admin/usuario-edit-row.tsx`

Encapsula una fila de la tabla de usuarios más su estado expandido.

- Fila normal: muestra empleado, email, rol, contratos, estado (`PillActivo`) y
  un botón **"Editar ▾"** en una columna de acciones.
- Al hacer clic en "Editar", se despliega **debajo** de la fila (un `<tr>` con
  `colSpan` que abarca toda la tabla) un formulario pre-cargado con los valores
  actuales del usuario:
  - **Email** — input, requerido, formato email.
  - **Rol** — `<select>` poblado con `useRoles`.
  - **Contratos habilitados** — chips toggle (mismo patrón que `UsuarioForm`),
    usando `useContratosAdmin`.
  - **Nueva contraseña** — input opcional. Vacío = no se cambia; si se completa,
    mínimo 8 caracteres.
  - Botones **Guardar** / **Cancelar**.
- **Guardar** deshabilitado si el form es inválido (email vacío/mal formado, o
  password presente con <8) **o si no hubo ningún cambio** respecto a los valores
  originales.
- **Cancelar** colapsa la fila y descarta cambios (sin llamar al backend).

### Página modificada: `usuarios/page.tsx`
- Reemplaza el `<tr>` actual del `map` por `<UsuarioEditRow usuario={u} />`.
- Se agrega una columna **"Acciones"** en el `<thead>` para el botón Editar.
- El toggle de activo (`PillActivo`) sigue en su columna "Estado", sin cambios.
- La lógica de `cambiarActivo` existente se mantiene.

### Flujo de datos
- Guardar → `editar.mutateAsync({ cuil, ...camposCambiados })` con el hook
  `useEditarUsuario` (ya existente).
  - Se envían **solo los campos que cambiaron**: `email` si difiere, `rolId` si
    difiere, `contratosIds` si difiere, `password` **solo si** se escribió algo.
- Feedback con `toast.promise` (loading / success / error).
- Al éxito: colapsar la fila. El hook ya hace
  `invalidateQueries(['admin','usuarios'])`, que refresca la tabla.

### Validaciones (cliente)
- Email: no vacío + formato válido.
- Password: si está presente, ≥8 caracteres.
- El backend revalida igual vía `UpdateUsuarioDto` (`@IsEmail`, `@MinLength(8)`).

## Testing (Vitest)

`src/features/admin/usuario-edit-row.test.tsx`:
1. Precarga los valores actuales del usuario (email, rol, contratos) al expandir.
2. Editar el email y Guardar llama al mutate con el email nuevo y el cuil correcto.
3. Password vacío ⇒ el payload del mutate **no** incluye `password`.
4. Password con <8 caracteres ⇒ botón Guardar deshabilitado.
5. Cancelar colapsa la fila **sin** llamar al mutate.

Objetivo: mantener la suite verde (hoy 54/54), lint y build OK.

## Riesgos / notas
- Ninguno en backend (no se toca).
- Consistencia visual: reusar los estilos de inputs/chips de `UsuarioForm` para
  que el form de edición se vea igual que el de alta.
