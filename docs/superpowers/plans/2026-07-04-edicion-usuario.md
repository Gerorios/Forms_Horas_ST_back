# Edición completa de usuario (inline) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir editar email, rol, contratos habilitados y (opcionalmente) resetear la contraseña de un usuario existente desde `/admin/usuarios`, con una fila expandible inline.

**Architecture:** El endpoint `PATCH /admin/usuarios/:cuil` y el hook `useEditarUsuario` ya existen y soportan todos los campos. El trabajo es casi todo frontend: un componente `UsuarioEditRow` que expande un formulario pre-cargado. Se requiere un ajuste aditivo mínimo en el backend: exponer `rolId` y los `id` de contratos en la respuesta de `getUsuarios` para poder preseleccionar los valores actuales.

**Tech Stack:** Next.js (App Router), TypeScript, React, TanStack Query, Vitest + Testing Library, Tailwind. Backend: NestJS + Prisma.

## Global Constraints

- Repos separados: backend en `Formulario_Horas/Backend`, frontend en `Formulario_Horas/Frontend`.
- **NUNCA correr `prisma db push` / `migrate`** (BD compartida). Este plan no cambia el schema, solo un `select`.
- Frontend: mantener la suite verde (hoy 54/54), `npm run lint` y `npm run build` OK.
- Token en `localStorage` (clave `sth_token`); ya manejado por el cliente Axios.
- El empleado/CUIL de un usuario es la PK: **no** es editable.
- El toggle de activo (`PillActivo`) se mantiene sin cambios.
- Backend sin suite automatizada: se verifica por curl (patrón actual del repo).

---

### Task 1: Exponer `rolId` e ids de contrato en la respuesta de usuarios

**Files:**
- Modify: `Backend/src/admin/admin.service.ts` (método `getUsuarios`, ~líneas 79-91)
- Modify: `Frontend/src/lib/api/admin.ts` (interface `UsuarioAdmin`, ~líneas 10-15)

**Interfaces:**
- Produces (backend JSON): cada usuario incluye `rolId: number` y
  `contratosHabilitados: { contratoId: number; contrato: { codigo: string } }[]`.
- Produces (frontend type): `UsuarioAdmin` con `rolId: number` y
  `contratosHabilitados: { contratoId: number; contrato: { codigo: string } }[]`.

- [ ] **Step 1: Modificar el `select` de `getUsuarios` en el backend**

En `Backend/src/admin/admin.service.ts`, reemplazar el cuerpo del `select` de `getUsuarios`:

```typescript
  getUsuarios() {
    return this.prisma.usuario.findMany({
      select: {
        cuil: true,
        email: true,
        activo: true,
        rolId: true,
        rol: { select: { nombre: true } },
        empleado: { select: { apellido_nombre: true } },
        contratosHabilitados: {
          select: { contratoId: true, contrato: { select: { codigo: true } } },
        },
      },
      orderBy: { cuil: 'asc' },
    });
  }
```

- [ ] **Step 2: Verificar por curl que la respuesta incluye los ids**

Con el backend corriendo (`npm run start:dev` en `Backend/`, puerto 3001):

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@test.local","password":"admin1234"}' | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
curl -s http://localhost:3001/admin/usuarios -H "Authorization: Bearer $TOKEN" | head -c 800
```

Expected: cada usuario muestra `"rolId":<n>` y cada contrato habilitado muestra `"contratoId":<n>` junto a `"contrato":{"codigo":"..."}`.

- [ ] **Step 3: Actualizar la interface `UsuarioAdmin` en el frontend**

En `Frontend/src/lib/api/admin.ts`, reemplazar la interface:

```typescript
export interface UsuarioAdmin {
  cuil: string; email: string; activo: boolean;
  rolId: number;
  rol: { nombre: string };
  empleado: { apellido_nombre: string };
  contratosHabilitados: { contratoId: number; contrato: { codigo: string } }[];
}
```

- [ ] **Step 4: Verificar que compila (frontend)**

Run (en `Frontend/`): `npm run build`
Expected: build OK. La página `usuarios/page.tsx` sigue usando `c.contrato.codigo` (sigue existiendo), así que no rompe.

- [ ] **Step 5: Commit**

Backend:
```bash
git -C Backend add src/admin/admin.service.ts
git -C Backend commit -m "feat(admin): exponer rolId e ids de contrato en GET /admin/usuarios"
```
Frontend:
```bash
git -C Frontend add src/lib/api/admin.ts
git -C Frontend commit -m "feat(admin): UsuarioAdmin incluye rolId y contratoId"
```

---

### Task 2: Componente `UsuarioEditRow` con formulario de edición inline

**Files:**
- Create: `Frontend/src/features/admin/usuario-edit-row.tsx`
- Test: `Frontend/src/features/admin/usuario-edit-row.test.tsx`

**Interfaces:**
- Consumes: `UsuarioAdmin` (con `rolId` y `contratosHabilitados[].contratoId` de Task 1);
  `useEditarUsuario()` → `{ mutateAsync({ cuil, email?, password?, rolId?, activo?, contratosIds? }), isPending }`;
  `useRoles()` → `{ data: { id: number; nombre: string }[] }`;
  `useContratosAdmin()` → `{ data: { id: number; codigo: string }[] }`.
- Produces: `export function UsuarioEditRow({ usuario }: { usuario: UsuarioAdmin }): JSX.Element`
  que renderiza **un `<tr>` de fila normal** y, cuando está expandido, **un segundo
  `<tr>` con un `<td colSpan={5}>`** conteniendo el formulario.

- [ ] **Step 1: Escribir el test que falla**

Crear `Frontend/src/features/admin/usuario-edit-row.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UsuarioAdmin } from '@/lib/api/admin';

