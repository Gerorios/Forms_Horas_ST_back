# Fase 4 — Panel Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el panel de administración (rol Admin): ABM de usuarios, contratos, tareas, móviles, provincias y tipos de novedad, más el alta masiva de operarios.

**Architecture:** Backend NestJS suma un endpoint de alta masiva (`POST /admin/usuarios/masivo`) sobre el `AdminController` existente. Frontend Next.js suma un árbol `/admin/*` con sub-navegación (guard Admin), hooks de TanStack Query en `lib/api/admin.ts`, y una página por sección con lista + alta + toggle, usando el sistema visual ya establecido (PageHeader, cards, StatusBadge, toast.promise).

**Tech Stack:** NestJS 11 + Prisma 7 (backend); Next.js 16 + TS + Tailwind v4 + TanStack Query v5 + Vitest/RTL (frontend).

## Global Constraints

- **Dos repos:** backend `Formulario_Horas/Backend` (`formulario-horas-backend`), frontend `Formulario_Horas/Frontend` (`formulario-horas-frontend`). Cada tarea commitea en su repo, rama `main`, sin ramas.
- Backend API `http://localhost:3001`; frontend `NEXT_PUBLIC_API_URL`.
- Todo `/admin/*` y `POST/PATCH /admin/**` es **solo rol Admin**.
- Alta masiva: email `<legajo>@st.local` (fallback a `<cuil>@st.local`, luego sufijo `-N` si colisiona); contraseña **aleatoria por usuario** (10 chars), devuelta en la respuesta (nunca persistida en claro). Rol de los creados: **Operario**, sin contratos habilitados.
- Sistema visual: tokens `sand/ink/brand/line` + estados; `import { PageHeader } from '@/components/page-header'`, `import { StatusBadge } from '@/components/status-badge'`; feedback con `toast.promise`; botones se deshabilitan mientras `isPending`.
- Endpoints admin existentes (todos `@Roles('Admin')`): `GET/POST/PATCH /admin/contratos`, `GET/POST /admin/tareas` + `PATCH /admin/tareas/:id/activo`, `GET/POST /admin/moviles` + `PATCH /admin/moviles/:id/activo`, `GET/POST /admin/provincias`, `GET/POST /admin/tipos-novedad` + `PATCH /admin/tipos-novedad/:id/activo`, `GET/POST /admin/usuarios` + `PATCH /admin/usuarios/:cuil`, `GET /admin/roles`. Búsqueda de empleados: `GET /empleados?q=`.
- Spec: `Backend/docs/superpowers/specs/2026-07-04-fase4-panel-admin-design.md`.

---

### Task 1: Backend — alta masiva de operarios

**Files:**
- Modify: `src/admin/dto/usuario.dto.ts` (agregar `CrearUsuariosMasivoDto`)
- Modify: `src/admin/admin.service.ts` (agregar `createUsuariosMasivo` + helpers)
- Modify: `src/admin/admin.controller.ts` (agregar `POST usuarios/masivo`)

Working dir: `Formulario_Horas/Backend`.

**Interfaces:**
- Produces: `POST /admin/usuarios/masivo` (`@Roles('Admin')`) body `{ cuils: string[] }` → `{ creados: { cuil, apellido_nombre, email, password }[], omitidos: { cuil, motivo }[] }`.

- [ ] **Step 1: Agregar el DTO en `src/admin/dto/usuario.dto.ts`**

Al final del archivo, agregar (y sumar `ArrayNotEmpty`, `IsArray` a los imports de `class-validator` si faltan):

```typescript
export class CrearUsuariosMasivoDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  cuils: string[];
}
```

- [ ] **Step 2: Agregar `createUsuariosMasivo` + helpers a `src/admin/admin.service.ts`**

Dentro de la clase `AdminService` (usa `NotFoundException` de `@nestjs/common` — agregarlo al import si falta):

```typescript
  async createUsuariosMasivo(cuils: string[]) {
    const rolOperario = await this.prisma.rol.findUnique({ where: { nombre: 'Operario' } });
    if (!rolOperario) throw new NotFoundException('No existe el rol Operario');

    const creados: { cuil: string; apellido_nombre: string; email: string; password: string }[] = [];
    const omitidos: { cuil: string; motivo: string }[] = [];

    for (const cuil of cuils) {
      const yaExiste = await this.prisma.usuario.findUnique({ where: { cuil } });
      if (yaExiste) {
        omitidos.push({ cuil, motivo: 'ya tiene usuario' });
        continue;
      }
      const emp = await this.prisma.snuempleados.findUnique({
        where: { cuil },
        select: { legajo: true, apellido_nombre: true, activo: true, borrado: true },
      });
      if (!emp || emp.activo !== 'S' || emp.borrado === 'S') {
        omitidos.push({ cuil, motivo: 'empleado inexistente o inactivo' });
        continue;
      }
      const email = await this.generarEmail(emp.legajo, cuil);
      const password = this.generarPassword();
      const passwordHash = await bcrypt.hash(password, 10);
      await this.prisma.usuario.create({
        data: { cuil, email, passwordHash, rolId: rolOperario.id },
      });
      creados.push({ cuil, apellido_nombre: emp.apellido_nombre, email, password });
    }
    return { creados, omitidos };
  }

  private async generarEmail(legajo: number, cuil: string): Promise<string> {
    const base = legajo && legajo > 0 ? String(legajo) : cuil;
    let email = `${base}@st.local`;
    let n = 1;
    while (await this.prisma.usuario.findUnique({ where: { email } })) {
      email = `${base}-${n}@st.local`;
      n++;
    }
    return email;
  }

  private generarPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let p = '';
    for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
    return p;
  }
```

