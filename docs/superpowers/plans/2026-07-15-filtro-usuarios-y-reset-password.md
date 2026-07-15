# Filtro de usuarios + reset de contraseña — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un filtro (nombre + rol) a `/admin/usuarios` y un botón de reset de contraseña individual (a CUIL) por Admin, más el cambio de alta masiva para usar CUIL como password.

**Architecture:** Backend NestJS — un endpoint nuevo `POST /admin/usuarios/:cuil/resetear-password` que hashea el CUIL y lo guarda; alta masiva cambia su generador de password a `cuil`. Frontend Next.js — filtro 100% client-side sobre los datos ya cargados de `/admin/usuarios`; el reset se dispara desde un botón dentro de `UsuarioEditRow`, pero el diálogo de confirmación vive a nivel de página (mismo patrón que `DesaprobarDialog` en `/aprobaciones`), para no romper la semántica HTML de la tabla.

**Tech Stack:** NestJS 11, Prisma 7, `bcrypt` — backend. Next.js (App Router), TanStack Query, Vitest + Testing Library — frontend.

## Global Constraints

- Repos: backend en `Forms_Horas_ST_back` (este working directory), frontend en `Forms_Horas_ST_Frontend` (`../Frontend`). Ambos ya en la rama `feature/admin-usuarios-filtro-reset`, creada desde `main`.
- **La contraseña de un usuario (alta masiva y reset individual) es su propio CUIL** — decisión de seguridad consciente, documentada en `docs/adr/2026-07-15-adr-003-password-reset-cuil.md`. No inventar generación aleatoria.
- Hash con `bcrypt`, **10 rounds** — igual que el resto de `AdminService` (`admin.service.ts:100,117,154`).
- Sin autoservicio de "olvidé mi contraseña" — fuera de alcance, diferido (ver ADR-003).
- Filtro de usuarios es **100% client-side** — sin cambios de backend, sin paginación.
- Backend sin infraestructura de tests automatizada (no hay `*.spec.ts` en `src/`) — verificación de tareas backend es `npm run build` + curl manual documentado.
- Frontend con Vitest + Testing Library — cada tarea de frontend sigue TDD.
- El diálogo de confirmación del reset se renderiza **a nivel de página**, no dentro de `UsuarioEditRow` (que es un `<tr>` de tabla) — mismo patrón arquitectónico que `DesaprobarDialog` en `src/app/(protected)/aprobaciones/page.tsx`.
- Spec completa: `docs/superpowers/specs/2026-07-15-filtro-usuarios-y-reset-password-design.md`.

---

## Backend (`Forms_Horas_ST_back`)

### Task 1: `POST /admin/usuarios/:cuil/resetear-password`

**Files:**
- Modify: `src/admin/admin.service.ts`
- Modify: `src/admin/admin.controller.ts`

**Interfaces:**
- Produces: `AdminService.resetearPassword(cuil: string): Promise<{ cuil: string; password: string }>`, endpoint `POST /admin/usuarios/:cuil/resetear-password` (sin body).

- [ ] **Step 1: Agregar `resetearPassword` al servicio**

En `src/admin/admin.service.ts`, agregar el método debajo de `updateUsuario` (antes de `createUsuariosMasivo`):

```ts
async resetearPassword(cuil: string) {
  const passwordHash = await bcrypt.hash(cuil, 10);
  await this.prisma.usuario.update({ where: { cuil }, data: { passwordHash } });
  return { cuil, password: cuil };
}
```

No requiere nuevo import — `bcrypt` ya está importado en este archivo.

- [ ] **Step 2: Agregar el endpoint**

En `src/admin/admin.controller.ts`, agregar debajo de `updateUsuario` (antes de `createUsuariosMasivo`):

```ts
@Post('usuarios/:cuil/resetear-password')
resetearPassword(@Param('cuil') cuil: string) {
  return this.service.resetearPassword(cuil);
}
```

No requiere nuevos imports — `Post` y `Param` ya están importados.

- [ ] **Step 3: Verificar que compila**

Run: `npm run build`
Expected: termina sin errores.

- [ ] **Step 4: Verificación manual E2E (curl)**

El usuario, con un token Admin real, corre:

