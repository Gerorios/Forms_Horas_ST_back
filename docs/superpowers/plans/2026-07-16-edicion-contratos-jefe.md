# Edición de Contratos (nombre + Jefe de Contrato) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir editar el nombre y asignar/desasignar el Jefe de Contrato de un contrato desde `/admin/contratos`, cerrando el gap que causaba que `/aprobaciones` no mostrara nada a ningún JefeContrato.

**Architecture:** Backend NestJS — ampliar `UpdateContratoDto.jefeContratoCuil` para aceptar `string | null` explícito (el servicio y el endpoint ya soportan editar este campo, no cambian). Frontend Next.js — nuevo componente `ContratoEditRow` (fila expandible inline, mismo patrón que `TareaEditRow`/`MovilEditRow`) con un input de nombre y un `<select>` de Jefe de Contrato poblado filtrando `useUsuariosAdmin()` client-side por `rol.nombre === 'JefeContrato'`.

**Tech Stack:** NestJS 11, Prisma 7, class-validator — backend. Next.js (App Router), TanStack Query, Vitest + Testing Library — frontend.

## Global Constraints

- Repos: backend en `Forms_Horas_ST_back` (este working directory), frontend en `Forms_Horas_ST_Frontend` (`../Frontend`). Ambos ya en la rama `feature/contratos-jefe`, creada desde `main` (con el CRUD de maestros ya mergeado).
- `jefeContratoCuil: null` significa **desasignar** el jefe — debe llegar como `null` explícito en el payload del PATCH, no como `undefined` (que el backend interpreta como "no tocar este campo").
- No hay endpoint dedicado `GET /admin/usuarios?rol=X` — el selector de jefes se arma filtrando client-side los datos que ya trae `useUsuariosAdmin()`, mismo criterio que usa `UsuarioEditRow` para su selector de rol.
- No hay restricción nueva de negocio (ej. "un jefe no puede repetirse en dos contratos") — no se agrega ninguna validación que no esté pedida.
- Backend sin infraestructura de tests automatizada (no hay `*.spec.ts` en `src/`) — verificación de la tarea backend es `npm run build` + curl manual documentado.
- Frontend con Vitest + Testing Library — TDD para las tareas de frontend.
- Spec completa: `docs/superpowers/specs/2026-07-16-edicion-contratos-jefe-design.md`.

---

## Backend (`Forms_Horas_ST_back`)

### Task 1: `UpdateContratoDto.jefeContratoCuil` acepta `null`

**Files:**
- Modify: `src/admin/dto/contrato.dto.ts`

**Interfaces:**
- Produces: `UpdateContratoDto { nombre?: string; jefeContratoCuil?: string | null; activo?: boolean }`.

- [ ] **Step 1: Ampliar el tipo del campo**

En `src/admin/dto/contrato.dto.ts`, dentro de `UpdateContratoDto`, cambiar:

```ts
  @IsOptional()
  @IsString()
  jefeContratoCuil?: string;
```

por:

```ts
  @IsOptional()
  @IsString()
  jefeContratoCuil?: string | null;
```

No hace falta tocar los decoradores: `@IsOptional()` en `class-validator` salta la validación del
resto de los decoradores (`@IsString()` incluido) cuando el valor es `null` o `undefined` — solo
se amplía el tipo de TypeScript para que el compilador acepte enviar `null` explícito desde el
controller/servicio.

- [ ] **Step 2: Verificar que compila**

Run: `npm run build`
Expected: termina sin errores.

- [ ] **Step 3: Verificación manual E2E (curl)**

El usuario, con un token Admin real, corre:

```bash
curl -X PATCH http://localhost:3001/admin/contratos/<id> \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"jefeContratoCuil": null}'
```

Expected: 200 con `jefeContratoCuil: null` en la fila devuelta; `GET /registros-horas/por-aprobar`
con ese jefe deja de mostrar los registros de ese contrato.

- [ ] **Step 4: Commit**

```bash
git add src/admin/dto/contrato.dto.ts
git commit -m "feat(admin): UpdateContratoDto acepta jefeContratoCuil: null (desasignar jefe)"
```

