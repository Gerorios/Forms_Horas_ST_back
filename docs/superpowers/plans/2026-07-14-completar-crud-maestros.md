# Completar CRUD de maestros admin — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar edición completa (PATCH) a los maestros Tareas, Móviles, Tipos de novedad y Provincias del panel Admin, en backend y frontend, siguiendo el mismo patrón ya usado para Contratos y Usuarios.

**Architecture:** Backend NestJS — un DTO `Update*Dto` y un endpoint `PATCH /admin/<entidad>/:id` por maestro, delegando a un `prisma.<modelo>.update()` en `AdminService` (mismo patrón que `updateContrato`). Frontend Next.js — un hook `useEditar*` por maestro en `lib/api/admin.ts` y un componente `*EditRow` por maestro que reemplaza la fila de lista actual por una fila expandible inline con form (mismo patrón que `UsuarioEditRow`).

**Tech Stack:** NestJS 11, Prisma 7 (`@prisma/adapter-mariadb`), class-validator — backend. Next.js (App Router), TanStack Query, Axios, Vitest + Testing Library — frontend.

## Global Constraints

- Repos: backend en `Forms_Horas_ST_back` (este working directory), frontend en `Forms_Horas_ST_Frontend` (`../Frontend` relativo a este repo).
- **Nunca correr `prisma db push` ni `prisma migrate`** contra la BD compartida — no aplica a este plan (no hay cambios de schema).
- Provincia **no** suma columna `activo` — solo edición de `nombre`. Fuera de alcance.
- Ningún hard delete en alcance.
- No se agrega manejo especial de errores de unicidad (`P2002`) — mismo comportamiento que los `POST` existentes.
- El toggle `PATCH /admin/<entidad>/:id/activo` ya existente **no se toca** — el `PATCH /admin/<entidad>/:id` nuevo es un endpoint separado.
- Backend sin infraestructura de tests automatizados (no hay ningún `*.spec.ts` en `src/`, no hay carpeta `test/`) — la verificación de cada tarea de backend es `npm run build` (compila TS) + curl manual documentado (mismo patrón que todo el módulo Admin existente, ver `docs/superpowers/specs/2026-07-04-fase4-panel-admin-design.md` y contexto §21). No hay script de lint en el backend.
- Frontend sí tiene tests (Vitest + Testing Library) — cada tarea de frontend sigue TDD.
- Spec completa: `docs/superpowers/specs/2026-07-14-completar-crud-maestros-design.md`.

---

## Backend (`Forms_Horas_ST_back`)

### Task 1: `PATCH /admin/tareas/:id`

**Files:**
- Modify: `src/admin/dto/catalogo.dto.ts`
- Modify: `src/admin/admin.service.ts`
- Modify: `src/admin/admin.controller.ts`

**Interfaces:**
- Produces: `UpdateTareaDto { contratoId?: number; nombre?: string }`, `AdminService.updateTarea(id: number, dto: UpdateTareaDto)`, endpoint `PATCH /admin/tareas/:id`.

- [ ] **Step 1: Agregar `UpdateTareaDto`**

En `src/admin/dto/catalogo.dto.ts`, justo debajo de `CreateTareaDto`:

```ts
export class CreateTareaDto {
  @IsInt()
  contratoId: number;

  @IsString()
  nombre: string;
}

export class UpdateTareaDto {
  @IsOptional()
  @IsInt()
  contratoId?: number;

  @IsOptional()
  @IsString()
  nombre?: string;
}
```

- [ ] **Step 2: Agregar `updateTarea` al servicio**

En `src/admin/admin.service.ts`, debajo de `toggleTarea`:

```ts
updateTarea(id: number, dto: UpdateTareaDto) {
  return this.prisma.tareaCatalogo.update({ where: { id }, data: dto });
}
```

Agregar `UpdateTareaDto` al import existente de `'./dto/catalogo.dto'` en ese archivo.

- [ ] **Step 3: Agregar el endpoint**

En `src/admin/admin.controller.ts`:

1. Sumar `UpdateTareaDto` al import de `'./dto/catalogo.dto'` (línea 4).
2. Debajo de `toggleTarea`:

```ts
@Patch('tareas/:id')
updateTarea(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTareaDto) {
  return this.service.updateTarea(id, dto);
}
```

- [ ] **Step 4: Verificar que compila**

Run: `npm run build`
Expected: termina sin errores (carpeta `dist/` generada).

- [ ] **Step 5: Verificación manual E2E (curl)**

El usuario, con un token Admin real (`POST /auth/login` con `rcarrazana@serytec.com`), corre:

```bash
curl -X PATCH http://localhost:3001/admin/tareas/<id> \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"nombre":"Excavación (editado)"}'
```

Expected: 200 con la fila actualizada; `GET /admin/tareas` refleja el nuevo nombre.

- [ ] **Step 6: Commit**

```bash
git add src/admin/dto/catalogo.dto.ts src/admin/admin.service.ts src/admin/admin.controller.ts
git commit -m "feat(admin): PATCH /admin/tareas/:id para edición completa"
```

---

### Task 2: `PATCH /admin/moviles/:id`

**Files:**
- Modify: `src/admin/dto/catalogo.dto.ts`
- Modify: `src/admin/admin.service.ts`
- Modify: `src/admin/admin.controller.ts`

**Interfaces:**
- Produces: `UpdateMovilDto { identificador?: string; descripcion?: string }`, `AdminService.updateMovil(id: number, dto: UpdateMovilDto)`, endpoint `PATCH /admin/moviles/:id`.

- [ ] **Step 1: Agregar `UpdateMovilDto`**

En `src/admin/dto/catalogo.dto.ts`, debajo de `CreateMovilDto`:

```ts
export class UpdateMovilDto {
  @IsOptional()
  @IsString()
  identificador?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;
}
```

- [ ] **Step 2: Agregar `updateMovil` al servicio**

En `src/admin/admin.service.ts`, debajo de `toggleMovil`:

```ts
updateMovil(id: number, dto: UpdateMovilDto) {
  return this.prisma.movil.update({ where: { id }, data: dto });
}
```

Sumar `UpdateMovilDto` al import de `'./dto/catalogo.dto'`.

- [ ] **Step 3: Agregar el endpoint**

En `src/admin/admin.controller.ts`, sumar `UpdateMovilDto` al import y agregar debajo de `toggleMovil`:

```ts
@Patch('moviles/:id')
updateMovil(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMovilDto) {
  return this.service.updateMovil(id, dto);
}
```