- [ ] **Step 3: Exponer el endpoint en `src/admin/admin.controller.ts`**

Importar el DTO y agregar el handler (junto a los otros de usuarios):

```typescript
import { CreateUsuarioDto, UpdateUsuarioDto, CrearUsuariosMasivoDto } from './dto/usuario.dto';
```

```typescript
  @Post('usuarios/masivo')
  createUsuariosMasivo(@Body() dto: CrearUsuariosMasivoDto) {
    return this.service.createUsuariosMasivo(dto.cuils);
  }
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compila sin errores.

- [ ] **Step 5: Verificar en vivo**

Reiniciar backend (kill :3001, `node dist/src/main.js`). Con token admin (admin@test.local/admin1234), probar con 1 empleado sin usuario y 1 que ya tenga:

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login -H "Content-Type: application/json" -d '{"email":"admin@test.local","password":"admin1234"}' | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
curl -s -X POST http://localhost:3001/admin/usuarios/masivo -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"cuils":["20116635330","20999999999"]}'
```

Expected: `20116635330` (admin, ya existe) sale en `omitidos`; un cuil inexistente sale en `omitidos` con motivo. Probar con un cuil de empleado real sin usuario → aparece en `creados` con email `<legajo>@st.local` y `password`. **Al terminar, borrar los usuarios de prueba que hayas creado.** Reportar la salida.

- [ ] **Step 6: Commit**

```bash
git add src/admin
git commit -m "feat: alta masiva de operarios (email por legajo + password aleatoria)"
```

---

### Task 2: Frontend — hooks de API de Admin

**Files:**
- Create: `src/lib/api/admin.ts`

Working dir: `Formulario_Horas/Frontend`.

**Interfaces:**
- Consumes: `api` (`@/lib/api/client`), TanStack Query.
- Produces (tipos + hooks): `Rol`, `ContratoAdmin`, `TareaAdmin`, `MovilAdmin`, `ProvinciaAdmin`, `TipoNovedadAdmin`, `UsuarioAdmin`, `AltaMasivaResp`; hooks `useRoles`, `useContratosAdmin`, `useCrearContrato`, `useEditarContrato`, `useTareasAdmin(contratoId)`, `useCrearTarea`, `useToggleTarea`, `useMovilesAdmin`, `useCrearMovil`, `useToggleMovil`, `useProvinciasAdmin`, `useCrearProvincia`, `useTiposNovedadAdmin`, `useCrearTipoNovedad`, `useToggleTipoNovedad`, `useUsuariosAdmin`, `useCrearUsuario`, `useEditarUsuario`, `useCrearUsuariosMasivo`.

- [ ] **Step 1: Crear `src/lib/api/admin.ts`**

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface Rol { id: number; nombre: string }
export interface ContratoAdmin { id: number; codigo: string; nombre: string; activo: boolean; jefeContratoCuil: string | null; jefeContrato: { cuil: string; email: string } | null }
export interface TareaAdmin { id: number; nombre: string; contratoId: number; activo: boolean }
export interface MovilAdmin { id: number; identificador: string; descripcion: string | null; activo: boolean }
export interface ProvinciaAdmin { id: number; nombre: string }
export interface TipoNovedadAdmin { id: number; nombre: string; requiereAprobacionHys: boolean; generaPlus: boolean; activo: boolean }
export interface UsuarioAdmin {
  cuil: string; email: string; activo: boolean;
  rol: { nombre: string };
  empleado: { apellido_nombre: string };
  contratosHabilitados: { contrato: { codigo: string } }[];
}
export interface AltaMasivaResp {
  creados: { cuil: string; apellido_nombre: string; email: string; password: string }[];
  omitidos: { cuil: string; motivo: string }[];
}

const get = async <T>(url: string, params?: Record<string, unknown>) =>
  (await api.get<T>(url, params ? { params } : undefined)).data;

export function useRoles() {
  return useQuery({ queryKey: ['admin', 'roles'], queryFn: () => get<Rol[]>('/admin/roles') });
}

export function useContratosAdmin() {
  return useQuery({ queryKey: ['admin', 'contratos'], queryFn: () => get<ContratoAdmin[]>('/admin/contratos') });
}
export function useCrearContrato() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: { codigo: string; nombre: string; jefeContratoCuil?: string }) =>
      api.post('/admin/contratos', dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'contratos'] }),
  });
}
export function useEditarContrato() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: { id: number; nombre?: string; jefeContratoCuil?: string; activo?: boolean }) =>
      api.patch(`/admin/contratos/${id}`, dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'contratos'] }),
  });
}

export function useTareasAdmin(contratoId: number | null) {
  return useQuery({
    queryKey: ['admin', 'tareas', contratoId],
    enabled: contratoId != null,
    queryFn: () => get<TareaAdmin[]>('/admin/tareas', { contratoId }),
  });
}
export function useCrearTarea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: { contratoId: number; nombre: string }) => api.post('/admin/tareas', dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tareas'] }),
  });
}
export function useToggleTarea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, activo }: { id: number; activo: boolean }) =>
      api.patch(`/admin/tareas/${id}/activo`, { activo }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tareas'] }),
  });
}

export function useMovilesAdmin() {
  return useQuery({ queryKey: ['admin', 'moviles'], queryFn: () => get<MovilAdmin[]>('/admin/moviles') });
}
export function useCrearMovil() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: { identificador: string; descripcion?: string }) => api.post('/admin/moviles', dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'moviles'] }),
  });
}
export function useToggleMovil() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, activo }: { id: number; activo: boolean }) =>
      api.patch(`/admin/moviles/${id}/activo`, { activo }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'moviles'] }),
  });
}