---

## Frontend (`Forms_Horas_ST_Frontend`)

> Todos los comandos de esta sección corren desde el repo frontend (`../Frontend` relativo a `Forms_Horas_ST_back`).

### Task 2: `useEditarContrato` acepta `jefeContratoCuil: string | null`

**Files:**
- Modify: `src/lib/api/admin.ts`

**Interfaces:**
- Consumes: `PATCH /admin/contratos/:id` ahora acepta `jefeContratoCuil: null` (Task 1).
- Produces: `useEditarContrato()` con `mutationFn: ({ id, ...dto }: { id: number; nombre?: string; jefeContratoCuil?: string | null; activo?: boolean }) => Promise<...>` — Task 3 depende de este tipo ampliado para poder enviar `null`.

- [ ] **Step 1: Ampliar el tipo del payload**

En `src/lib/api/admin.ts`, dentro de `useEditarContrato`, cambiar:

```ts
export function useEditarContrato() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: { id: number; nombre?: string; jefeContratoCuil?: string; activo?: boolean }) =>
      api.patch(`/admin/contratos/${id}`, dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'contratos'] }),
  });
}
```

por:

```ts
export function useEditarContrato() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: { id: number; nombre?: string; jefeContratoCuil?: string | null; activo?: boolean }) =>
      api.patch(`/admin/contratos/${id}`, dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'contratos'] }),
  });
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build`
Expected: termina sin errores de tipos.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/admin.ts
git commit -m "feat(admin): useEditarContrato acepta jefeContratoCuil: null"
```

---

### Task 3: Componente `ContratoEditRow`

**Files:**
- Create: `src/features/admin/contrato-edit-row.tsx`
- Create: `src/features/admin/contrato-edit-row.test.tsx`

**Interfaces:**
- Consumes: `useEditarContrato()` (Task 2), `ContratoAdmin { id, codigo, nombre, activo, jefeContratoCuil, jefeContrato: { cuil, email } | null }` y `UsuarioAdmin { cuil, email, activo, rolId, rol: { nombre }, empleado: { apellido_nombre }, contratosHabilitados }` (ambos ya exportados desde `@/lib/api/admin`).
- Produces: `ContratoEditRow({ contrato: ContratoAdmin; jefes: UsuarioAdmin[]; pill: ReactNode })` — componente de fila expandible. `jefes` ya viene filtrado por el llamador (Task 4) a solo usuarios con `rol.nombre === 'JefeContrato'`; este componente no filtra, solo renderiza la lista que recibe.

- [ ] **Step 1: Escribir el test (falla porque el componente no existe)**

Crear `src/features/admin/contrato-edit-row.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ContratoAdmin, UsuarioAdmin } from '@/lib/api/admin';

const editar = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/admin', () => ({
  useEditarContrato: () => ({ mutateAsync: editar, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }));

import { ContratoEditRow } from './contrato-edit-row';

const CONTRATO: ContratoAdmin = {
  id: 1, codigo: 'K5', nombre: 'Contrato K5', activo: true,
  jefeContratoCuil: null, jefeContrato: null,
};

const JEFES: UsuarioAdmin[] = [
  {
    cuil: '20111111111', email: 'jefe1@serytec.com', activo: true, rolId: 3,
    rol: { nombre: 'JefeContrato' }, empleado: { apellido_nombre: 'PEREZ JUAN' },
    contratosHabilitados: [],
  },
  {
    cuil: '20222222222', email: 'jefe2@serytec.com', activo: true, rolId: 3,
    rol: { nombre: 'JefeContrato' }, empleado: { apellido_nombre: 'GOMEZ ANA' },
    contratosHabilitados: [],
  },
];

function renderRow(contrato: ContratoAdmin = CONTRATO) {
  return render(<ContratoEditRow contrato={contrato} jefes={JEFES} pill={<span>pill</span>} />);
}