- [ ] **Step 4: Verificar que compila**

Run: `npm run build`
Expected: termina sin errores.

- [ ] **Step 5: Verificación manual E2E (curl)**

```bash
curl -X PATCH http://localhost:3001/admin/moviles/<id> \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"descripcion":"Camioneta blanca"}'
```

Expected: 200 con la fila actualizada.

- [ ] **Step 6: Commit**

```bash
git add src/admin/dto/catalogo.dto.ts src/admin/admin.service.ts src/admin/admin.controller.ts
git commit -m "feat(admin): PATCH /admin/moviles/:id para edición completa"
```

---

### Task 3: `PATCH /admin/provincias/:id`

**Files:**
- Modify: `src/admin/dto/catalogo.dto.ts`
- Modify: `src/admin/admin.service.ts`
- Modify: `src/admin/admin.controller.ts`

**Interfaces:**
- Produces: `UpdateProvinciaDto { nombre?: string }`, `AdminService.updateProvincia(id: number, dto: UpdateProvinciaDto)`, endpoint `PATCH /admin/provincias/:id`.

- [ ] **Step 1: Agregar `UpdateProvinciaDto`**

En `src/admin/dto/catalogo.dto.ts`, debajo de `CreateProvinciaDto`:

```ts
export class UpdateProvinciaDto {
  @IsOptional()
  @IsString()
  nombre?: string;
}
```

- [ ] **Step 2: Agregar `updateProvincia` al servicio**

En `src/admin/admin.service.ts`, debajo de `createProvincia`:

```ts
updateProvincia(id: number, dto: UpdateProvinciaDto) {
  return this.prisma.provincia.update({ where: { id }, data: dto });
}
```

Sumar `UpdateProvinciaDto` al import de `'./dto/catalogo.dto'`.

- [ ] **Step 3: Agregar el endpoint**

En `src/admin/admin.controller.ts`, sumar `UpdateProvinciaDto` al import y agregar debajo de `createProvincia`:

```ts
@Patch('provincias/:id')
updateProvincia(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProvinciaDto) {
  return this.service.updateProvincia(id, dto);
}
```

- [ ] **Step 4: Verificar que compila**

Run: `npm run build`
Expected: termina sin errores.

- [ ] **Step 5: Verificación manual E2E (curl)**

```bash
curl -X PATCH http://localhost:3001/admin/provincias/<id> \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"nombre":"Córdoba Capital"}'
```

Expected: 200 con la fila actualizada.

- [ ] **Step 6: Commit**

```bash
git add src/admin/dto/catalogo.dto.ts src/admin/admin.service.ts src/admin/admin.controller.ts
git commit -m "feat(admin): PATCH /admin/provincias/:id para edición de nombre"
```

---

### Task 4: `PATCH /admin/tipos-novedad/:id`

**Files:**
- Modify: `src/admin/dto/catalogo.dto.ts`
- Modify: `src/admin/admin.service.ts`
- Modify: `src/admin/admin.controller.ts`

**Interfaces:**
- Produces: `UpdateTipoNovedadDto { nombre?: string; requiereAprobacionHys?: boolean; generaPlus?: boolean }`, `AdminService.updateTipoNovedad(id: number, dto: UpdateTipoNovedadDto)`, endpoint `PATCH /admin/tipos-novedad/:id`.

- [ ] **Step 1: Agregar `UpdateTipoNovedadDto`**

En `src/admin/dto/catalogo.dto.ts`, debajo de `CreateTipoNovedadDto`:

```ts
export class UpdateTipoNovedadDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  requiereAprobacionHys?: boolean;

  @IsOptional()
  @IsBoolean()
  generaPlus?: boolean;
}
```

- [ ] **Step 2: Agregar `updateTipoNovedad` al servicio**

En `src/admin/admin.service.ts`, debajo de `toggleTipoNovedad`:

```ts
updateTipoNovedad(id: number, dto: UpdateTipoNovedadDto) {
  return this.prisma.tipoNovedad.update({ where: { id }, data: dto });
}
```

Sumar `UpdateTipoNovedadDto` al import de `'./dto/catalogo.dto'`.

- [ ] **Step 3: Agregar el endpoint**

En `src/admin/admin.controller.ts`, sumar `UpdateTipoNovedadDto` al import y agregar debajo de `toggleTipoNovedad`:

```ts
@Patch('tipos-novedad/:id')
updateTipoNovedad(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTipoNovedadDto) {
  return this.service.updateTipoNovedad(id, dto);
}
```

- [ ] **Step 4: Verificar que compila**

Run: `npm run build`
Expected: termina sin errores.

- [ ] **Step 5: Verificación manual E2E (curl)**

```bash
curl -X PATCH http://localhost:3001/admin/tipos-novedad/<id> \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"generaPlus":true}'
```

Expected: 200 con la fila actualizada.

- [ ] **Step 6: Commit**

```bash
git add src/admin/dto/catalogo.dto.ts src/admin/admin.service.ts src/admin/admin.controller.ts
git commit -m "feat(admin): PATCH /admin/tipos-novedad/:id para edición completa"
```

---

## Frontend (`Forms_Horas_ST_Frontend`)

> Todos los comandos de esta sección corren desde el repo frontend (`../Frontend` relativo a `Forms_Horas_ST_back`).

### Task 5: Hooks `useEditar*` en `lib/api/admin.ts`

**Files:**
- Modify: `src/lib/api/admin.ts`

**Interfaces:**
- Consumes: endpoints `PATCH /admin/tareas/:id`, `/admin/moviles/:id`, `/admin/provincias/:id`, `/admin/tipos-novedad/:id` (Tasks 1-4).
- Produces: `useEditarTarea()`, `useEditarMovil()`, `useEditarProvincia()`, `useEditarTipoNovedad()` — cada uno devuelve un `useMutation` de TanStack Query con `.mutateAsync` e `.isPending`, mismo shape que `useEditarContrato`.

No hay test dedicado para estos hooks — en este codebase los hooks de `lib/api/admin.ts` no tienen test propio, se ejercitan a través de los tests de componente que mockean el módulo (ver `usuario-edit-row.test.tsx`). Esto se verifica en las Tasks 6-9.

- [ ] **Step 1: Agregar `useEditarTarea` debajo de `useToggleTarea`**

```ts
export function useEditarTarea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: { id: number; contratoId?: number; nombre?: string }) =>
      api.patch(`/admin/tareas/${id}`, dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tareas'] }),
  });
}
```