const editar = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/admin', () => ({
  useEditarUsuario: () => ({ mutateAsync: editar, isPending: false }),
  useRoles: () => ({ data: [ { id: 1, nombre: 'Operario' }, { id: 2, nombre: 'Admin' } ] }),
  useContratosAdmin: () => ({ data: [ { id: 10, codigo: 'K5' }, { id: 11, codigo: 'K8' } ] }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }));

import { UsuarioEditRow } from './usuario-edit-row';

const USUARIO: UsuarioAdmin = {
  cuil: '20111111111',
  email: 'op@st.local',
  activo: true,
  rolId: 1,
  rol: { nombre: 'Operario' },
  empleado: { apellido_nombre: 'TORRES RAMON' },
  contratosHabilitados: [{ contratoId: 10, contrato: { codigo: 'K5' } }],
};

// Helper: renderiza la fila dentro de una tabla válida.
function renderRow(u: UsuarioAdmin = USUARIO) {
  return render(
    <table><tbody><UsuarioEditRow usuario={u} /></tbody></table>,
  );
}

describe('UsuarioEditRow', () => {
  beforeEach(() => { editar.mockClear(); });

  it('precarga los valores actuales al expandir', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    expect(screen.getByLabelText('Email')).toHaveValue('op@st.local');
    expect(screen.getByLabelText('Rol')).toHaveValue('1');
    // El contrato K5 (id 10) aparece como seleccionado (aria-pressed=true).
    expect(screen.getByRole('button', { name: 'K5' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('editar el email y guardar llama al mutate con el email nuevo', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const email = screen.getByLabelText('Email');
    await userEvent.clear(email);
    await userEvent.type(email, 'nuevo@st.local');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(editar).toHaveBeenCalledWith(
      expect.objectContaining({ cuil: '20111111111', email: 'nuevo@st.local' }),
    ));
  });

  it('password vacío no se envía en el payload', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    const email = screen.getByLabelText('Email');
    await userEvent.clear(email);
    await userEvent.type(email, 'otro@st.local');
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(editar).toHaveBeenCalled());
    expect(editar.mock.calls[0][0]).not.toHaveProperty('password');
  });

  it('password con menos de 8 caracteres deshabilita Guardar', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.type(screen.getByLabelText('Nueva contraseña'), 'corta');
    expect(screen.getByRole('button', { name: /guardar/i })).toBeDisabled();
  });

  it('Cancelar colapsa la fila sin llamar al mutate', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(editar).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run (en `Frontend/`): `npx vitest run src/features/admin/usuario-edit-row.test.tsx`
Expected: FAIL — `Failed to resolve import './usuario-edit-row'` (el módulo no existe todavía).

- [ ] **Step 3: Implementar el componente**

Crear `Frontend/src/features/admin/usuario-edit-row.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useEditarUsuario, useRoles, useContratosAdmin, type UsuarioAdmin } from '@/lib/api/admin';

const inputCls =
  'rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30';

export function UsuarioEditRow({ usuario }: { usuario: UsuarioAdmin }) {
  const editar = useEditarUsuario();
  const { data: roles } = useRoles();
  const { data: contratos } = useContratosAdmin();

  const [abierto, setAbierto] = useState(false);
  const [email, setEmail] = useState(usuario.email);
  const [rolId, setRolId] = useState<number>(usuario.rolId);
  const [contratosIds, setContratosIds] = useState<number[]>(
    usuario.contratosHabilitados.map((c) => c.contratoId),
  );
  const [password, setPassword] = useState('');

  const origContratos = usuario.contratosHabilitados.map((c) => c.contratoId);

  const emailValido = /^\S+@\S+\.\S+$/.test(email.trim());
  const passwordValido = password === '' || password.length >= 8;

  const contratosCambio =
    contratosIds.length !== origContratos.length ||
    contratosIds.some((id) => !origContratos.includes(id));
  const huboCambios =
    email.trim() !== usuario.email || rolId !== usuario.rolId || contratosCambio || password !== '';

  const puedeGuardar = emailValido && passwordValido && huboCambios && !editar.isPending;

  function toggleContrato(id: number) {
    setContratosIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function cerrar() {
    setAbierto(false);
    setEmail(usuario.email);
    setRolId(usuario.rolId);
    setContratosIds(origContratos);
    setPassword('');
  }

  async function guardar() {
    if (!puedeGuardar) return;
    const payload: {
      cuil: string; email?: string; rolId?: number; contratosIds?: number[]; password?: string;
    } = { cuil: usuario.cuil };
    if (email.trim() !== usuario.email) payload.email = email.trim();
    if (rolId !== usuario.rolId) payload.rolId = rolId;
    if (contratosCambio) payload.contratosIds = contratosIds;
    if (password !== '') payload.password = password;

    const promesa = editar.mutateAsync(payload);
    toast.promise(promesa, {
      loading: 'Guardando…',
      success: 'Usuario actualizado',
      error: 'No se pudo actualizar',
    });
    try {
      await promesa;
      setAbierto(false);
      setPassword('');
    } catch {
      // toast.promise ya avisó
    }
  }

  return (
    <>
      <tr className="border-b border-line last:border-0">
        <td className="px-4 py-2.5 text-ink">{usuario.empleado.apellido_nombre}</td>
        <td className="px-4 py-2.5 text-slate">{usuario.email}</td>
        <td className="px-4 py-2.5 text-ink">{usuario.rol.nombre}</td>
        <td className="px-4 py-2.5 text-slate">
          {usuario.contratosHabilitados.map((c) => c.contrato.codigo).join(', ') || '—'}
        </td>
        <td className="px-4 py-2.5">
          <button
            type="button"
            onClick={() => (abierto ? cerrar() : setAbierto(true))}
            className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-slate transition hover:bg-accent/60"
          >
            {abierto ? 'Cerrar' : 'Editar ▾'}
          </button>
        </td>
      </tr>
      {abierto && (
        <tr className="border-b border-line bg-accent/20">
          <td colSpan={5} className="px-4 py-4">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                  Email
                  <input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                  Nueva contraseña
                  <input
                    aria-label="Nueva contraseña"
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="vacío = no cambia (mín. 8)"
                    className={inputCls}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-sm font-medium text-ink sm:max-w-xs">
                Rol
                <select
                  aria-label="Rol"
                  value={rolId}
                  onChange={(e) => setRolId(Number(e.target.value))}
                  className={inputCls}
                >
                  {(roles ?? []).map((r) => (
                    <option key={r.id} value={r.id}>{r.nombre}</option>
                  ))}
                </select>
              </label>
              <div>
                <p className="text-sm font-medium text-ink">Contratos habilitados</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(contratos ?? []).map((c) => {
                    const on = contratosIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleContrato(c.id)}
                        className={`rounded-full border px-2.5 py-1 text-xs transition ${
                          on ? 'border-brand bg-accent font-medium text-ink' : 'border-line text-slate hover:border-brand/50'
                        }`}
                      >
                        {c.codigo}
                      </button>
                    );
                  })}
                </div>
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
          </td>
        </tr>
      )}
    </>
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run (en `Frontend/`): `npx vitest run src/features/admin/usuario-edit-row.test.tsx`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git -C Frontend add src/features/admin/usuario-edit-row.tsx src/features/admin/usuario-edit-row.test.tsx
git -C Frontend commit -m "feat(admin): UsuarioEditRow con edición inline de usuario"
```

---

### Task 3: Cablear `UsuarioEditRow` en la página de usuarios

**Files:**
- Modify: `Frontend/src/app/(protected)/admin/usuarios/page.tsx`

**Interfaces:**
- Consumes: `UsuarioEditRow` de Task 2.
- La página mantiene `PillActivo` + `cambiarActivo` en la columna Estado, sin cambios.

- [ ] **Step 1: Reemplazar el `<tr>` del map por `UsuarioEditRow`**

En `Frontend/src/app/(protected)/admin/usuarios/page.tsx`:

Agregar el import cerca de los otros de features:
```tsx
import { UsuarioEditRow } from '@/features/admin/usuario-edit-row';
```

Agregar la columna "Acciones" en el `<thead>`, después de la de "Estado":
```tsx
                <th className="px-4 py-2.5 font-medium">Estado</th>
                <th className="px-4 py-2.5 font-medium">Acciones</th>
```

Reemplazar todo el bloque `{(data ?? []).map((u) => ( ... ))}` del `<tbody>` por:
```tsx
              {(data ?? []).map((u) => (
                <UsuarioEditRow key={u.cuil} usuario={u} />
              ))}
```

- [ ] **Step 2: Mover el toggle de activo dentro de `UsuarioEditRow`**

`UsuarioEditRow` (Task 2) renderiza 5 columnas: Empleado, Email, Rol, Contratos, Acciones. Pero la tabla ahora tiene 6 columnas (con Estado). Para no duplicar la lógica de activo, ajustar `UsuarioEditRow` para recibir la celda de estado como prop y renderizarla:

En `usuario-edit-row.tsx`, primero actualizar el import de react para traer el tipo `ReactNode`:
```tsx
import { useState, type ReactNode } from 'react';
```
Luego cambiar la firma y agregar la celda de Estado **antes** de la de Acciones:
```tsx
export function UsuarioEditRow({ usuario, estado }: { usuario: UsuarioAdmin; estado: ReactNode }) {
```
Y en la fila normal, insertar antes del `<td>` de Acciones:
```tsx
        <td className="px-4 py-2.5">{estado}</td>
        <td className="px-4 py-2.5">
          <button
            type="button"
            onClick={() => (abierto ? cerrar() : setAbierto(true))}
```
Y actualizar el `colSpan` de la fila expandida de `5` a `6`:
```tsx
          <td colSpan={6} className="px-4 py-4">
```

En `page.tsx`, pasar la celda de estado:
```tsx
              {(data ?? []).map((u) => (
                <UsuarioEditRow
                  key={u.cuil}
                  usuario={u}
                  estado={
                    <PillActivo
                      activo={u.activo}
                      disabled={editar.isPending}
                      onToggle={() => cambiarActivo(u.cuil, !u.activo)}
                    />
                  }
                />
              ))}
```

- [ ] **Step 3: Actualizar el test de `UsuarioEditRow` por la nueva prop `estado`**

En `usuario-edit-row.test.tsx`, actualizar el helper `renderRow` para pasar `estado`:
```tsx
function renderRow(u: UsuarioAdmin = USUARIO) {
  return render(
    <table><tbody><UsuarioEditRow usuario={u} estado={<span>estado</span>} /></tbody></table>,
  );
}
```

- [ ] **Step 4: Correr toda la suite del frontend**

Run (en `Frontend/`): `npm test`
Expected: PASS, todos verdes (los ~54 previos + los 5 nuevos de `UsuarioEditRow`).

- [ ] **Step 5: Lint y build**

Run (en `Frontend/`): `npm run lint && npm run build`
Expected: lint limpio, build OK.

- [ ] **Step 6: Verificación manual E2E (navegador)**

Con backend (3001) y frontend (3000) corriendo, entrar como `admin@test.local` / `admin1234`,
ir a `/admin/usuarios`, click en **Editar** de un usuario: el form aparece pre-cargado (email,
rol, contratos marcados). Cambiar el email y **Guardar** → toast de éxito y la tabla refleja el
cambio. Verificar que el toggle de activo sigue funcionando.

- [ ] **Step 7: Commit**

```bash
git -C Frontend add "src/app/(protected)/admin/usuarios/page.tsx" src/features/admin/usuario-edit-row.tsx src/features/admin/usuario-edit-row.test.tsx
git -C Frontend commit -m "feat(admin): edición inline de usuario en /admin/usuarios"
```

---

## Notas de cierre
- No hay cambios de schema ni migraciones. El único cambio de backend es aditivo (un `select`).
- Al terminar, actualizar el contexto (`.claude/Contexto/contexto-proyecto.md`) marcando "edición completa de usuario" como resuelto en los pendientes globales (§20).
- Ambos repos se pushean al terminar (`git -C Backend push` / `git -C Frontend push`).