describe('ContratoEditRow', () => {
  beforeEach(() => { editar.mockClear(); });

  it('precarga nombre y "Sin jefe asignado" cuando no tiene jefe', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByLabelText('Nombre')).toHaveValue('Contrato K5');
    expect(screen.getByLabelText('Jefe de Contrato')).toHaveValue('');
  });

  it('precarga el jefe actual cuando ya tiene uno asignado', async () => {
    const conJefe: ContratoAdmin = {
      ...CONTRATO,
      jefeContratoCuil: '20111111111',
      jefeContrato: { cuil: '20111111111', email: 'jefe1@serytec.com' },
    };
    renderRow(conJefe);
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByLabelText('Jefe de Contrato')).toHaveValue('20111111111');
  });

  it('editar el nombre y guardar llama al mutate con id y nombre nuevo', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const nombre = screen.getByLabelText('Nombre');
    await userEvent.clear(nombre);
    await userEvent.type(nombre, 'K5 renombrado');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(editar).toHaveBeenCalledWith({ id: 1, nombre: 'K5 renombrado' }));
  });

  it('asignar un jefe y guardar llama al mutate con jefeContratoCuil', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.selectOptions(screen.getByLabelText('Jefe de Contrato'), '20222222222');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(editar).toHaveBeenCalledWith({ id: 1, jefeContratoCuil: '20222222222' }));
  });

  it('desasignar el jefe (volver a "Sin jefe asignado") envía jefeContratoCuil: null', async () => {
    const conJefe: ContratoAdmin = {
      ...CONTRATO,
      jefeContratoCuil: '20111111111',
      jefeContrato: { cuil: '20111111111', email: 'jefe1@serytec.com' },
    };
    renderRow(conJefe);
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.selectOptions(screen.getByLabelText('Jefe de Contrato'), '');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(editar).toHaveBeenCalledWith({ id: 1, jefeContratoCuil: null }));
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

Run: `npm test -- src/features/admin/contrato-edit-row.test.tsx`
Expected: FAIL — `Failed to resolve import "./contrato-edit-row"`.

- [ ] **Step 3: Implementar `ContratoEditRow`**

Crear `src/features/admin/contrato-edit-row.tsx`:

```tsx
'use client';

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useEditarContrato, type ContratoAdmin, type UsuarioAdmin } from '@/lib/api/admin';

const inputCls =
  'rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30';

export function ContratoEditRow({
  contrato,
  jefes,
  pill,
}: {
  contrato: ContratoAdmin;
  jefes: UsuarioAdmin[];
  pill: ReactNode;
}) {
  const editar = useEditarContrato();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState(contrato.nombre);
  const [jefeCuil, setJefeCuil] = useState(contrato.jefeContratoCuil ?? '');

  const nombreValido = nombre.trim().length > 0;
  const huboCambios =
    nombre.trim() !== contrato.nombre || jefeCuil !== (contrato.jefeContratoCuil ?? '');
  const puedeGuardar = nombreValido && huboCambios && !editar.isPending;

  function cerrar() {
    setAbierto(false);
    setNombre(contrato.nombre);
    setJefeCuil(contrato.jefeContratoCuil ?? '');
  }

  async function guardar() {
    if (!puedeGuardar) return;
    const payload: { id: number; nombre?: string; jefeContratoCuil?: string | null } = { id: contrato.id };
    if (nombre.trim() !== contrato.nombre) payload.nombre = nombre.trim();
    if (jefeCuil !== (contrato.jefeContratoCuil ?? '')) {
      payload.jefeContratoCuil = jefeCuil === '' ? null : jefeCuil;
    }

    const promesa = editar.mutateAsync(payload);
    toast.promise(promesa, {
      loading: 'Guardando…',
      success: 'Contrato actualizado',
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
        <span className="font-medium text-ink">{contrato.codigo}</span>
        <span className="text-slate">{contrato.nombre}</span>
        {contrato.jefeContrato && (
          <span className="text-xs text-slate">jefe: {contrato.jefeContrato.email}</span>
        )}
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
              Jefe de Contrato
              <select
                aria-label="Jefe de Contrato"
                value={jefeCuil}
                onChange={(e) => setJefeCuil(e.target.value)}
                className={inputCls}
              >
                <option value="">Sin jefe asignado</option>
                {jefes.map((j) => (
                  <option key={j.cuil} value={j.cuil}>{j.empleado.apellido_nombre} — {j.email}</option>
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

Run: `npm test -- src/features/admin/contrato-edit-row.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint y build**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/features/admin/contrato-edit-row.tsx src/features/admin/contrato-edit-row.test.tsx
git commit -m "feat(admin): componente ContratoEditRow (nombre + Jefe de Contrato)"
```

---

### Task 4: Wiring en `admin/contratos/page.tsx`

**Files:**
- Modify: `src/app/(protected)/admin/contratos/page.tsx`
- Create: `src/app/(protected)/admin/contratos/contratos-page.test.tsx`

**Interfaces:**
- Consumes: `ContratoEditRow` (Task 3), `useUsuariosAdmin()` (ya existente en `@/lib/api/admin`).

- [ ] **Step 1: Escribir el test de integración (falla porque el wiring no existe)**

Crear `src/app/(protected)/admin/contratos/contratos-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const crear = vi.fn().mockResolvedValue({});
const editar = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/admin', () => ({
  useContratosAdmin: () => ({
    data: [{ id: 1, codigo: 'K5', nombre: 'Contrato K5', activo: true, jefeContratoCuil: null, jefeContrato: null }],
    isLoading: false,
  }),
  useUsuariosAdmin: () => ({
    data: [
      {
        cuil: '20111111111', email: 'jefe1@serytec.com', activo: true, rolId: 3,
        rol: { nombre: 'JefeContrato' }, empleado: { apellido_nombre: 'PEREZ JUAN' },
        contratosHabilitados: [],
      },
      {
        cuil: '20999999999', email: 'operario@st.local', activo: true, rolId: 1,
        rol: { nombre: 'Operario' }, empleado: { apellido_nombre: 'OTRO OPERARIO' },
        contratosHabilitados: [],
      },
    ],
  }),
  useCrearContrato: () => ({ mutateAsync: crear, isPending: false }),
  useEditarContrato: () => ({ mutateAsync: editar, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }));