```bash
curl -X POST http://localhost:3001/admin/usuarios/<cuil>/resetear-password \
  -H "Authorization: Bearer $TOKEN"
```

Expected: 200 con `{ "cuil": "<cuil>", "password": "<cuil>" }`; login posterior con ese CUIL como password funciona.

- [ ] **Step 5: Commit**

```bash
git add src/admin/admin.service.ts src/admin/admin.controller.ts
git commit -m "feat(admin): POST /admin/usuarios/:cuil/resetear-password"
```

---

### Task 2: Alta masiva usa el CUIL como password

**Files:**
- Modify: `src/admin/admin.service.ts`

**Interfaces:**
- Ninguna nueva — cambia el comportamiento interno de `createUsuariosMasivo` (ya existente).

- [ ] **Step 1: Cambiar el generador de password**

En `src/admin/admin.service.ts`, dentro de `createUsuariosMasivo`, reemplazar:

```ts
      const password = this.generarPassword();
```

por:

```ts
      const password = cuil;
```

- [ ] **Step 2: Eliminar `generarPassword()` (queda sin usos)**

Eliminar el método privado completo:

```ts
  private generarPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let p = '';
    for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
    return p;
  }
```

- [ ] **Step 3: Verificar que no quedan referencias**

Run: `grep -rn "generarPassword" src/`
Expected: sin resultados.

- [ ] **Step 4: Verificar que compila**

Run: `npm run build`
Expected: termina sin errores.

- [ ] **Step 5: Verificación manual E2E (curl)**

El usuario, con un token Admin real, corre alta masiva con un CUIL de prueba y confirma que
`creados[0].password === creados[0].cuil`, y que puede loguearse con ese CUIL como password.

- [ ] **Step 6: Commit**

```bash
git add src/admin/admin.service.ts
git commit -m "feat(admin): alta masiva usa el CUIL como password (ADR-003)"
```

---

## Frontend (`Forms_Horas_ST_Frontend`)

> Todos los comandos de esta sección corren desde el repo frontend (`../Frontend` relativo a `Forms_Horas_ST_back`).

### Task 3: Filtro por nombre y rol en `/admin/usuarios`

**Files:**
- Modify: `src/app/(protected)/admin/usuarios/page.tsx`
- Create: `src/app/(protected)/admin/usuarios/usuarios-page.test.tsx`

**Interfaces:**
- Consumes: `useUsuariosAdmin()`, `useRoles()` (ambos ya existentes en `@/lib/api/admin`), `UsuarioAdmin { cuil, email, activo, rolId, rol: { nombre }, empleado: { apellido_nombre }, contratosHabilitados }`.
- Produce: ninguna interfaz nueva para otras tareas — es hoja del árbol de dependencias salvo por Task 5, que vuelve a tocar este mismo archivo.

- [ ] **Step 1: Escribir el test (falla porque el filtro no existe)**

Crear `src/app/(protected)/admin/usuarios/usuarios-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UsuarioAdmin } from '@/lib/api/admin';

const editar = vi.fn().mockResolvedValue({});

const USUARIOS: UsuarioAdmin[] = [
  {
    cuil: '20111111111', email: 'jose@st.local', activo: true, rolId: 1,
    rol: { nombre: 'Operario' }, empleado: { apellido_nombre: 'JOSÉ TORRES' },
    contratosHabilitados: [],
  },
  {
    cuil: '20222222222', email: 'maria@st.local', activo: true, rolId: 2,
    rol: { nombre: 'Admin' }, empleado: { apellido_nombre: 'MARIA GOMEZ' },
    contratosHabilitados: [],
  },
];

vi.mock('@/lib/api/admin', () => ({
  useUsuariosAdmin: () => ({ data: USUARIOS, isLoading: false }),
  useEditarUsuario: () => ({ mutateAsync: editar, isPending: false }),
  useRoles: () => ({ data: [{ id: 1, nombre: 'Operario' }, { id: 2, nombre: 'Admin' }] }),
  useContratosAdmin: () => ({ data: [] }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }));

import UsuariosAdminPage from './page';

describe('UsuariosAdminPage — filtro', () => {
  beforeEach(() => { editar.mockClear(); });

  it('muestra todos los usuarios sin filtro', () => {
    render(<UsuariosAdminPage />);
    expect(screen.getByText('JOSÉ TORRES')).toBeInTheDocument();
    expect(screen.getByText('MARIA GOMEZ')).toBeInTheDocument();
  });

  it('filtra por nombre, sin distinguir tildes/mayúsculas', async () => {
    render(<UsuariosAdminPage />);
    await userEvent.type(screen.getByLabelText('Buscar por nombre'), 'jose');
    expect(screen.getByText('JOSÉ TORRES')).toBeInTheDocument();
    expect(screen.queryByText('MARIA GOMEZ')).not.toBeInTheDocument();
  });

  it('filtra por rol seleccionado', async () => {
    render(<UsuariosAdminPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }));
    expect(screen.queryByText('JOSÉ TORRES')).not.toBeInTheDocument();
    expect(screen.getByText('MARIA GOMEZ')).toBeInTheDocument();
  });

  it('combina nombre y rol con "Y"', async () => {
    render(<UsuariosAdminPage />);
    await userEvent.type(screen.getByLabelText('Buscar por nombre'), 'jose');
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }));
    expect(screen.getByText('No hay usuarios que coincidan con el filtro.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- "src/app/(protected)/admin/usuarios/usuarios-page.test.tsx"`
