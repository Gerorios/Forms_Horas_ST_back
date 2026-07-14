# Completar CRUD de maestros admin — Diseño

**Fecha:** 2026-07-14
**Repos afectados:** `Forms_Horas_ST_back` (backend NestJS), `Forms_Horas_ST_Frontend` (frontend Next.js).

## 1. Contexto y problema

El panel Admin (Fase 4, ver `docs/superpowers/specs/2026-07-04-fase4-panel-admin-design.md`)
expone 6 maestros. Al auditar el CRUD real (2026-07-14) se detectó que 4 de ellos
están incompletos:

| Entidad | Crear | Listar | Editar | Activar/Desactivar |
|---|---|---|---|---|
| Contratos | ✅ | ✅ | ✅ | — (vía PATCH) |
| Usuarios | ✅ | ✅ | ✅ | — |
| **Tareas** | ✅ | ✅ | ❌ | ✅ (solo `activo`) |
| **Móviles** | ✅ | ✅ | ❌ | ✅ (solo `activo`) |
| **Tipos de novedad** | ✅ | ✅ | ❌ | ✅ (solo `activo`) |
| **Provincias** | ✅ | ✅ | ❌ | ❌ (no existe el campo) |

Objetivo: agregar edición completa a Tareas, Móviles y Tipos de novedad (además
del toggle que ya tienen), y edición de nombre a Provincias. Ningún hard delete
está en alcance (consistente con el resto del panel, que tampoco lo tiene).

**Decisión explícita:** Provincia **no** suma columna `activo`. Solo gana edición
de `nombre`. No hay migración de schema/DDL en este trabajo.

## 2. Backend

### 2.1 DTOs nuevos — `src/admin/dto/catalogo.dto.ts`

Mismo estilo que `UpdateContratoDto` (todos los campos opcionales, mismos
validadores que su `Create*Dto` correspondiente):

```ts
export class UpdateTareaDto {
  @IsOptional() @IsInt() contratoId?: number;
  @IsOptional() @IsString() nombre?: string;
}

export class UpdateMovilDto {
  @IsOptional() @IsString() identificador?: string;
  @IsOptional() @IsString() descripcion?: string;
}

export class UpdateProvinciaDto {
  @IsOptional() @IsString() nombre?: string;
}

export class UpdateTipoNovedadDto {
  @IsOptional() @IsString() nombre?: string;
  @IsOptional() @IsBoolean() requiereAprobacionHys?: boolean;
  @IsOptional() @IsBoolean() generaPlus?: boolean;
}
```

### 2.2 Endpoints nuevos — `src/admin/admin.controller.ts`

Todos bajo el mismo controller (`@Roles('Admin')` ya aplicado a nivel clase),
mismo patrón que `PATCH /admin/contratos/:id`:

- `PATCH /admin/tareas/:id` → `updateTarea(id, dto)`
- `PATCH /admin/moviles/:id` → `updateMovil(id, dto)`
- `PATCH /admin/provincias/:id` → `updateProvincia(id, dto)`
- `PATCH /admin/tipos-novedad/:id` → `updateTipoNovedad(id, dto)`

El toggle existente (`PATCH /admin/:entidad/:id/activo`) **no se toca** — queda
como endpoint separado, tal como ya lo consume el frontend actual.

### 2.3 Servicio — `src/admin/admin.service.ts`

Cada método es un `prisma.<modelo>.update({ where: { id }, data: dto })`
directo, igual que `updateContrato`:

```ts
updateTarea(id: number, dto: UpdateTareaDto) {
  return this.prisma.tareaCatalogo.update({ where: { id }, data: dto });
}
updateMovil(id: number, dto: UpdateMovilDto) {
  return this.prisma.movil.update({ where: { id }, data: dto });
}
updateProvincia(id: number, dto: UpdateProvinciaDto) {
  return this.prisma.provincia.update({ where: { id }, data: dto });
}
updateTipoNovedad(id: number, dto: UpdateTipoNovedadDto) {
  return this.prisma.tipoNovedad.update({ where: { id }, data: dto });
}
```

### 2.4 Manejo de errores