- [ ] **Step 2: Agregar `useEditarMovil` debajo de `useToggleMovil`**

```ts
export function useEditarMovil() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: { id: number; identificador?: string; descripcion?: string }) =>
      api.patch(`/admin/moviles/${id}`, dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'moviles'] }),
  });
}
```

- [ ] **Step 3: Agregar `useEditarProvincia` debajo de `useCrearProvincia`**

```ts
export function useEditarProvincia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: { id: number; nombre?: string }) =>
      api.patch(`/admin/provincias/${id}`, dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'provincias'] }),
  });
}
```

- [ ] **Step 4: Agregar `useEditarTipoNovedad` debajo de `useToggleTipoNovedad`**

```ts
export function useEditarTipoNovedad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: { id: number; nombre?: string; requiereAprobacionHys?: boolean; generaPlus?: boolean }) =>
      api.patch(`/admin/tipos-novedad/${id}`, dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tipos-novedad'] }),
  });
}
```

- [ ] **Step 5: Verificar que compila**

Run: `npm run build`
Expected: termina sin errores de tipos.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/admin.ts
git commit -m "feat(admin): hooks useEditarTarea/Movil/Provincia/TipoNovedad"
```

---

### Task 6: `TareaEditRow` + wiring en `admin/tareas`

**Files:**
- Create: `src/features/admin/tarea-edit-row.tsx`
- Create: `src/features/admin/tarea-edit-row.test.tsx`
- Modify: `src/app/(protected)/admin/tareas/page.tsx`

**Interfaces:**
- Consumes: `useEditarTarea()` (Task 5), `TareaAdmin { id, nombre, contratoId, activo }`, `ContratoAdmin { id, codigo, nombre, activo, jefeContratoCuil, jefeContrato }` (ambos ya exportados desde `@/lib/api/admin`).
- Produces: `TareaEditRow({ tarea: TareaAdmin; contratos: ContratoAdmin[]; pill: ReactNode })` — componente de fila expandible.

- [ ] **Step 1: Escribir el test (falla porque el componente no existe)**

Crear `src/features/admin/tarea-edit-row.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TareaAdmin, ContratoAdmin } from '@/lib/api/admin';

const editar = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/admin', () => ({
  useEditarTarea: () => ({ mutateAsync: editar, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }));

import { TareaEditRow } from './tarea-edit-row';

const TAREA: TareaAdmin = { id: 1, nombre: 'Excavación', contratoId: 10, activo: true };
const CONTRATOS: ContratoAdmin[] = [
  { id: 10, codigo: 'K5', nombre: 'Contrato K5', activo: true, jefeContratoCuil: null, jefeContrato: null },
  { id: 11, codigo: 'K8', nombre: 'Contrato K8', activo: true, jefeContratoCuil: null, jefeContrato: null },
];

function renderRow(tarea: TareaAdmin = TAREA) {
  return render(<TareaEditRow tarea={tarea} contratos={CONTRATOS} pill={<span>pill</span>} />);
}

describe('TareaEditRow', () => {
  beforeEach(() => { editar.mockClear(); });

  it('precarga nombre y contrato al expandir', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByLabelText('Nombre')).toHaveValue('Excavación');
    expect(screen.getByLabelText('Contrato')).toHaveValue('10');
  });

  it('editar el nombre y guardar llama al mutate con id y nombre nuevo', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const nombre = screen.getByLabelText('Nombre');
    await userEvent.clear(nombre);
    await userEvent.type(nombre, 'Montaje');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(editar).toHaveBeenCalledWith({ id: 1, nombre: 'Montaje' }));
  });

  it('cambiar el contrato llama al mutate solo con contratoId', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.selectOptions(screen.getByLabelText('Contrato'), '11');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(editar).toHaveBeenCalledWith({ id: 1, contratoId: 11 }));
  });

  it('Guardar deshabilitado sin cambios', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByRole('button', { name: /guardar/i })).toBeDisabled();
  });

  it('Cancelar colapsa la fila sin llamar al mutate', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.type(screen.getByLabelText('Nombre'), ' extra');
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument();
    expect(editar).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- src/features/admin/tarea-edit-row.test.tsx`
Expected: FAIL — `Failed to resolve import "./tarea-edit-row"`.

- [ ] **Step 3: Implementar `TareaEditRow`**

Crear `src/features/admin/tarea-edit-row.tsx`:

```tsx
'use client';

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useEditarTarea, type TareaAdmin, type ContratoAdmin } from '@/lib/api/admin';

const inputCls =
  'rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30';