export function useProvinciasAdmin() {
  return useQuery({ queryKey: ['admin', 'provincias'], queryFn: () => get<ProvinciaAdmin[]>('/admin/provincias') });
}
export function useCrearProvincia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: { nombre: string }) => api.post('/admin/provincias', dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'provincias'] }),
  });
}

export function useTiposNovedadAdmin() {
  return useQuery({ queryKey: ['admin', 'tipos-novedad'], queryFn: () => get<TipoNovedadAdmin[]>('/admin/tipos-novedad') });
}
export function useCrearTipoNovedad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: { nombre: string; requiereAprobacionHys?: boolean; generaPlus?: boolean }) =>
      api.post('/admin/tipos-novedad', dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tipos-novedad'] }),
  });
}
export function useToggleTipoNovedad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, activo }: { id: number; activo: boolean }) =>
      api.patch(`/admin/tipos-novedad/${id}/activo`, { activo }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tipos-novedad'] }),
  });
}

export function useUsuariosAdmin() {
  return useQuery({ queryKey: ['admin', 'usuarios'], queryFn: () => get<UsuarioAdmin[]>('/admin/usuarios') });
}
export function useCrearUsuario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: { cuil: string; email: string; password: string; rolId: number; contratosIds?: number[] }) =>
      api.post('/admin/usuarios', dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'usuarios'] }),
  });
}
export function useEditarUsuario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cuil, ...dto }: { cuil: string; email?: string; password?: string; rolId?: number; activo?: boolean; contratosIds?: number[] }) =>
      api.patch(`/admin/usuarios/${cuil}`, dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'usuarios'] }),
  });
}
export function useCrearUsuariosMasivo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cuils: string[]) =>
      api.post<AltaMasivaResp>('/admin/usuarios/masivo', { cuils }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'usuarios'] }),
  });
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npm run build`
Expected: compila sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/admin.ts
git commit -m "feat: hooks de API del panel admin"
```

---

### Task 3: Frontend — layout `/admin` con sub-nav + guard + redirect

**Files:**
- Create: `src/features/admin/admin-nav.ts`
- Create: `src/app/(protected)/admin/layout.tsx`
- Create: `src/app/(protected)/admin/page.tsx`

Working dir: `Formulario_Horas/Frontend`.

**Interfaces:**
- Consumes: `useSession` (`@/lib/auth/session`).
- Produces: sub-nav de admin; layout que exige rol Admin (si no, redirige a `/403`); `/admin` redirige a `/admin/usuarios`.

- [ ] **Step 1: Crear `src/features/admin/admin-nav.ts`**

```typescript
export const ADMIN_NAV = [
  { label: 'Usuarios', href: '/admin/usuarios' },
  { label: 'Contratos', href: '/admin/contratos' },
  { label: 'Tareas', href: '/admin/tareas' },
  { label: 'Móviles', href: '/admin/moviles' },
  { label: 'Provincias', href: '/admin/provincias' },
  { label: 'Tipos de novedad', href: '/admin/tipos-novedad' },
];
```

- [ ] **Step 2: Crear `src/app/(protected)/admin/layout.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/lib/auth/session';
import { ADMIN_NAV } from '@/features/admin/admin-nav';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { perfil } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const esAdmin = perfil?.rol?.nombre === 'Admin';

  useEffect(() => {
    if (perfil && !esAdmin) router.replace('/403');
  }, [perfil, esAdmin, router]);

  if (!perfil || !esAdmin) return null;

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-1 border-b border-line">
        {ADMIN_NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
                active ? 'border-brand font-medium text-ink' : 'border-transparent text-slate hover:text-ink'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Crear `src/app/(protected)/admin/page.tsx` (redirect)**

```tsx
import { redirect } from 'next/navigation';

export default function AdminIndex() {
  redirect('/admin/usuarios');
}
```

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: build OK (rutas `/admin`, `/admin/usuarios` aún no — se crean en tasks siguientes; el redirect a `/admin/usuarios` compilará aunque la ruta destino se agregue después, pero para que no falle el prerender, esta task se valida junto con Task 4 que crea `/admin/usuarios`). Si el build se queja por la ruta faltante, continuar: la Task 4 la crea.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(protected)/admin/layout.tsx" "src/app/(protected)/admin/page.tsx" src/features/admin/admin-nav.ts
git commit -m "feat: layout /admin con sub-nav y guard de rol Admin"
```

---

### Task 4: Frontend — Provincias y Móviles (ABM simples)

**Files:**
- Create: `src/features/admin/pill-activo.tsx`
- Create: `src/app/(protected)/admin/provincias/page.tsx`
- Create: `src/app/(protected)/admin/moviles/page.tsx`
- Test: `src/app/(protected)/admin/moviles/moviles-page.test.tsx`

Working dir: `Formulario_Horas/Frontend`. TDD para Móviles.

**Interfaces:**
- Consumes: `useProvinciasAdmin`, `useCrearProvincia`, `useMovilesAdmin`, `useCrearMovil`, `useToggleMovil` (`@/lib/api/admin`), `PageHeader`, `toast`.
- Produces: `PillActivo` (badge activo/inactivo con toggle), páginas `/admin/provincias` y `/admin/moviles`.

- [ ] **Step 1: Crear `src/features/admin/pill-activo.tsx`**