Expected: FAIL — `getByLabelText('Buscar por nombre')` no encuentra nada (el input no existe todavía).

- [ ] **Step 3: Implementar el filtro**

Reemplazar el contenido completo de `src/app/(protected)/admin/usuarios/page.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { AltaMasiva } from '@/features/admin/alta-masiva';
import { PillActivo } from '@/features/admin/pill-activo';
import { UsuarioEditRow } from '@/features/admin/usuario-edit-row';
import { UsuarioForm } from '@/features/admin/usuario-form';
import { useUsuariosAdmin, useEditarUsuario, useRoles } from '@/lib/api/admin';

function normalizar(s: string) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export default function UsuariosAdminPage() {
  const { data, isLoading } = useUsuariosAdmin();
  const { data: roles } = useRoles();
  const editar = useEditarUsuario();
  const [modo, setModo] = useState<null | 'individual' | 'masiva'>(null);
  const [nombre, setNombre] = useState('');
  const [rolesFiltro, setRolesFiltro] = useState<number[]>([]);

  function cambiarActivo(cuil: string, activo: boolean) {
    toast.promise(editar.mutateAsync({ cuil, activo }), {
      loading: 'Actualizando…',
      success: 'Usuario actualizado',
      error: 'No se pudo actualizar',
    });
  }

  function toggleRolFiltro(id: number) {
    setRolesFiltro((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const filtrados = useMemo(() => {
    const nombreNorm = normalizar(nombre.trim());
    return (data ?? []).filter((u) => {
      const matchNombre = nombreNorm === '' || normalizar(u.empleado.apellido_nombre).includes(nombreNorm);
      const matchRol = rolesFiltro.length === 0 || rolesFiltro.includes(u.rolId);
      return matchNombre && matchRol;
    });
  }, [data, nombre, rolesFiltro]);

  return (
    <section className="space-y-5">
      <PageHeader
        eyebrow="Admin"
        title="Usuarios"
        action={
          <div className="flex gap-2">
            <button type="button" onClick={() => setModo((m) => (m === 'masiva' ? null : 'masiva'))}
              className="rounded-md border border-line px-4 py-2 text-sm font-medium text-slate transition hover:bg-accent/60">
              Alta masiva
            </button>
            <button type="button" onClick={() => setModo((m) => (m === 'individual' ? null : 'individual'))}
              className="rounded-md bg-brand px-4 py-2 font-medium text-ink transition hover:brightness-95">
              {modo === 'individual' ? 'Cerrar' : 'Nuevo usuario'}
            </button>
          </div>
        }
      />

      {modo === 'individual' && <UsuarioForm onCreado={() => setModo(null)} />}
      {modo === 'masiva' && <AltaMasiva onListo={() => {}} />}

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-ink sm:max-w-xs">
          Buscar por nombre
          <input
            aria-label="Buscar por nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre del empleado"
            className="rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </label>
        <div>
          <p className="text-sm font-medium text-ink">Rol</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(roles ?? []).map((r) => {
              const on = rolesFiltro.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleRolFiltro(r.id)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    on ? 'border-brand bg-accent font-medium text-ink' : 'border-line text-slate hover:border-brand/50'
                  }`}
                >
                  {r.nombre}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {isLoading ? (
        <p className="text-slate">Cargando…</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-slate">
                <th className="px-4 py-2.5 font-medium">Empleado</th>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Rol</th>
                <th className="px-4 py-2.5 font-medium">Contratos</th>
                <th className="px-4 py-2.5 font-medium">Estado</th>
                <th className="px-4 py-2.5 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((u) => (
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
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center text-sm text-slate">
                    No hay usuarios que coincidan con el filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

Nota: `UsuarioEditRow` en este punto todavía no acepta `onResetearPassword` — ese prop se agrega en
la Task 5, que vuelve a tocar este archivo. No agregarlo todavía acá.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- "src/app/(protected)/admin/usuarios/usuarios-page.test.tsx"`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint y build**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(protected)/admin/usuarios/page.tsx" "src/app/(protected)/admin/usuarios/usuarios-page.test.tsx"
git commit -m "feat(admin): filtro por nombre y rol en /admin/usuarios"
```

---

### Task 4: Hook `useResetearPassword`

**Files:**
- Modify: `src/lib/api/admin.ts`

**Interfaces:**
- Consumes: endpoint `POST /admin/usuarios/:cuil/resetear-password` (Task 1).
- Produces: `useResetearPassword()` — `useMutation` de TanStack Query con `mutationFn: (cuil: string) => Promise<{ cuil: string; password: string }>`, `.mutateAsync` e `.isPending`.

- [ ] **Step 1: Agregar el hook debajo de `useCrearUsuariosMasivo`**

Al final de `src/lib/api/admin.ts`:

```ts
export function useResetearPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cuil: string) =>
      api.post(`/admin/usuarios/${cuil}/resetear-password`, {}).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'usuarios'] }),
  });
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build`
Expected: termina sin errores de tipos.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/admin.ts
git commit -m "feat(admin): hook useResetearPassword"
```

---

### Task 5: Botón de reset en `UsuarioEditRow` + diálogo de confirmación

**Files:**
- Create: `src/features/admin/resetear-password-dialog.tsx`
- Create: `src/features/admin/resetear-password-dialog.test.tsx`
- Modify: `src/features/admin/usuario-edit-row.tsx`
- Modify: `src/features/admin/usuario-edit-row.test.tsx`
- Modify: `src/app/(protected)/admin/usuarios/page.tsx`
- Modify: `src/app/(protected)/admin/usuarios/usuarios-page.test.tsx`

**Interfaces:**
- Consumes: `useResetearPassword()` (Task 4).
- Produces: `UsuarioEditRow` gana un prop nuevo **obligatorio** `onResetearPassword: () => void` (llamado sin argumentos al hacer click en el botón — el `cuil`/nombre ya los tiene el padre, que es quien conoce qué fila abrió el diálogo). `ResetearPasswordDialog({ apellidoNombre: string; cuil: string; onConfirm: () => void; onCancel: () => void })`.

El diálogo se renderiza **a nivel de página** (`UsuariosAdminPage`), no dentro de `UsuarioEditRow`
— `UsuarioEditRow` retorna `<tr>` dentro de un `<Fragment>`, y un `<div className="fixed inset-0">`
como hijo directo de `<tbody>` es HTML inválido. Mismo patrón que `DesaprobarDialog` en
`src/app/(protected)/aprobaciones/page.tsx` (dialog state vive en la página, no en la fila).

- [ ] **Step 1: Escribir el test del diálogo (falla porque no existe)**

Crear `src/features/admin/resetear-password-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResetearPasswordDialog } from './resetear-password-dialog';

describe('ResetearPasswordDialog', () => {
  it('muestra el nombre y el cuil en el mensaje de confirmación', () => {
    render(
      <ResetearPasswordDialog apellidoNombre="TORRES RAMON" cuil="20111111111" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(/TORRES RAMON/)).toBeInTheDocument();
    expect(screen.getByText(/20111111111/)).toBeInTheDocument();
  });

  it('confirmar llama a onConfirm', async () => {
    const onConfirm = vi.fn();
    render(
      <ResetearPasswordDialog apellidoNombre="TORRES RAMON" cuil="20111111111" onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancelar llama a onCancel sin llamar a onConfirm', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ResetearPasswordDialog apellidoNombre="TORRES RAMON" cuil="20111111111" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- src/features/admin/resetear-password-dialog.test.tsx`
Expected: FAIL — `Failed to resolve import "./resetear-password-dialog"`.

- [ ] **Step 3: Implementar `ResetearPasswordDialog`**

Crear `src/features/admin/resetear-password-dialog.tsx`:

```tsx
'use client';

export function ResetearPasswordDialog({
  apellidoNombre,
  cuil,
  onConfirm,
  onCancel,
}: {
  apellidoNombre: string;
  cuil: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm space-y-3 rounded-lg bg-white p-6">
        <h3 className="font-semibold text-neutral">Resetear contraseña</h3>
        <p className="text-sm text-neutral">
          ¿Resetear la contraseña de <strong>{apellidoNombre}</strong> a su CUIL (<strong>{cuil}</strong>)?
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-neutral">
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-brand px-3 py-2 text-sm font-medium text-ink"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- src/features/admin/resetear-password-dialog.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Agregar el botón a `UsuarioEditRow`**

Modificar `src/features/admin/usuario-edit-row.tsx`:

1. Agregar `onResetearPassword` a la firma de props:

```tsx
export function UsuarioEditRow({
  usuario,
  estado,
  onResetearPassword,
}: {
  usuario: UsuarioAdmin;
  estado: ReactNode;
  onResetearPassword: () => void;
}) {
```

2. Reemplazar el bloque final de botones (Guardar/Cancelar) por:

```tsx
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
                <button
                  type="button"
                  onClick={onResetearPassword}
                  className="ml-auto rounded-md border border-line px-4 py-2 text-sm font-medium text-slate transition hover:bg-accent/60"
                >
                  Resetear contraseña
                </button>
              </div>
```

- [ ] **Step 6: Actualizar `usuario-edit-row.test.tsx`**

Reemplazar el contenido completo de `src/features/admin/usuario-edit-row.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UsuarioAdmin } from '@/lib/api/admin';

const editar = vi.fn().mockResolvedValue({});
const onResetearPassword = vi.fn();

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
    <table><tbody><UsuarioEditRow usuario={u} estado={<span>estado</span>} onResetearPassword={onResetearPassword} /></tbody></table>,
  );
}

describe('UsuarioEditRow', () => {
  beforeEach(() => { editar.mockClear(); onResetearPassword.mockClear(); });

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

  it('click en "Resetear contraseña" llama a onResetearPassword', async () => {
    renderRow();
    await userEvent.click(screen.getByRole('button', { name: /editar/i }));
    await userEvent.click(screen.getByRole('button', { name: /resetear contraseña/i }));
    expect(onResetearPassword).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 7: Correr los tests de `UsuarioEditRow` y verificar que pasan**

Run: `npm test -- src/features/admin/usuario-edit-row.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 8: Wiring en `admin/usuarios/page.tsx`**

Modificar `src/app/(protected)/admin/usuarios/page.tsx` (versión de la Task 3):

1. Ampliar el import de `@/lib/api/admin`:

```tsx
import { useUsuariosAdmin, useEditarUsuario, useRoles, useResetearPassword, type UsuarioAdmin } from '@/lib/api/admin';
```

2. Agregar el import del diálogo, debajo del import de `UsuarioForm`:

```tsx
import { ResetearPasswordDialog } from '@/features/admin/resetear-password-dialog';
```

3. Dentro del componente, debajo de `const editar = useEditarUsuario();`:

```tsx
  const resetear = useResetearPassword();
  const [reseteando, setReseteando] = useState<UsuarioAdmin | null>(null);
```

4. Agregar la función de confirmación, junto a `cambiarActivo`:

```tsx
  async function confirmarReset() {
    if (!reseteando) return;
    const promesa = resetear.mutateAsync(reseteando.cuil);
    toast.promise(promesa, {
      loading: 'Reseteando…',
      success: 'Contraseña reseteada',
      error: 'No se pudo resetear',
    });
    setReseteando(null);
    try {
      await promesa;
    } catch {
      // toast.promise ya avisó
    }
  }
```

5. Pasar el prop nuevo a `UsuarioEditRow`:

```tsx
                <UsuarioEditRow
                  key={u.cuil}
                  usuario={u}
                  onResetearPassword={() => setReseteando(u)}
                  estado={
                    <PillActivo
                      activo={u.activo}
                      disabled={editar.isPending}
                      onToggle={() => cambiarActivo(u.cuil, !u.activo)}
                    />
                  }
                />
```

6. Renderizar el diálogo, justo antes del `</section>` de cierre:

```tsx
      {reseteando && (
        <ResetearPasswordDialog
          apellidoNombre={reseteando.empleado.apellido_nombre}
          cuil={reseteando.cuil}
          onConfirm={confirmarReset}
          onCancel={() => setReseteando(null)}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 9: Actualizar `usuarios-page.test.tsx`**

Reemplazar el contenido completo de `src/app/(protected)/admin/usuarios/usuarios-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UsuarioAdmin } from '@/lib/api/admin';

const editar = vi.fn().mockResolvedValue({});
const resetear = vi.fn().mockResolvedValue({});

const USUARIOS: UsuarioAdmin[] = [
  {
    cuil: '20111111111', email: 'jose@st.local', activo: true, rolId: 1,
    rol: { nombre: 'Operario' }, empleado: { apellido_nombre: 'JOSÉ TORRES' },
    contratosHabilitados: [],
  },
  {
    cuil: '20222222222', email: 'maria@st.local', activo: true, rolId: 2,
    rol: { nombre: 'Admin' }, empleado: { apellido_nombre: 'MARIA GOMEZ' },
    contratosHabilitados: [],
  },
];

vi.mock('@/lib/api/admin', () => ({
  useUsuariosAdmin: () => ({ data: USUARIOS, isLoading: false }),
  useEditarUsuario: () => ({ mutateAsync: editar, isPending: false }),
  useResetearPassword: () => ({ mutateAsync: resetear, isPending: false }),
  useRoles: () => ({ data: [{ id: 1, nombre: 'Operario' }, { id: 2, nombre: 'Admin' }] }),
  useContratosAdmin: () => ({ data: [] }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }));

import UsuariosAdminPage from './page';

describe('UsuariosAdminPage — filtro', () => {
  beforeEach(() => { editar.mockClear(); resetear.mockClear(); });

  it('muestra todos los usuarios sin filtro', () => {
    render(<UsuariosAdminPage />);
    expect(screen.getByText('JOSÉ TORRES')).toBeInTheDocument();
    expect(screen.getByText('MARIA GOMEZ')).toBeInTheDocument();
  });

  it('filtra por nombre, sin distinguir tildes/mayúsculas', async () => {
    render(<UsuariosAdminPage />);
    await userEvent.type(screen.getByLabelText('Buscar por nombre'), 'jose');
    expect(screen.getByText('JOSÉ TORRES')).toBeInTheDocument();
    expect(screen.queryByText('MARIA GOMEZ')).not.toBeInTheDocument();
  });

  it('filtra por rol seleccionado', async () => {
    render(<UsuariosAdminPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }));
    expect(screen.queryByText('JOSÉ TORRES')).not.toBeInTheDocument();
    expect(screen.getByText('MARIA GOMEZ')).toBeInTheDocument();
  });

  it('combina nombre y rol con "Y"', async () => {
    render(<UsuariosAdminPage />);
    await userEvent.type(screen.getByLabelText('Buscar por nombre'), 'jose');
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }));
    expect(screen.getByText('No hay usuarios que coincidan con el filtro.')).toBeInTheDocument();
  });
});

describe('UsuariosAdminPage — reset de contraseña', () => {
  beforeEach(() => { editar.mockClear(); resetear.mockClear(); });

  it('abre el diálogo con el nombre y cuil correctos y confirma llama al mutate con el cuil', async () => {
    render(<UsuariosAdminPage />);
    const filas = screen.getAllByRole('button', { name: /editar/i });
    await userEvent.click(filas[0]);
    await userEvent.click(screen.getByRole('button', { name: /resetear contraseña/i }));
    expect(screen.getByText(/JOSÉ TORRES/)).toBeInTheDocument();
    expect(screen.getByText(/20111111111/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    await waitFor(() => expect(resetear).toHaveBeenCalledWith('20111111111'));
  });

  it('cancelar el diálogo no llama al mutate', async () => {
    render(<UsuariosAdminPage />);
    const filas = screen.getAllByRole('button', { name: /editar/i });
    await userEvent.click(filas[0]);
    await userEvent.click(screen.getByRole('button', { name: /resetear contraseña/i }));
    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(resetear).not.toHaveBeenCalled();
  });
});
```

Nota: en el test "cancelar el diálogo no llama al mutate", el botón "Cancelar" del diálogo de
reset y el botón "Cancelar" del form de `UsuarioEditRow` coexisten en pantalla en ese momento
(la fila sigue expandida). `getByRole('button', { name: /cancelar/i })` puede matchear ambos —
si el test falla por ambigüedad, usar `getAllByRole('button', { name: /cancelar/i })` y hacer
click en el último (el del diálogo, montado después en el árbol) en vez de `getByRole`.

- [ ] **Step 10: Correr todos los tests tocados**

Run: `npm test -- src/features/admin/resetear-password-dialog.test.tsx src/features/admin/usuario-edit-row.test.tsx "src/app/(protected)/admin/usuarios/usuarios-page.test.tsx"`
Expected: PASS (15 tests en total).

- [ ] **Step 11: Lint y build**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 12: Commit**

```bash
git add src/features/admin/resetear-password-dialog.tsx src/features/admin/resetear-password-dialog.test.tsx \
  src/features/admin/usuario-edit-row.tsx src/features/admin/usuario-edit-row.test.tsx \
  "src/app/(protected)/admin/usuarios/page.tsx" "src/app/(protected)/admin/usuarios/usuarios-page.test.tsx"
git commit -m "feat(admin): reset de contraseña individual con confirmación"
```

---

### Task 6: Verificación final

**Files:** ninguno (solo comandos) + actualización de contexto.

- [ ] **Step 1: Suite completa de frontend**

Run: `npm test`
Expected: todos los tests pasan (los existentes + los ~18 nuevos de esta feature).

- [ ] **Step 2: Lint y build de frontend**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 3: Build de backend**

Desde `Forms_Horas_ST_back`:

Run: `npm run build`
Expected: termina sin errores.

- [ ] **Step 4: Checklist de verificación manual E2E (a cargo del usuario)**

Con el backend (`npm run start:dev`, puerto 3001) y el frontend (`npm run dev`, puerto 3000)
corriendo, y logueado como Admin (`rcarrazana@serytec.com`) en `/admin/usuarios`:

- [ ] Escribir en "Buscar por nombre" filtra la lista en vivo, sin distinguir tildes/mayúsculas.
- [ ] Click en un chip de rol filtra por ese rol; varios chips a la vez combinan con "Y" respecto
      al nombre.
- [ ] Click en "Editar ▾" → "Resetear contraseña" abre el diálogo con el nombre y CUIL correctos.
- [ ] Confirmar resetea la contraseña; loguearse con ese usuario usando el CUIL como password
      funciona.
- [ ] Cancelar el diálogo no cambia nada (el usuario sigue pudiendo loguearse con su password
      anterior).
- [ ] Alta masiva de un usuario nuevo: la contraseña mostrada en la tabla de credenciales es igual
      al CUIL de esa fila.

- [ ] **Step 5: Actualizar el contexto del proyecto**

Agregar una entrada nueva en `.claude/Contexto/contexto-proyecto.md` (verificar la ruta real del
archivo antes de editar) resumiendo: filtro de usuarios (nombre + rol) y reset de contraseña
individual agregados; alta masiva y reset ahora usan el CUIL como password (ADR-003); autoservicio
de "olvidé mi contraseña" queda diferido.

- [ ] **Step 6: Commit final (si Step 5 generó cambios)**

```bash
git add .claude/Contexto/contexto-proyecto.md
git commit -m "docs: contexto — filtro de usuarios + reset de contraseña"
```