import ContratosAdminPage from './page';

describe('ContratosAdminPage', () => {
  beforeEach(() => { crear.mockClear(); editar.mockClear(); });

  it('el selector de Jefe de Contrato solo lista usuarios con rol JefeContrato', async () => {
    render(<ContratosAdminPage />);
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByRole('option', { name: /PEREZ JUAN/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /OTRO OPERARIO/ })).not.toBeInTheDocument();
  });

  it('asignar un jefe desde la página llama al mutate con el cuil correcto', async () => {
    render(<ContratosAdminPage />);
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.selectOptions(screen.getByLabelText('Jefe de Contrato'), '20111111111');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(editar).toHaveBeenCalledWith({ id: 1, jefeContratoCuil: '20111111111' }));
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- "src/app/(protected)/admin/contratos/contratos-page.test.tsx"`
Expected: FAIL — la página todavía no renderiza un `<select>` con `aria-label="Jefe de Contrato"`.

- [ ] **Step 3: Wiring en la página**

Reemplazar el contenido completo de `src/app/(protected)/admin/contratos/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { ContratoEditRow } from '@/features/admin/contrato-edit-row';
import { PillActivo } from '@/features/admin/pill-activo';
import { useContratosAdmin, useCrearContrato, useEditarContrato, useUsuariosAdmin } from '@/lib/api/admin';

export default function ContratosAdminPage() {
  const { data, isLoading } = useContratosAdmin();
  const { data: usuarios } = useUsuariosAdmin();
  const crear = useCrearContrato();
  const editar = useEditarContrato();
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');

  const jefes = (usuarios ?? []).filter((u) => u.rol.nombre === 'JefeContrato');

  function agregar() {
    if (!codigo.trim() || !nombre.trim()) return;
    toast.promise(crear.mutateAsync({ codigo: codigo.trim(), nombre: nombre.trim() }), {
      loading: 'Guardando…',
      success: 'Contrato creado',
      error: 'No se pudo crear',
    });
    setCodigo('');
    setNombre('');
  }

  function cambiarActivo(id: number, activo: boolean) {
    toast.promise(editar.mutateAsync({ id, activo }), {
      loading: 'Actualizando…',
      success: 'Contrato actualizado',
      error: 'No se pudo actualizar',
    });
  }

  return (
    <section className="space-y-5">
      <PageHeader eyebrow="Admin" title="Contratos" />
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Código"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="Código (ej. K5)"
          className="w-32 rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <input
          aria-label="Nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre del contrato"
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
        <div className="overflow-hidden rounded-xl border border-line bg-surface divide-y divide-line">
          {(data ?? []).map((c) => (
            <ContratoEditRow
              key={c.id}
              contrato={c}
              jefes={jefes}
              pill={
                <PillActivo
                  activo={c.activo}
                  disabled={editar.isPending}
                  onToggle={() => cambiarActivo(c.id, !c.activo)}
                />
              }
            />
          ))}
          {(data ?? []).length === 0 && <div className="px-4 py-2.5 text-sm text-slate">Sin contratos.</div>}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- "src/app/(protected)/admin/contratos/contratos-page.test.tsx"`
Expected: PASS (2 tests).

- [ ] **Step 5: Correr también el test de `ContratoEditRow` (no debe haber roto nada)**

Run: `npm test -- src/features/admin/contrato-edit-row.test.tsx "src/app/(protected)/admin/contratos/contratos-page.test.tsx"`
Expected: PASS (9 tests en total).

- [ ] **Step 6: Lint y build**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(protected)/admin/contratos/page.tsx" "src/app/(protected)/admin/contratos/contratos-page.test.tsx"
git commit -m "feat(admin): cablear ContratoEditRow en /admin/contratos"
```

---

### Task 5: Verificación final

**Files:** ninguno (solo comandos) + actualización de contexto.

- [ ] **Step 1: Suite completa de frontend**

Run: `npm test`
Expected: todos los tests pasan (los existentes + los 9 nuevos de esta feature).

- [ ] **Step 2: Lint y build de frontend**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 3: Build de backend**

Desde `Forms_Horas_ST_back`:

Run: `npm run build`
Expected: termina sin errores.

- [ ] **Step 4: Checklist de verificación manual E2E (a cargo del usuario)**

Con el backend (`npm run start:dev`, puerto 3001) y el frontend (`npm run dev`, puerto 3000)
corriendo, y logueado como Admin en `/admin/contratos`:

- [ ] Click en "Editar ▾" de un contrato → el `<select>` "Jefe de Contrato" solo lista usuarios
      con rol JefeContrato.
- [ ] Asignar un jefe, Guardar → el contrato queda con ese jefe (se ve "jefe: {email}" en la fila
      colapsada).
- [ ] Loguearse como ese JefeContrato y confirmar que los registros pendientes de ese contrato
      ahora aparecen en `/aprobaciones`.
- [ ] Volver a "Sin jefe asignado" y Guardar → el contrato queda sin jefe; ese usuario deja de ver
      esos registros en `/aprobaciones`.
- [ ] Editar solo el nombre (sin tocar el jefe) → se guarda correctamente.
- [ ] Cancelar no persiste ningún cambio.

- [ ] **Step 5: Actualizar el contexto del proyecto**

Agregar una entrada nueva en `.claude/Contexto/contexto-proyecto.md` (verificar la ruta real del
archivo antes de editar) resumiendo: se agregó edición de nombre y asignación de Jefe de Contrato
en `/admin/contratos`; se resolvió el bug donde ningún JefeContrato veía nada en `/aprobaciones`
por falta de este dato (causa raíz: los 8 contratos tenían `jefeContratoCuil = null`, sin forma de
asignarlo desde la UI). Mencionar que ya se asignó manualmente `mvega` como jefe de K9/K10 para
destrabar la prueba del usuario mientras se implementaba esta feature.

- [ ] **Step 6: Commit final (si Step 5 generó cambios)**

```bash
git add .claude/Contexto/contexto-proyecto.md
git commit -m "docs: contexto — edición de contratos (nombre + jefe de contrato)"
```