```tsx
'use client';

export function PillActivo({
  activo,
  onToggle,
  disabled,
}: {
  activo: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition disabled:opacity-50 ${
        activo
          ? 'bg-approved/10 text-approved ring-approved/25 hover:bg-approved/20'
          : 'bg-slate/10 text-slate ring-slate/25 hover:bg-slate/20'
      }`}
    >
      {activo ? 'Activo' : 'Inactivo'}
    </button>
  );
}
```

- [ ] **Step 2: Crear `src/app/(protected)/admin/provincias/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
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
            <li key={p.id} className="px-4 py-2.5 text-sm text-ink">{p.nombre}</li>
          ))}
          {(data ?? []).length === 0 && <li className="px-4 py-2.5 text-sm text-slate">Sin provincias.</li>}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Escribir el test de Móviles (falla primero)**

Create: `src/app/(protected)/admin/moviles/moviles-page.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const crear = vi.fn().mockResolvedValue({});
const toggle = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/admin', () => ({
  useMovilesAdmin: () => ({ data: [{ id: 1, identificador: 'INT-101', descripcion: 'Camioneta', activo: true }], isLoading: false }),
  useCrearMovil: () => ({ mutateAsync: crear, isPending: false }),
  useToggleMovil: () => ({ mutateAsync: toggle, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import MovilesAdminPage from './page';

describe('MovilesAdminPage', () => {
  beforeEach(() => { crear.mockClear(); toggle.mockClear(); });

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
});
```

- [ ] **Step 4: Correr para verlo fallar**

Run: `npm test -- moviles-page`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 5: Crear `src/app/(protected)/admin/moviles/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { PillActivo } from '@/features/admin/pill-activo';
import { useMovilesAdmin, useCrearMovil, useToggleMovil } from '@/lib/api/admin';

export default function MovilesAdminPage() {
  const { data, isLoading } = useMovilesAdmin();
  const crear = useCrearMovil();
  const toggle = useToggleMovil();
  const [identificador, setIdentificador] = useState('');
  const [descripcion, setDescripcion] = useState('');

  function agregar() {
    if (!identificador.trim()) return;
    toast.promise(
      crear.mutateAsync({ identificador: identificador.trim(), descripcion: descripcion.trim() || undefined }),
      { loading: 'Guardando…', success: 'Móvil creado', error: 'No se pudo crear' },
    );
    setIdentificador('');
    setDescripcion('');
  }

  function cambiarActivo(id: number, activo: boolean) {
    toast.promise(toggle.mutateAsync({ id, activo }), {
      loading: 'Actualizando…',
      success: 'Móvil actualizado',
      error: 'No se pudo actualizar',
    });
  }

  return (
    <section className="space-y-5">
      <PageHeader eyebrow="Admin" title="Móviles" />
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Identificador"
          value={identificador}
          onChange={(e) => setIdentificador(e.target.value)}
          placeholder="Identificador (interno/patente)"
          className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <input
          aria-label="Descripción"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Descripción (opcional)"
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
          {(data ?? []).map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="font-medium text-ink">{m.identificador}</span>
              <span className="text-slate">{m.descripcion ?? ''}</span>
              <span className="ml-auto">
                <PillActivo activo={m.activo} disabled={toggle.isPending} onToggle={() => cambiarActivo(m.id, !m.activo)} />
              </span>
            </div>
          ))}
          {(data ?? []).length === 0 && <div className="px-4 py-2.5 text-sm text-slate">Sin móviles.</div>}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Correr el test (pasa)**

Run: `npm test -- moviles-page`
Expected: PASS (2 tests).

- [ ] **Step 7: Build y commit**

Run: `npm run build`
Expected: build OK (rutas `/admin/provincias`, `/admin/moviles`).

```bash
git add "src/app/(protected)/admin/provincias" "src/app/(protected)/admin/moviles" src/features/admin/pill-activo.tsx
git commit -m "feat: admin Provincias y Moviles (ABM + toggle)"
```

---

### Task 5: Frontend — Tipos de novedad

**Files:**
- Create: `src/app/(protected)/admin/tipos-novedad/page.tsx`

Working dir: `Formulario_Horas/Frontend`.

**Interfaces:**
- Consumes: `useTiposNovedadAdmin`, `useCrearTipoNovedad`, `useToggleTipoNovedad` (`@/lib/api/admin`), `PillActivo`, `PageHeader`, `toast`.

- [ ] **Step 1: Crear `src/app/(protected)/admin/tipos-novedad/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { PillActivo } from '@/features/admin/pill-activo';
import { useTiposNovedadAdmin, useCrearTipoNovedad, useToggleTipoNovedad } from '@/lib/api/admin';