No se agrega manejo especial de violaciones de unicidad (`identificador` en
Móvil, `nombre` en Provincia/TipoNovedad son `@unique`). Esto es consistente
con el comportamiento actual de los endpoints `POST` de estas mismas entidades,
que tampoco capturan `P2002` — el error de Prisma burbujea como 500 genérico.
No es una regresión ni un gap nuevo introducido por este trabajo.

### 2.5 Tests

Se agregan tests de integración/unitarios para los 4 métodos de servicio y los
4 endpoints, siguiendo el patrón existente de `admin.service.spec.ts` /
`admin.controller.spec.ts` (si existen) o el que se use para `updateContrato`.

## 3. Frontend

### 3.1 Hooks — `src/lib/api/admin.ts`

Mismo shape que `useEditarContrato`:

```ts
export function useEditarTarea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: { id: number; nombre?: string; contratoId?: number }) =>
      api.patch(`/admin/tareas/${id}`, dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tareas'] }),
  });
}
// análogos: useEditarMovil, useEditarProvincia, useEditarTipoNovedad
```

### 3.2 UI — fila expandible inline

Las 4 páginas (`admin/tareas`, `admin/moviles`, `admin/provincias`,
`admin/tipos-novedad`) renderizan filas como `<div>`/`<li>`, no `<table>` (a
diferencia de Usuarios). Se adapta el patrón de `UsuarioEditRow` a ese layout:
cada entidad gana un componente `*EditRow` en `src/features/admin/` que
reemplaza el `<div>` de fila actual.

Estructura común (repetida por entidad, sin abstraer en un componente genérico
—cada una tiene campos distintos y la complejidad no lo amerita):

- Fila colapsada: datos actuales + pill de activo (si aplica) + botón
  "Editar ▾" / "Cerrar" (mismo texto/comportamiento que `UsuarioEditRow`).
- Fila expandida: inputs pre-cargados con los valores actuales, botones
  Guardar (disabled si no hay cambios o si está pendiente) / Cancelar
  (descarta y cierra).
- Guardar solo envía los campos que cambiaron (diff contra el valor original),
  igual que `guardar()` en `UsuarioEditRow`.
- `toast.promise` con mismo wording que el resto del panel (`'Guardando…'` /
  `'<Entidad> actualizada'` / `'No se pudo actualizar'`).

**Campos por entidad:**

| Entidad | Campos editables | Detalle |
|---|---|---|
| `TareaEditRow` | `nombre`, `contrato` (select) | Contrato se edita vía el mismo `<select>` de contratos que ya se usa para filtrar en la página |
| `MovilEditRow` | `identificador`, `descripcion` | — |
| `ProvinciaEditRow` | `nombre` | Provincia hoy es un `<li>` simple; gana el patrón fila+form igual que las demás |
| `TipoNovedadEditRow` | `nombre`, `requiereAprobacionHys`, `generaPlus` | Los 2 checkboxes ya existen en el form de "Nuevo tipo"; se reutiliza el mismo control |

Las páginas (`page.tsx`) pasan sus datos y las mutations al `*EditRow`
correspondiente, igual que `admin/usuarios/page.tsx` hace con
`UsuarioEditRow`.

### 3.3 Tests

Se agregan/actualizan tests de componente para cada página admin tocada,
cubriendo: render con datos, abrir edición, guardar con cambios (llama al
mutation con el payload esperado), cancelar (descarta cambios sin llamar
mutation), Guardar deshabilitado sin cambios.

## 4. Fuera de alcance

- Hard delete de cualquier entidad.
- Columna `activo` en Provincia (decisión explícita, ver §1).
- Migración de schema/DDL contra la BD compartida.
- Manejo especial de errores de unicidad (ver §2.4).
- Refactor de las páginas de tareas/móviles/provincias/tipos-novedad hacia
  tabla (`<table>`) — se mantiene el layout de lista actual.

## 5. Verificación

- Backend: tests unitarios/integración de los 4 métodos + 4 endpoints nuevos;
  `npm run lint`, `npm run build`.
- Frontend: tests de componente de las 4 páginas; `npm test`, `npm run lint`,
  `npm run build`.
- E2E manual por curl de al menos un PATCH de cada entidad contra la BD real,
  igual que se hizo en Fase 4 y en la edición de usuario (ver §21 del contexto
  del proyecto).
