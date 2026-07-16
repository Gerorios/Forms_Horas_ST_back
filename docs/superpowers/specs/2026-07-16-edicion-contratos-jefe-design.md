# Edición de Contratos (nombre + Jefe de Contrato) — Diseño

**Fecha:** 2026-07-16
**Repos afectados:** `Forms_Horas_ST_back` (backend NestJS), `Forms_Horas_ST_Frontend` (frontend Next.js).

## 1. Contexto y problema

Detectado durante debugging de un bug reportado: un Jefe de Cuadrilla cargó horas en un
contrato, pero el Jefe de Contrato de ese mismo contrato no veía nada pendiente en
`/aprobaciones`. Root cause confirmado con datos reales: **los 8 contratos de la BD tenían
`jefeContratoCuil = null`** — `GET /registros-horas/por-aprobar` filtra por
`{ jefeContratoCuil: usuario.cuil }`, así que sin ese dato seteado, ningún JefeContrato ve nada,
sin importar el contrato.

Causa raíz secundaria: **no hay forma de asignar el Jefe de Contrato desde la UI**. El backend
ya soporta editar `jefeContratoCuil` vía `PATCH /admin/contratos/:id`
(`UpdateContratoDto`/`AdminService.updateContrato`, ya existentes desde antes), y el hook
`useEditarContrato` en el frontend también existe — pero `/admin/contratos` (página) solo
permite crear contratos y activar/desactivarlos; **muestra** el jefe si está seteado
(`page.tsx:70`, `{c.jefeContrato && ...}`) pero no permite asignarlo ni cambiarlo. La única forma
de setearlo hoy es a mano contra la base.

**Alcance de este trabajo:** aprovechar para dejar `/admin/contratos` consistente con el resto
del panel Admin (Tareas, Móviles, Provincias, Tipos de novedad), que ya tienen el patrón de fila
expandible (`TareaEditRow`, `MovilEditRow`, etc.) — Contratos se había quedado afuera de esa
mejora. Se edita **nombre** y **Jefe de Contrato** juntos.

## 2. Backend

### 2.1 DTO — `src/admin/dto/contrato.dto.ts`

`UpdateContratoDto.jefeContratoCuil` pasa a aceptar `string | null` explícito (hoy solo acepta
`string | undefined`), para poder **desasignar** un jefe (volver a "sin jefe").

```ts
export class UpdateContratoDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  jefeContratoCuil?: string | null;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
```

No hace falta cambiar el decorador `@IsOptional()` — en `class-validator`, `@IsOptional()` salta
la validación del resto de los decoradores (`@IsString()` incluido) cuando el valor es `null` o
`undefined`, así que `null` ya pasa validación sin cambios adicionales. Solo se amplía el tipo
TypeScript para que el compilador no rechace enviar `null` explícito.

### 2.2 Servicio y controlador — sin cambios de código

`AdminService.updateContrato` (`admin.service.ts:27`) ya hace
`this.prisma.contrato.update({ where: { id }, data: dto })` — Prisma acepta `jefeContratoCuil:
null` directamente para limpiar la FK (la columna ya es nullable en el schema:
`jefeContratoCuil String? @map(...)`). `PATCH /admin/contratos/:id` (`admin.controller.ts:25-28`)
no necesita ningún cambio, ya reenvía el DTO completo al servicio.

## 3. Frontend

### 3.1 Fuente de datos para el selector de jefe

No hay endpoint dedicado para "usuarios con rol X". Se reusa `useUsuariosAdmin()` (ya trae
`rol: { nombre }` y `empleado: { apellido_nombre }` por usuario) y se filtra client-side por
`rol.nombre === 'JefeContrato'` — mismo enfoque que ya usa `UsuarioEditRow` para el selector de
rol (filtra `useRoles()` client-side).

### 3.2 Componente nuevo — `ContratoEditRow`

Mismo patrón que `TareaEditRow`/`MovilEditRow` (fila expandible inline, root `<div>` ya que
`admin/contratos/page.tsx` es una lista de `<div>`, no una tabla):

- Fila colapsada: código, nombre, "jefe: {email}" si está seteado (igual que hoy) + pill de
  activo (`PillActivo`, pasado como prop `pill` igual que en `TareaEditRow`) + botón
  "Editar ▾"/"Cerrar".
- Fila expandida:
  - Input **Nombre** (precargado con `contrato.nombre`).
  - **Select Jefe de Contrato**: opción `"Sin jefe asignado"` (value `""`) + una opción por cada
    usuario con rol `JefeContrato`, mostrando `"{apellido_nombre} — {email}"`. Precargado con
    `contrato.jefeContratoCuil ?? ''`.
  - Guardar (disabled si no hay cambios o está pendiente) / Cancelar (descarta, no llama a la
    mutation) — mismo diffing que los demás EditRow: solo se envían los campos que cambiaron. Si
    el select vuelve a `""` y antes tenía un jefe, se envía `jefeContratoCuil: null` (no
    `undefined`, para que el backend efectivamente lo limpie).
  - `toast.promise`: `'Guardando…'` / `'Contrato actualizado'` / `'No se pudo actualizar'` (mismo
    wording que ya usa `cambiarActivo` en esta página).

### 3.3 Wiring en `admin/contratos/page.tsx`

Reemplaza el `<div>` de fila plana por `<ContratoEditRow>`, pasando `contrato={c}`,
`usuariosJefeContrato={...}` (lista ya filtrada por la página) y
`pill={<PillActivo ... onToggle={() => cambiarActivo(c.id, !c.activo)} />}` — mismo patrón que
`TareaEditRow` recibe `contratos` y `pill` desde su página.

## 4. Fuera de alcance

- Endpoint dedicado `GET /admin/usuarios?rol=JefeContrato` — se resuelve filtrando client-side los
  datos que ya trae `useUsuariosAdmin()` (volumen bajo, mismo criterio que el resto del panel).
- Restringir que un usuario solo pueda ser jefe de un contrato a la vez, o cualquier otra regla de
  negocio nueva sobre la relación contrato↔jefe — no fue pedido, no se agrega.
- Hard delete de contratos.
- Cambios al selector de roles/contratos habilitados de usuario (`UsuarioEditRow`) — no relacionado.

## 5. Verificación

- Backend: `npm run build` (sin test suite automatizada, consistente con el resto de `AdminService`).
- Frontend: tests de componente para `ContratoEditRow` (precarga, editar nombre, asignar jefe,
  desasignar jefe → payload con `jefeContratoCuil: null`, Guardar deshabilitado sin cambios,
  Cancelar no llama a la mutation) + test de integración de la página. `npm test`, `npm run lint`,
  `npm run build`.
- E2E manual: asignar un jefe a un contrato desde la UI y confirmar que ese usuario ve los
  registros pendientes de ese contrato en `/aprobaciones`.