export function TareaEditRow({
  tarea,
  contratos,
  pill,
}: {
  tarea: TareaAdmin;
  contratos: ContratoAdmin[];
  pill: ReactNode;
}) {
  const editar = useEditarTarea();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState(tarea.nombre);
  const [contratoId, setContratoId] = useState(tarea.contratoId);

  const nombreValido = nombre.trim().length > 0;
  const huboCambios = nombre.trim() !== tarea.nombre || contratoId !== tarea.contratoId;
  const puedeGuardar = nombreValido && huboCambios && !editar.isPending;

  function cerrar() {
    setAbierto(false);
    setNombre(tarea.nombre);
    setContratoId(tarea.contratoId);
  }

  async function guardar() {
    if (!puedeGuardar) return;
    const payload: { id: number; nombre?: string; contratoId?: number } = { id: tarea.id };
    if (nombre.trim() !== tarea.nombre) payload.nombre = nombre.trim();
    if (contratoId !== tarea.contratoId) payload.contratoId = contratoId;

    const promesa = editar.mutateAsync(payload);
    toast.promise(promesa, {
      loading: 'Guardando…',
      success: 'Tarea actualizada',
      error: 'No se pudo actualizar',
    });
    try {
      await promesa;
      setAbierto(false);
    } catch {
      // toast.promise ya avisó
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
        <span className="font-medium text-ink">{tarea.nombre}</span>
        <span className="ml-auto flex items-center gap-2">
          {pill}
          <button
            type="button"
            onClick={() => (abierto ? cerrar() : setAbierto(true))}
            className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-slate transition hover:bg-accent/60"
          >
            {abierto ? 'Cerrar' : 'Editar ▾'}
          </button>
        </span>
      </div>
      {abierto && (
        <div className="space-y-3 bg-accent/20 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              Nombre
              <input aria-label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              Contrato
              <select
                aria-label="Contrato"
                value={contratoId}
                onChange={(e) => setContratoId(Number(e.target.value))}
                className={inputCls}
              >
                {contratos.map((c) => (
                  <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!puedeGuardar}
              onClick={guardar}
              className="rounded-md bg-brand px-4 py-2 font-medium text-ink transition hover:brightness-95 disabled:opacity-50"
            >
              {editar.isPending ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={cerrar}
              className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate transition hover:bg-accent/60"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- src/features/admin/tarea-edit-row.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Wiring en `admin/tareas/page.tsx`**

Reemplazar el import (línea 6-7) y el bloque de renderizado (líneas 68-79) en
`src/app/(protected)/admin/tareas/page.tsx`.

Import, agregar debajo de `PillActivo`:

```tsx
import { PillActivo } from '@/features/admin/pill-activo';
import { TareaEditRow } from '@/features/admin/tarea-edit-row';
```

Reemplazar el bloque de mapeo:

```tsx
            <div className="overflow-hidden rounded-xl border border-line bg-surface divide-y divide-line">
              {(tareas ?? []).map((t) => (
                <TareaEditRow
                  key={t.id}
                  tarea={t}
                  contratos={contratos ?? []}
                  pill={
                    <PillActivo
                      activo={t.activo}
                      disabled={toggle.isPending}
                      onToggle={() =>
                        toast.promise(toggle.mutateAsync({ id: t.id, activo: !t.activo }), {
                          loading: 'Actualizando…', success: 'Tarea actualizada', error: 'No se pudo actualizar',
                        })
                      }
                    />
                  }
                />
              ))}
              {(tareas ?? []).length === 0 && <div className="px-4 py-2.5 text-sm text-slate">Este contrato no tiene tareas.</div>}
            </div>
```

- [ ] **Step 6: Escribir test de integración de la página**

Crear `src/app/(protected)/admin/tareas/tareas-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const crear = vi.fn().mockResolvedValue({});
const toggle = vi.fn().mockResolvedValue({});
const editar = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/admin', () => ({
  useContratosAdmin: () => ({ data: [{ id: 10, codigo: 'K5', nombre: 'Contrato K5', activo: true, jefeContratoCuil: null, jefeContrato: null }] }),
  useTareasAdmin: () => ({ data: [{ id: 1, nombre: 'Excavación', contratoId: 10, activo: true }], isLoading: false }),
  useCrearTarea: () => ({ mutateAsync: crear, isPending: false }),
  useToggleTarea: () => ({ mutateAsync: toggle, isPending: false }),
  useEditarTarea: () => ({ mutateAsync: editar, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import TareasAdminPage from './page';

describe('TareasAdminPage', () => {
  beforeEach(() => { crear.mockClear(); toggle.mockClear(); editar.mockClear(); });

  it('editar el nombre de una tarea llama al mutate', async () => {
    render(<TareasAdminPage />);
    await userEvent.selectOptions(screen.getByLabelText('Contrato'), '10');
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const nombre = screen.getByLabelText('Nombre');
    await userEvent.clear(nombre);
    await userEvent.type(nombre, 'Montaje');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(editar).toHaveBeenCalledWith({ id: 1, nombre: 'Montaje' }));
  });
});
```

- [ ] **Step 7: Correr todos los tests tocados**

Run: `npm test -- src/features/admin/tarea-edit-row.test.tsx "src/app/(protected)/admin/tareas/tareas-page.test.tsx"`
Expected: PASS (6 tests en total).

- [ ] **Step 8: Lint y build**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 9: Commit**

```bash
git add src/features/admin/tarea-edit-row.tsx src/features/admin/tarea-edit-row.test.tsx \
  "src/app/(protected)/admin/tareas/page.tsx" "src/app/(protected)/admin/tareas/tareas-page.test.tsx"
git commit -m "feat(admin): edición inline de Tareas"
```

---

### Task 7: `MovilEditRow` + wiring en `admin/moviles`

**Files:**
- Create: `src/features/admin/movil-edit-row.tsx`
- Create: `src/features/admin/movil-edit-row.test.tsx`
- Modify: `src/app/(protected)/admin/moviles/page.tsx`
- Modify: `src/app/(protected)/admin/moviles/moviles-page.test.tsx`

**Interfaces:**
- Consumes: `useEditarMovil()` (Task 5), `MovilAdmin { id, identificador, descripcion, activo }` (ya exportado desde `@/lib/api/admin`).
- Produces: `MovilEditRow({ movil: MovilAdmin; pill: ReactNode })`.

- [ ] **Step 1: Escribir el test (falla porque el componente no existe)**

Crear `src/features/admin/movil-edit-row.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MovilAdmin } from '@/lib/api/admin';

const editar = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/admin', () => ({
  useEditarMovil: () => ({ mutateAsync: editar, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }));

import { MovilEditRow } from './movil-edit-row';

const MOVIL: MovilAdmin = { id: 1, identificador: 'INT-101', descripcion: 'Camioneta', activo: true };

function renderRow(movil: MovilAdmin = MOVIL) {
  return render(<MovilEditRow movil={movil} pill={<span>pill</span>} />);
}

describe('MovilEditRow', () => {
  beforeEach(() => { editar.mockClear(); });

  it('precarga identificador y descripción al expandir', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByLabelText('Identificador')).toHaveValue('INT-101');
    expect(screen.getByLabelText('Descripción')).toHaveValue('Camioneta');
  });

  it('editar el identificador y guardar llama al mutate con id e identificador nuevo', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const identificador = screen.getByLabelText('Identificador');
    await userEvent.clear(identificador);
    await userEvent.type(identificador, 'INT-102');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(editar).toHaveBeenCalledWith({ id: 1, identificador: 'INT-102' }));
  });

  it('Guardar deshabilitado sin cambios', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByRole('button', { name: /guardar/i })).toBeDisabled();
  });

  it('Cancelar colapsa la fila sin llamar al mutate', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.type(screen.getByLabelText('Identificador'), 'X');
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByLabelText('Identificador')).not.toBeInTheDocument();
    expect(editar).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- src/features/admin/movil-edit-row.test.tsx`
Expected: FAIL — `Failed to resolve import "./movil-edit-row"`.

- [ ] **Step 3: Implementar `MovilEditRow`**

Crear `src/features/admin/movil-edit-row.tsx`:

```tsx
'use client';

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useEditarMovil, type MovilAdmin } from '@/lib/api/admin';

const inputCls =
  'rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30';

export function MovilEditRow({ movil, pill }: { movil: MovilAdmin; pill: ReactNode }) {
  const editar = useEditarMovil();
  const [abierto, setAbierto] = useState(false);
  const [identificador, setIdentificador] = useState(movil.identificador);
  const [descripcion, setDescripcion] = useState(movil.descripcion ?? '');

  const identificadorValido = identificador.trim().length > 0;
  const huboCambios =
    identificador.trim() !== movil.identificador || descripcion.trim() !== (movil.descripcion ?? '');
  const puedeGuardar = identificadorValido && huboCambios && !editar.isPending;

  function cerrar() {
    setAbierto(false);
    setIdentificador(movil.identificador);
    setDescripcion(movil.descripcion ?? '');
  }

  async function guardar() {
    if (!puedeGuardar) return;
    const payload: { id: number; identificador?: string; descripcion?: string } = { id: movil.id };
    if (identificador.trim() !== movil.identificador) payload.identificador = identificador.trim();
    if (descripcion.trim() !== (movil.descripcion ?? '')) payload.descripcion = descripcion.trim() || undefined;

    const promesa = editar.mutateAsync(payload);
    toast.promise(promesa, {
      loading: 'Guardando…',
      success: 'Móvil actualizado',
      error: 'No se pudo actualizar',
    });
    try {
      await promesa;
      setAbierto(false);
    } catch {
      // toast.promise ya avisó
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
        <span className="font-medium text-ink">{movil.identificador}</span>
        <span className="text-slate">{movil.descripcion ?? ''}</span>
        <span className="ml-auto flex items-center gap-2">
          {pill}
          <button
            type="button"
            onClick={() => (abierto ? cerrar() : setAbierto(true))}
            className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-slate transition hover:bg-accent/60"
          >
            {abierto ? 'Cerrar' : 'Editar ▾'}
          </button>
        </span>
      </div>
      {abierto && (
        <div className="space-y-3 bg-accent/20 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              Identificador
              <input aria-label="Identificador" value={identificador} onChange={(e) => setIdentificador(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              Descripción
              <input aria-label="Descripción" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className={inputCls} />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!puedeGuardar}
              onClick={guardar}
              className="rounded-md bg-brand px-4 py-2 font-medium text-ink transition hover:brightness-95 disabled:opacity-50"
            >
              {editar.isPending ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={cerrar}
              className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate transition hover:bg-accent/60"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- src/features/admin/movil-edit-row.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Wiring en `admin/moviles/page.tsx`**

Modificar `src/app/(protected)/admin/moviles/page.tsx`: agregar el import y
reemplazar el bloque de mapeo (líneas 64-76).

```tsx
import { PillActivo } from '@/features/admin/pill-activo';
import { MovilEditRow } from '@/features/admin/movil-edit-row';
```

```tsx
        <div className="overflow-hidden rounded-xl border border-line bg-surface divide-y divide-line">
          {(data ?? []).map((m) => (
            <MovilEditRow
              key={m.id}
              movil={m}
              pill={<PillActivo activo={m.activo} disabled={toggle.isPending} onToggle={() => cambiarActivo(m.id, !m.activo)} />}
            />
          ))}
          {(data ?? []).length === 0 && <div className="px-4 py-2.5 text-sm text-slate">Sin móviles.</div>}
        </div>
```

- [ ] **Step 6: Actualizar `moviles-page.test.tsx`**

Agregar `useEditarMovil` al mock existente y sumar un test de edición.
Reemplazar el contenido completo de `src/app/(protected)/admin/moviles/moviles-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const crear = vi.fn().mockResolvedValue({});
const toggle = vi.fn().mockResolvedValue({});
const editar = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/admin', () => ({
  useMovilesAdmin: () => ({ data: [{ id: 1, identificador: 'INT-101', descripcion: 'Camioneta', activo: true }], isLoading: false }),
  useCrearMovil: () => ({ mutateAsync: crear, isPending: false }),
  useToggleMovil: () => ({ mutateAsync: toggle, isPending: false }),
  useEditarMovil: () => ({ mutateAsync: editar, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import MovilesAdminPage from './page';

describe('MovilesAdminPage', () => {
  beforeEach(() => { crear.mockClear(); toggle.mockClear(); editar.mockClear(); });

  it('crea un móvil con identificador', async () => {
    render(<MovilesAdminPage />);
    await userEvent.type(screen.getByLabelText('Identificador'), 'AB123CD');
    await userEvent.click(screen.getByRole('button', { name: /agregar/i }));
    await waitFor(() => expect(crear).toHaveBeenCalledWith({ identificador: 'AB123CD', descripcion: undefined }));
  });

  it('el toggle de activo llama la mutación', async () => {
    render(<MovilesAdminPage />);
    await userEvent.click(screen.getByRole('button', { name: /activo/i }));
    await waitFor(() => expect(toggle).toHaveBeenCalledWith({ id: 1, activo: false }));
  });

  it('editar la descripción de un móvil llama al mutate', async () => {
    render(<MovilesAdminPage />);
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const descripcion = screen.getByLabelText('Descripción');
    await userEvent.clear(descripcion);
    await userEvent.type(descripcion, 'Camioneta blanca');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(editar).toHaveBeenCalledWith({ id: 1, descripcion: 'Camioneta blanca' }));
  });
});
```

- [ ] **Step 7: Correr todos los tests tocados**

Run: `npm test -- src/features/admin/movil-edit-row.test.tsx "src/app/(protected)/admin/moviles/moviles-page.test.tsx"`
Expected: PASS (7 tests en total).

- [ ] **Step 8: Lint y build**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 9: Commit**

```bash
git add src/features/admin/movil-edit-row.tsx src/features/admin/movil-edit-row.test.tsx \
  "src/app/(protected)/admin/moviles/page.tsx" "src/app/(protected)/admin/moviles/moviles-page.test.tsx"
git commit -m "feat(admin): edición inline de Móviles"
```

---

### Task 8: `ProvinciaEditRow` + wiring en `admin/provincias`

**Files:**
- Create: `src/features/admin/provincia-edit-row.tsx`
- Create: `src/features/admin/provincia-edit-row.test.tsx`
- Modify: `src/app/(protected)/admin/provincias/page.tsx`

**Interfaces:**
- Consumes: `useEditarProvincia()` (Task 5), `ProvinciaAdmin { id, nombre }` (ya exportado desde `@/lib/api/admin`).
- Produces: `ProvinciaEditRow({ provincia: ProvinciaAdmin })` — root `<li>` (reemplaza el `<li>` plano actual dentro del `<ul>` de la página).

- [ ] **Step 1: Escribir el test (falla porque el componente no existe)**

Crear `src/features/admin/provincia-edit-row.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProvinciaAdmin } from '@/lib/api/admin';

const editar = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/admin', () => ({
  useEditarProvincia: () => ({ mutateAsync: editar, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }));

import { ProvinciaEditRow } from './provincia-edit-row';

const PROVINCIA: ProvinciaAdmin = { id: 1, nombre: 'Córdoba' };

function renderRow(provincia: ProvinciaAdmin = PROVINCIA) {
  return render(<ul><ProvinciaEditRow provincia={provincia} /></ul>);
}

describe('ProvinciaEditRow', () => {
  beforeEach(() => { editar.mockClear(); });

  it('precarga el nombre al expandir', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByLabelText('Nombre')).toHaveValue('Córdoba');
  });

  it('editar el nombre y guardar llama al mutate con id y nombre nuevo', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const nombre = screen.getByLabelText('Nombre');
    await userEvent.clear(nombre);
    await userEvent.type(nombre, 'Córdoba Capital');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(editar).toHaveBeenCalledWith({ id: 1, nombre: 'Córdoba Capital' }));
  });

  it('Guardar deshabilitado sin cambios', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByRole('button', { name: /guardar/i })).toBeDisabled();
  });

  it('Cancelar colapsa la fila sin llamar al mutate', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.type(screen.getByLabelText('Nombre'), ' extra');
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument();
    expect(editar).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- src/features/admin/provincia-edit-row.test.tsx`
Expected: FAIL — `Failed to resolve import "./provincia-edit-row"`.

- [ ] **Step 3: Implementar `ProvinciaEditRow`**

Crear `src/features/admin/provincia-edit-row.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useEditarProvincia, type ProvinciaAdmin } from '@/lib/api/admin';

const inputCls =
  'rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30';

export function ProvinciaEditRow({ provincia }: { provincia: ProvinciaAdmin }) {
  const editar = useEditarProvincia();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState(provincia.nombre);

  const nombreValido = nombre.trim().length > 0;
  const huboCambios = nombre.trim() !== provincia.nombre;
  const puedeGuardar = nombreValido && huboCambios && !editar.isPending;

  function cerrar() {
    setAbierto(false);
    setNombre(provincia.nombre);
  }

  async function guardar() {
    if (!puedeGuardar) return;
    const promesa = editar.mutateAsync({ id: provincia.id, nombre: nombre.trim() });
    toast.promise(promesa, {
      loading: 'Guardando…',
      success: 'Provincia actualizada',
      error: 'No se pudo actualizar',
    });
    try {
      await promesa;
      setAbierto(false);
    } catch {
      // toast.promise ya avisó
    }
  }

  return (
    <li className="text-sm text-ink">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span>{provincia.nombre}</span>
        <button
          type="button"
          onClick={() => (abierto ? cerrar() : setAbierto(true))}
          className="ml-auto rounded-md border border-line px-3 py-1.5 text-sm font-medium text-slate transition hover:bg-accent/60"
        >
          {abierto ? 'Cerrar' : 'Editar ▾'}
        </button>
      </div>
      {abierto && (
        <div className="space-y-3 bg-accent/20 px-4 py-4">
          <label className="flex max-w-xs flex-col gap-1 text-sm font-medium text-ink">
            Nombre
            <input aria-label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!puedeGuardar}
              onClick={guardar}
              className="rounded-md bg-brand px-4 py-2 font-medium text-ink transition hover:brightness-95 disabled:opacity-50"
            >
              {editar.isPending ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={cerrar}
              className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate transition hover:bg-accent/60"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- src/features/admin/provincia-edit-row.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Wiring en `admin/provincias/page.tsx`**

Reemplazar el contenido completo de `src/app/(protected)/admin/provincias/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { ProvinciaEditRow } from '@/features/admin/provincia-edit-row';
import { useProvinciasAdmin, useCrearProvincia } from '@/lib/api/admin';

export default function ProvinciasAdminPage() {
  const { data, isLoading } = useProvinciasAdmin();
  const crear = useCrearProvincia();
  const [nombre, setNombre] = useState('');

  function agregar() {
    if (!nombre.trim()) return;
    toast.promise(crear.mutateAsync({ nombre: nombre.trim() }), {
      loading: 'Guardando…',
      success: 'Provincia creada',
      error: 'No se pudo crear',
    });
    setNombre('');
  }

  return (
    <section className="space-y-5">
      <PageHeader eyebrow="Admin" title="Provincias" />
      <div className="flex gap-2">
        <input
          aria-label="Nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nueva provincia"
          className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <button
          type="button"
          disabled={crear.isPending}
          onClick={agregar}
          className="rounded-md bg-brand px-4 py-2 font-medium text-ink transition hover:brightness-95 disabled:opacity-50"
        >
          Agregar
        </button>
      </div>
      {isLoading ? (
        <p className="text-slate">Cargando…</p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-line bg-surface divide-y divide-line">
          {(data ?? []).map((p) => (
            <ProvinciaEditRow key={p.id} provincia={p} />
          ))}
          {(data ?? []).length === 0 && <li className="px-4 py-2.5 text-sm text-slate">Sin provincias.</li>}
        </ul>
      )}
    </section>
  );
}
```

Nota: hay que usar `aria-label="Nombre"` tanto en el input de "Nueva provincia"
de la página como en el input de `ProvinciaEditRow`. Como no coexisten
visibles al mismo tiempo en los tests de este componente (el test de
`ProvinciaEditRow` no renderiza la página completa), no hay colisión de
`getByLabelText`. El test de integración de la página (Step 6) usa
`getAllByLabelText('Nombre')` para desambiguar cuando ambos están en pantalla.

- [ ] **Step 6: Escribir test de integración de la página**

Crear `src/app/(protected)/admin/provincias/provincias-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const crear = vi.fn().mockResolvedValue({});
const editar = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/admin', () => ({
  useProvinciasAdmin: () => ({ data: [{ id: 1, nombre: 'Córdoba' }], isLoading: false }),
  useCrearProvincia: () => ({ mutateAsync: crear, isPending: false }),
  useEditarProvincia: () => ({ mutateAsync: editar, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import ProvinciasAdminPage from './page';

describe('ProvinciasAdminPage', () => {
  beforeEach(() => { crear.mockClear(); editar.mockClear(); });

  it('editar el nombre de una provincia llama al mutate', async () => {
    render(<ProvinciasAdminPage />);
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const nombres = screen.getAllByLabelText('Nombre');
    const nombreEdit = nombres[nombres.length - 1];
    await userEvent.clear(nombreEdit);
    await userEvent.type(nombreEdit, 'Córdoba Capital');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(editar).toHaveBeenCalledWith({ id: 1, nombre: 'Córdoba Capital' }));
  });
});
```

- [ ] **Step 7: Correr todos los tests tocados**

Run: `npm test -- src/features/admin/provincia-edit-row.test.tsx "src/app/(protected)/admin/provincias/provincias-page.test.tsx"`
Expected: PASS (5 tests en total).

- [ ] **Step 8: Lint y build**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 9: Commit**

```bash
git add src/features/admin/provincia-edit-row.tsx src/features/admin/provincia-edit-row.test.tsx \
  "src/app/(protected)/admin/provincias/page.tsx" "src/app/(protected)/admin/provincias/provincias-page.test.tsx"
git commit -m "feat(admin): edición inline de Provincias"
```

---

### Task 9: `TipoNovedadEditRow` + wiring en `admin/tipos-novedad`

**Files:**
- Create: `src/features/admin/tipo-novedad-edit-row.tsx`
- Create: `src/features/admin/tipo-novedad-edit-row.test.tsx`
- Modify: `src/app/(protected)/admin/tipos-novedad/page.tsx`

**Interfaces:**
- Consumes: `useEditarTipoNovedad()` (Task 5), `TipoNovedadAdmin { id, nombre, requiereAprobacionHys, generaPlus, activo }` (ya exportado desde `@/lib/api/admin`).
- Produces: `TipoNovedadEditRow({ tipo: TipoNovedadAdmin; pill: ReactNode })`.

- [ ] **Step 1: Escribir el test (falla porque el componente no existe)**

Crear `src/features/admin/tipo-novedad-edit-row.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TipoNovedadAdmin } from '@/lib/api/admin';

const editar = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/admin', () => ({
  useEditarTipoNovedad: () => ({ mutateAsync: editar, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }));

import { TipoNovedadEditRow } from './tipo-novedad-edit-row';

const TIPO: TipoNovedadAdmin = { id: 1, nombre: 'Ausencia', requiereAprobacionHys: true, generaPlus: false, activo: true };

function renderRow(tipo: TipoNovedadAdmin = TIPO) {
  return render(<TipoNovedadEditRow tipo={tipo} pill={<span>pill</span>} />);
}

describe('TipoNovedadEditRow', () => {
  beforeEach(() => { editar.mockClear(); });

  it('precarga nombre y checkboxes al expandir', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByLabelText('Nombre')).toHaveValue('Ausencia');
    expect(screen.getByLabelText(/requiere aprobación de hys/i)).toBeChecked();
    expect(screen.getByLabelText(/genera plus/i)).not.toBeChecked();
  });

  it('cambiar "genera plus" y guardar llama al mutate solo con ese campo', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.click(screen.getByLabelText(/genera plus/i));
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(editar).toHaveBeenCalledWith({ id: 1, generaPlus: true }));
  });

  it('Guardar deshabilitado sin cambios', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByRole('button', { name: /guardar/i })).toBeDisabled();
  });

  it('Cancelar colapsa la fila sin llamar al mutate', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.click(screen.getByLabelText(/genera plus/i));
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument();
    expect(editar).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- src/features/admin/tipo-novedad-edit-row.test.tsx`
Expected: FAIL — `Failed to resolve import "./tipo-novedad-edit-row"`.

- [ ] **Step 3: Implementar `TipoNovedadEditRow`**

Crear `src/features/admin/tipo-novedad-edit-row.tsx`:

```tsx
'use client';

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useEditarTipoNovedad, type TipoNovedadAdmin } from '@/lib/api/admin';

const inputCls =
  'rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30';

export function TipoNovedadEditRow({ tipo, pill }: { tipo: TipoNovedadAdmin; pill: ReactNode }) {
  const editar = useEditarTipoNovedad();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState(tipo.nombre);
  const [requiereHys, setRequiereHys] = useState(tipo.requiereAprobacionHys);
  const [generaPlus, setGeneraPlus] = useState(tipo.generaPlus);

  const nombreValido = nombre.trim().length > 0;
  const huboCambios =
    nombre.trim() !== tipo.nombre ||
    requiereHys !== tipo.requiereAprobacionHys ||
    generaPlus !== tipo.generaPlus;
  const puedeGuardar = nombreValido && huboCambios && !editar.isPending;

  function cerrar() {
    setAbierto(false);
    setNombre(tipo.nombre);
    setRequiereHys(tipo.requiereAprobacionHys);
    setGeneraPlus(tipo.generaPlus);
  }

  async function guardar() {
    if (!puedeGuardar) return;
    const payload: { id: number; nombre?: string; requiereAprobacionHys?: boolean; generaPlus?: boolean } = { id: tipo.id };
    if (nombre.trim() !== tipo.nombre) payload.nombre = nombre.trim();
    if (requiereHys !== tipo.requiereAprobacionHys) payload.requiereAprobacionHys = requiereHys;
    if (generaPlus !== tipo.generaPlus) payload.generaPlus = generaPlus;

    const promesa = editar.mutateAsync(payload);
    toast.promise(promesa, {
      loading: 'Guardando…',
      success: 'Tipo actualizado',
      error: 'No se pudo actualizar',
    });
    try {
      await promesa;
      setAbierto(false);
    } catch {
      // toast.promise ya avisó
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
        <span className="font-medium text-ink">{tipo.nombre}</span>
        {tipo.requiereAprobacionHys && <span className="rounded bg-accent px-1.5 py-0.5 text-xs text-brand-deep">HyS</span>}
        {tipo.generaPlus && <span className="rounded bg-accent px-1.5 py-0.5 text-xs text-brand-deep">plus</span>}
        <span className="ml-auto flex items-center gap-2">
          {pill}
          <button
            type="button"
            onClick={() => (abierto ? cerrar() : setAbierto(true))}
            className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-slate transition hover:bg-accent/60"
          >
            {abierto ? 'Cerrar' : 'Editar ▾'}
          </button>
        </span>
      </div>
      {abierto && (
        <div className="space-y-3 bg-accent/20 px-4 py-4">
          <label className="flex max-w-xs flex-col gap-1 text-sm font-medium text-ink">
            Nombre
            <input aria-label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputCls} />
          </label>
          <div className="flex flex-wrap gap-4 text-sm text-ink">
            <label className="flex items-center gap-2">
              <input
                aria-label="Requiere aprobación de HyS"
                type="checkbox"
                checked={requiereHys}
                onChange={(e) => setRequiereHys(e.target.checked)}
              />
              Requiere aprobación de HyS
            </label>
            <label className="flex items-center gap-2">
              <input
                aria-label="Genera plus"
                type="checkbox"
                checked={generaPlus}
                onChange={(e) => setGeneraPlus(e.target.checked)}
              />
              Genera plus
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!puedeGuardar}
              onClick={guardar}
              className="rounded-md bg-brand px-4 py-2 font-medium text-ink transition hover:brightness-95 disabled:opacity-50"
            >
              {editar.isPending ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              type="button"
              onClick={cerrar}
              className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate transition hover:bg-accent/60"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- src/features/admin/tipo-novedad-edit-row.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Wiring en `admin/tipos-novedad/page.tsx`**

Modificar `src/app/(protected)/admin/tipos-novedad/page.tsx`: agregar el
import y reemplazar el bloque de mapeo (líneas 61-77).

```tsx
import { PillActivo } from '@/features/admin/pill-activo';
import { TipoNovedadEditRow } from '@/features/admin/tipo-novedad-edit-row';
```

```tsx
        <div className="overflow-hidden rounded-xl border border-line bg-surface divide-y divide-line">
          {(data ?? []).map((t) => (
            <TipoNovedadEditRow
              key={t.id}
              tipo={t}
              pill={
                <PillActivo
                  activo={t.activo}
                  disabled={toggle.isPending}
                  onToggle={() =>
                    toast.promise(toggle.mutateAsync({ id: t.id, activo: !t.activo }), {
                      loading: 'Actualizando…', success: 'Tipo actualizado', error: 'No se pudo actualizar',
                    })
                  }
                />
              }
            />
          ))}
          {(data ?? []).length === 0 && <div className="px-4 py-2.5 text-sm text-slate">Sin tipos de novedad.</div>}
        </div>
```

- [ ] **Step 6: Escribir test de integración de la página**

Crear `src/app/(protected)/admin/tipos-novedad/tipos-novedad-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const crear = vi.fn().mockResolvedValue({});
const toggle = vi.fn().mockResolvedValue({});
const editar = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/admin', () => ({
  useTiposNovedadAdmin: () => ({ data: [{ id: 1, nombre: 'Ausencia', requiereAprobacionHys: true, generaPlus: false, activo: true }], isLoading: false }),
  useCrearTipoNovedad: () => ({ mutateAsync: crear, isPending: false }),
  useToggleTipoNovedad: () => ({ mutateAsync: toggle, isPending: false }),
  useEditarTipoNovedad: () => ({ mutateAsync: editar, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import TiposNovedadAdminPage from './page';

describe('TiposNovedadAdminPage', () => {
  beforeEach(() => { crear.mockClear(); toggle.mockClear(); editar.mockClear(); });

  it('editar el nombre de un tipo de novedad llama al mutate', async () => {
    render(<TiposNovedadAdminPage />);
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const nombre = screen.getByLabelText('Nombre');
    await userEvent.clear(nombre);
    await userEvent.type(nombre, 'Ausencia justificada');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(editar).toHaveBeenCalledWith({ id: 1, nombre: 'Ausencia justificada' }));
  });
});
```

- [ ] **Step 7: Correr todos los tests tocados**

Run: `npm test -- src/features/admin/tipo-novedad-edit-row.test.tsx "src/app/(protected)/admin/tipos-novedad/tipos-novedad-page.test.tsx"`
Expected: PASS (5 tests en total).

- [ ] **Step 8: Lint y build**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 9: Commit**

```bash
git add src/features/admin/tipo-novedad-edit-row.tsx src/features/admin/tipo-novedad-edit-row.test.tsx \
  "src/app/(protected)/admin/tipos-novedad/page.tsx" "src/app/(protected)/admin/tipos-novedad/tipos-novedad-page.test.tsx"
git commit -m "feat(admin): edición inline de Tipos de novedad"
```

---

### Task 10: Verificación final

**Files:** ninguno (solo comandos).

- [ ] **Step 1: Suite completa de frontend**

Run: `npm test`
Expected: todos los tests pasan (los existentes + los ~20 nuevos de esta feature).

- [ ] **Step 2: Lint y build de frontend**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 3: Build de backend**

Desde `Forms_Horas_ST_back`:

Run: `npm run build`
Expected: termina sin errores.

- [ ] **Step 4: Checklist de verificación manual E2E (a cargo del usuario)**

Con el backend (`npm run start:dev`, puerto 3001) y el frontend
(`npm run dev`, puerto 3000) corriendo, y logueado como Admin
(`rcarrazana@serytec.com`) en `/admin`:

- [ ] `/admin/tareas`: elegir un contrato, click "Editar" en una tarea, cambiar nombre y/o contrato, Guardar, confirmar que la fila se actualiza.
- [ ] `/admin/moviles`: click "Editar" en un móvil, cambiar identificador/descripción, Guardar, confirmar.
- [ ] `/admin/provincias`: click "Editar" en una provincia, cambiar nombre, Guardar, confirmar.
- [ ] `/admin/tipos-novedad`: click "Editar" en un tipo, cambiar nombre y/o los checkboxes, Guardar, confirmar.
- [ ] En cada caso: Cancelar descarta los cambios sin llamar al backend; Guardar queda deshabilitado si no hay cambios.

- [ ] **Step 5: Actualizar el contexto del proyecto**

Agregar una entrada nueva en
`docs/superpowers/Contexto/contexto-proyecto.md` — o `.claude/Contexto/contexto-proyecto.md`,
confirmar la ruta real del archivo antes de editar — con fecha 2026-07-14
resumiendo: CRUD de maestros completado (Tareas/Móviles/Tipos de
novedad/Provincias ganan edición completa vía PATCH), y que Provincia sigue
sin campo `activo` (decisión explícita).

- [ ] **Step 6: Commit final (si Step 5 generó cambios)**

```bash
git add .claude/Contexto/contexto-proyecto.md
git commit -m "docs: contexto — CRUD de maestros admin completado"
```