export default function TiposNovedadAdminPage() {
  const { data, isLoading } = useTiposNovedadAdmin();
  const crear = useCrearTipoNovedad();
  const toggle = useToggleTipoNovedad();
  const [nombre, setNombre] = useState('');
  const [requiereHys, setRequiereHys] = useState(false);
  const [generaPlus, setGeneraPlus] = useState(false);

  function agregar() {
    if (!nombre.trim()) return;
    toast.promise(
      crear.mutateAsync({ nombre: nombre.trim(), requiereAprobacionHys: requiereHys, generaPlus }),
      { loading: 'Guardando…', success: 'Tipo creado', error: 'No se pudo crear' },
    );
    setNombre('');
    setRequiereHys(false);
    setGeneraPlus(false);
  }

  return (
    <section className="space-y-5">
      <PageHeader eyebrow="Admin" title="Tipos de novedad" />
      <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <input
          aria-label="Nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre (ej. Ausencia)"
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <div className="flex flex-wrap gap-4 text-sm text-ink">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={requiereHys} onChange={(e) => setRequiereHys(e.target.checked)} />
            Requiere aprobación de HyS
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={generaPlus} onChange={(e) => setGeneraPlus(e.target.checked)} />
            Genera plus
          </label>
        </div>
        <button
          type="button"
          disabled={crear.isPending}
          onClick={agregar}
          className="rounded-md bg-brand px-4 py-2 font-medium text-ink transition hover:brightness-95 disabled:opacity-50"
        >
          Agregar tipo
        </button>
      </div>
      {isLoading ? (
        <p className="text-slate">Cargando…</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface divide-y divide-line">
          {(data ?? []).map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="font-medium text-ink">{t.nombre}</span>
              {t.requiereAprobacionHys && <span className="rounded bg-accent px-1.5 py-0.5 text-xs text-brand-deep">HyS</span>}
              {t.generaPlus && <span className="rounded bg-accent px-1.5 py-0.5 text-xs text-brand-deep">plus</span>}
              <span className="ml-auto">
                <PillActivo activo={t.activo} disabled={toggle.isPending} onToggle={() =>
                  toast.promise(toggle.mutateAsync({ id: t.id, activo: !t.activo }), {
                    loading: 'Actualizando…', success: 'Tipo actualizado', error: 'No se pudo actualizar',
                  })
                } />
              </span>
            </div>
          ))}
          {(data ?? []).length === 0 && <div className="px-4 py-2.5 text-sm text-slate">Sin tipos de novedad.</div>}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Build y commit**

Run: `npm run build`
Expected: build OK.

```bash
git add "src/app/(protected)/admin/tipos-novedad"
git commit -m "feat: admin Tipos de novedad (ABM + flags + toggle)"
```

---

### Task 6: Frontend — Contratos

**Files:**
- Create: `src/app/(protected)/admin/contratos/page.tsx`

Working dir: `Formulario_Horas/Frontend`.

**Interfaces:**
- Consumes: `useContratosAdmin`, `useCrearContrato`, `useEditarContrato` (`@/lib/api/admin`), `PillActivo`, `PageHeader`, `toast`.

- [ ] **Step 1: Crear `src/app/(protected)/admin/contratos/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { PillActivo } from '@/features/admin/pill-activo';
import { useContratosAdmin, useCrearContrato, useEditarContrato } from '@/lib/api/admin';

export default function ContratosAdminPage() {
  const { data, isLoading } = useContratosAdmin();
  const crear = useCrearContrato();
  const editar = useEditarContrato();
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');

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
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="font-medium text-ink">{c.codigo}</span>
              <span className="text-slate">{c.nombre}</span>
              {c.jefeContrato && <span className="text-xs text-slate">jefe: {c.jefeContrato.email}</span>}
              <span className="ml-auto">
                <PillActivo activo={c.activo} disabled={editar.isPending} onToggle={() => cambiarActivo(c.id, !c.activo)} />
              </span>
            </div>
          ))}
          {(data ?? []).length === 0 && <div className="px-4 py-2.5 text-sm text-slate">Sin contratos.</div>}
        </div>
      )}
    </section>
  );
}
```

> Nota: la asignación del jefe de contrato se edita por API (`jefeContratoCuil`); en esta UI se muestra el jefe actual y se administran código/nombre/activo. Asignar jefe queda como mejora posterior (requiere buscar entre usuarios con login).

- [ ] **Step 2: Build y commit**

Run: `npm run build`
Expected: build OK.

```bash
git add "src/app/(protected)/admin/contratos"
git commit -m "feat: admin Contratos (crear + activar/desactivar)"
```

---

### Task 7: Frontend — Tareas (por contrato)

**Files:**
- Create: `src/app/(protected)/admin/tareas/page.tsx`

Working dir: `Formulario_Horas/Frontend`.

**Interfaces:**
- Consumes: `useContratosAdmin`, `useTareasAdmin(contratoId)`, `useCrearTarea`, `useToggleTarea` (`@/lib/api/admin`), `PillActivo`, `PageHeader`, `toast`.

- [ ] **Step 1: Crear `src/app/(protected)/admin/tareas/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { PillActivo } from '@/features/admin/pill-activo';
import { useContratosAdmin, useTareasAdmin, useCrearTarea, useToggleTarea } from '@/lib/api/admin';

export default function TareasAdminPage() {
  const { data: contratos } = useContratosAdmin();
  const [contratoId, setContratoId] = useState<number | null>(null);
  const { data: tareas, isLoading } = useTareasAdmin(contratoId);
  const crear = useCrearTarea();
  const toggle = useToggleTarea();
  const [nombre, setNombre] = useState('');

  function agregar() {
    if (contratoId == null || !nombre.trim()) return;
    toast.promise(crear.mutateAsync({ contratoId, nombre: nombre.trim() }), {
      loading: 'Guardando…',
      success: 'Tarea creada',
      error: 'No se pudo crear',
    });
    setNombre('');
  }

  return (
    <section className="space-y-5">
      <PageHeader eyebrow="Admin" title="Tareas" />
      <label className="flex flex-col text-sm font-medium text-ink sm:max-w-xs">
        Contrato
        <select
          aria-label="Contrato"
          value={contratoId ?? ''}
          onChange={(e) => setContratoId(e.target.value ? Number(e.target.value) : null)}
          className="mt-1 rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        >
          <option value="">Elegí un contrato…</option>
          {(contratos ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
          ))}
        </select>
      </label>

      {contratoId != null && (
        <>
          <div className="flex gap-2">
            <input
              aria-label="Tarea"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nueva tarea (ej. Excavación)"
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
              {(tareas ?? []).map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="font-medium text-ink">{t.nombre}</span>
                  <span className="ml-auto">
                    <PillActivo activo={t.activo} disabled={toggle.isPending} onToggle={() =>
                      toast.promise(toggle.mutateAsync({ id: t.id, activo: !t.activo }), {
                        loading: 'Actualizando…', success: 'Tarea actualizada', error: 'No se pudo actualizar',
                      })
                    } />
                  </span>
                </div>
              ))}
              {(tareas ?? []).length === 0 && <div className="px-4 py-2.5 text-sm text-slate">Este contrato no tiene tareas.</div>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Build y commit**

Run: `npm run build`
Expected: build OK.

```bash
git add "src/app/(protected)/admin/tareas"
git commit -m "feat: admin Tareas por contrato (crear + toggle)"
```

---

### Task 8: Frontend — Usuarios (lista + alta individual)

**Files:**
- Create: `src/app/(protected)/admin/usuarios/page.tsx`
- Create: `src/features/admin/usuario-form.tsx`
- Test: `src/features/admin/usuario-form.test.tsx`

Working dir: `Formulario_Horas/Frontend`. TDD para el form.

**Interfaces:**
- Consumes: `useUsuariosAdmin`, `useEditarUsuario`, `useCrearUsuario`, `useRoles` (`@/lib/api/admin`), `useContratosAdmin`, `OperariosSelect` (`@/features/reporte/operarios-select`), `PillActivo` (`@/features/admin/pill-activo`), `PageHeader`, `toast`.
- Produces: `UsuarioForm({ onCreado })` (alta individual); página `/admin/usuarios` (lista con toggle activo + form; el alta masiva se integra en Task 9). Edición completa de email/rol/contraseña queda como follow-up.

- [ ] **Step 1: Escribir el test del form (falla primero)**

Create: `src/features/admin/usuario-form.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const crear = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/admin', () => ({
  useCrearUsuario: () => ({ mutateAsync: crear, isPending: false }),
  useRoles: () => ({ data: [{ id: 1, nombre: 'Operario' }, { id: 2, nombre: 'JefeCuadrilla' }] }),
  useContratosAdmin: () => ({ data: [{ id: 5, codigo: 'K5', nombre: 'K5', activo: true, jefeContratoCuil: null, jefeContrato: null }] }),
}));
vi.mock('@/lib/api/empleados', () => ({
  useBuscarEmpleados: () => ({ data: [{ cuil: '20169', apellido_nombre: 'GOMEZ', legajo: 1, cargo: 'OF' }] }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import { UsuarioForm } from './usuario-form';

describe('UsuarioForm', () => {
  beforeEach(() => crear.mockClear());

  it('crea un usuario con empleado, email, contraseña y rol', async () => {
    render(<UsuarioForm onCreado={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/buscar operario/i), 'gomez');
    await userEvent.click(await screen.findByText(/GOMEZ/));
    await userEvent.type(screen.getByLabelText('Email'), 'gomez@st.local');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'secreto12');
    await userEvent.selectOptions(screen.getByLabelText('Rol'), '2');
    await userEvent.click(screen.getByRole('button', { name: /crear usuario/i }));
    await waitFor(() =>
      expect(crear).toHaveBeenCalledWith(
        expect.objectContaining({ cuil: '20169', email: 'gomez@st.local', password: 'secreto12', rolId: 2 }),
      ),
    );
  });
});
```

- [ ] **Step 2: Correr para verlo fallar**

Run: `npm test -- usuario-form`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Crear `src/features/admin/usuario-form.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { OperariosSelect } from '@/features/reporte/operarios-select';
import { useCrearUsuario, useRoles, useContratosAdmin } from '@/lib/api/admin';
import type { EmpleadoBusqueda } from '@/types/domain';

export function UsuarioForm({ onCreado }: { onCreado: () => void }) {
  const crear = useCrearUsuario();
  const { data: roles } = useRoles();
  const { data: contratos } = useContratosAdmin();
  const [empleado, setEmpleado] = useState<EmpleadoBusqueda[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rolId, setRolId] = useState<number | null>(null);
  const [contratosIds, setContratosIds] = useState<number[]>([]);

  const puede = empleado.length === 1 && email.trim() !== '' && password.length >= 8 && rolId != null;

  function toggleContrato(id: number) {
    setContratosIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function enviar() {
    if (!puede || rolId == null) return;
    const promesa = crear.mutateAsync({
      cuil: empleado[0].cuil,
      email: email.trim(),
      password,
      rolId,
      contratosIds: contratosIds.length ? contratosIds : undefined,
    });
    toast.promise(promesa, { loading: 'Creando usuario…', success: 'Usuario creado', error: 'No se pudo crear el usuario' });
    try {
      await promesa;
      setEmpleado([]); setEmail(''); setPassword(''); setRolId(null); setContratosIds([]);
      onCreado();
    } catch {
      // toast.promise ya avisó
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <h2 className="font-display text-sm font-semibold text-ink">Nuevo usuario</h2>
      <div className="space-y-1">
        <span className="text-sm font-medium text-ink">Empleado</span>
        <OperariosSelect value={empleado} onChange={(v) => setEmpleado(v.slice(-1))} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          Email
          <input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-ink">
          Contraseña
          <input aria-label="Contraseña" type="text" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="mínimo 8 caracteres"
            className="rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium text-ink sm:max-w-xs">
        Rol
        <select aria-label="Rol" value={rolId ?? ''} onChange={(e) => setRolId(e.target.value ? Number(e.target.value) : null)}
          className="rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30">
          <option value="">—</option>
          {(roles ?? []).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
      </label>
      <div>
        <p className="text-sm font-medium text-ink">Contratos habilitados (para roles que cargan)</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(contratos ?? []).map((c) => {
            const on = contratosIds.includes(c.id);
            return (
              <button key={c.id} type="button" onClick={() => toggleContrato(c.id)}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? 'border-brand bg-accent font-medium text-ink' : 'border-line text-slate hover:border-brand/50'}`}>
                {c.codigo}
              </button>
            );
          })}
        </div>
      </div>
      <button type="button" disabled={!puede || crear.isPending} onClick={enviar}
        className="rounded-md bg-brand px-4 py-2 font-medium text-ink transition hover:brightness-95 disabled:opacity-50">
        {crear.isPending ? 'Creando…' : 'Crear usuario'}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Correr el test (pasa)**

Run: `npm test -- usuario-form`
Expected: PASS.

- [ ] **Step 5: Crear `src/app/(protected)/admin/usuarios/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { PillActivo } from '@/features/admin/pill-activo';
import { UsuarioForm } from '@/features/admin/usuario-form';
import { useUsuariosAdmin, useEditarUsuario } from '@/lib/api/admin';

export default function UsuariosAdminPage() {
  const { data, isLoading } = useUsuariosAdmin();
  const editar = useEditarUsuario();
  const [modo, setModo] = useState<null | 'individual'>(null);

  function cambiarActivo(cuil: string, activo: boolean) {
    toast.promise(editar.mutateAsync({ cuil, activo }), {
      loading: 'Actualizando…',
      success: 'Usuario actualizado',
      error: 'No se pudo actualizar',
    });
  }

  return (
    <section className="space-y-5">
      <PageHeader
        eyebrow="Admin"
        title="Usuarios"
        action={
          <button
            type="button"
            onClick={() => setModo((m) => (m === 'individual' ? null : 'individual'))}
            className="rounded-md bg-brand px-4 py-2 font-medium text-ink transition hover:brightness-95"
          >
            {modo === 'individual' ? 'Cerrar' : 'Nuevo usuario'}
          </button>
        }
      />

      {modo === 'individual' && <UsuarioForm onCreado={() => setModo(null)} />}

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
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((u) => (
                <tr key={u.cuil} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 text-ink">{u.empleado.apellido_nombre}</td>
                  <td className="px-4 py-2.5 text-slate">{u.email}</td>
                  <td className="px-4 py-2.5 text-ink">{u.rol.nombre}</td>
                  <td className="px-4 py-2.5 text-slate">{u.contratosHabilitados.map((c) => c.contrato.codigo).join(', ') || '—'}</td>
                  <td className="px-4 py-2.5">
                    <PillActivo activo={u.activo} disabled={editar.isPending} onToggle={() => cambiarActivo(u.cuil, !u.activo)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Correr tests y build**

Run: `npm test -- usuario-form`
Expected: PASS.

Run: `npm run build`
Expected: build OK (ruta `/admin/usuarios`).

- [ ] **Step 7: Commit**

```bash
git add "src/app/(protected)/admin/usuarios" src/features/admin/usuario-form.tsx src/features/admin/usuario-form.test.tsx
git commit -m "feat: admin Usuarios (lista + alta individual)"
```

---

### Task 9: Frontend — Alta masiva de operarios

**Files:**
- Create: `src/features/admin/alta-masiva.tsx`
- Modify: `src/app/(protected)/admin/usuarios/page.tsx` (agregar el botón + panel de alta masiva)
- Test: `src/features/admin/alta-masiva.test.tsx`

Working dir: `Formulario_Horas/Frontend`. TDD.

**Interfaces:**
- Consumes: `useCrearUsuariosMasivo` (`@/lib/api/admin`), `OperariosSelect`, `toast`.
- Produces: `AltaMasiva({ onListo })` — multiselect de empleados → genera → tabla de credenciales (creados) + lista de omitidos.

- [ ] **Step 1: Escribir el test (falla primero)**

Create: `src/features/admin/alta-masiva.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mutateAsync = vi.fn().mockResolvedValue({
  creados: [{ cuil: '20169', apellido_nombre: 'GOMEZ', email: '10714@st.local', password: 'Ab12Cd34Ef' }],
  omitidos: [],
});

vi.mock('@/lib/api/admin', () => ({ useCrearUsuariosMasivo: () => ({ mutateAsync, isPending: false }) }));
vi.mock('@/lib/api/empleados', () => ({
  useBuscarEmpleados: () => ({ data: [{ cuil: '20169', apellido_nombre: 'GOMEZ', legajo: 10714, cargo: 'OF' }] }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import { AltaMasiva } from './alta-masiva';

describe('AltaMasiva', () => {
  beforeEach(() => mutateAsync.mockClear());

  it('genera usuarios y muestra las credenciales', async () => {
    render(<AltaMasiva onListo={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/buscar operario/i), 'gomez');
    await userEvent.click(await screen.findByText(/GOMEZ/));
    await userEvent.click(screen.getByRole('button', { name: /generar usuarios/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(['20169']));
    expect(await screen.findByText('10714@st.local')).toBeInTheDocument();
    expect(screen.getByText('Ab12Cd34Ef')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr para verlo fallar**

Run: `npm test -- alta-masiva`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Crear `src/features/admin/alta-masiva.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { OperariosSelect } from '@/features/reporte/operarios-select';
import { useCrearUsuariosMasivo, type AltaMasivaResp } from '@/lib/api/admin';
import type { EmpleadoBusqueda } from '@/types/domain';

export function AltaMasiva({ onListo }: { onListo: () => void }) {
  const crear = useCrearUsuariosMasivo();
  const [empleados, setEmpleados] = useState<EmpleadoBusqueda[]>([]);
  const [resultado, setResultado] = useState<AltaMasivaResp | null>(null);

  async function generar() {
    if (empleados.length === 0) return;
    const promesa = crear.mutateAsync(empleados.map((e) => e.cuil));
    toast.promise(promesa, {
      loading: 'Generando usuarios…',
      success: 'Usuarios generados',
      error: 'No se pudo generar',
    });
    try {
      const resp = await promesa;
      setResultado(resp);
      setEmpleados([]);
      onListo();
    } catch {
      // toast.promise ya avisó
    }
  }

  function copiar() {
    if (!resultado) return;
    const texto = resultado.creados
      .map((c) => `${c.apellido_nombre}\t${c.email}\t${c.password}`)
      .join('\n');
    void navigator.clipboard?.writeText(texto);
    toast.success('Credenciales copiadas');
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <h2 className="font-display text-sm font-semibold text-ink">Alta masiva de operarios</h2>
      <p className="text-xs text-slate">
        Elegí empleados y generá sus logins de solo consulta (rol Operario). Se crea email por legajo y contraseña aleatoria.
      </p>
      <OperariosSelect value={empleados} onChange={setEmpleados} />
      <button
        type="button"
        disabled={empleados.length === 0 || crear.isPending}
        onClick={generar}
        className="rounded-md bg-brand px-4 py-2 font-medium text-ink transition hover:brightness-95 disabled:opacity-50"
      >
        {crear.isPending ? 'Generando…' : `Generar usuarios (${empleados.length})`}
      </button>

      {resultado && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-ink">Credenciales generadas ({resultado.creados.length})</h3>
            {resultado.creados.length > 0 && (
              <button type="button" onClick={copiar} className="rounded-md border border-line px-3 py-1 text-xs text-slate hover:bg-accent/60">
                Copiar
              </button>
            )}
          </div>
          {resultado.creados.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-slate">
                    <th className="px-3 py-2 font-medium">Empleado</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Contraseña</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.creados.map((c) => (
                    <tr key={c.cuil} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 text-ink">{c.apellido_nombre}</td>
                      <td className="px-3 py-2 font-mono text-slate">{c.email}</td>
                      <td className="px-3 py-2 font-mono text-ink">{c.password}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {resultado.omitidos.length > 0 && (
            <p className="text-xs text-slate">
              Omitidos: {resultado.omitidos.map((o) => `${o.cuil} (${o.motivo})`).join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Correr el test (pasa)**

Run: `npm test -- alta-masiva`
Expected: PASS.

- [ ] **Step 5: Integrar en `src/app/(protected)/admin/usuarios/page.tsx`**

Ampliar el estado `modo` para incluir `'masiva'` y agregar un segundo botón + el panel. Reemplazar la línea del estado y el bloque de acciones/paneles:

Cambiar:
```tsx
  const [modo, setModo] = useState<null | 'individual'>(null);
```
por:
```tsx
  const [modo, setModo] = useState<null | 'individual' | 'masiva'>(null);
```

Agregar el import:
```tsx
import { AltaMasiva } from '@/features/admin/alta-masiva';
```

Reemplazar el `action` del `PageHeader` por dos botones:
```tsx
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
```

Y debajo del `{modo === 'individual' && <UsuarioForm … />}` agregar:
```tsx
      {modo === 'masiva' && <AltaMasiva onListo={() => {}} />}
```

- [ ] **Step 6: Correr tests y build**

Run: `npm test -- alta-masiva usuario-form`
Expected: PASS.

Run: `npm run build`
Expected: build OK.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(protected)/admin/usuarios" src/features/admin/alta-masiva.tsx src/features/admin/alta-masiva.test.tsx
git commit -m "feat: admin alta masiva de operarios (credenciales generadas)"
```

---

### Task 10: Frontend — verificación final de la fase

**Files:** (ninguno nuevo; verificación)

Working dir: `Formulario_Horas/Frontend`.

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: PASS (todos: fases previas + los nuevos de admin — moviles, usuario-form, alta-masiva).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build OK; rutas `/admin`, `/admin/usuarios`, `/admin/contratos`, `/admin/tareas`, `/admin/moviles`, `/admin/provincias`, `/admin/tipos-novedad`.

- [ ] **Step 4: (Si hubo fixes de lint) commit**

```bash
git add -A
git commit -m "chore: verificacion final Fase 4"
```

Si no hubo cambios, omitir.

---

## Notas de cierre

- Backend (Task 1) commitea en `formulario-horas-backend`; frontend (Tasks 2–10) en `formulario-horas-frontend`.
- E2E manual: como Admin (`admin@test.local`/`admin1234`) → `/admin` → recorrer las 6 secciones: crear una provincia/móvil/tipo/contrato/tarea, y en Usuarios probar alta individual y **alta masiva** (elegir 1–2 empleados sin usuario → generar → ver credenciales). Borrar/inactivar lo de prueba al terminar.
- Al terminar, actualizar `Backend/.claude/Contexto/contexto-proyecto.md` marcando la Fase 4 completa; con esto quedan las 4 fases. Pendiente global restante: flujo de cambio de contraseña y la vista SQL de liquidación (externo).
