# Fase 3 — Aprobaciones + Novedades + Ausencias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir las tres bandejas de flujo — Aprobaciones (Jefe de Contrato, scopeada a sus contratos con contexto), Novedades (Supervisor) y Ausencias (HyS) — más los 3 endpoints de backend que faltan.

**Architecture:** Backend NestJS suma un GET de catálogo (tipos de novedad), un endpoint `por-aprobar` que agrupa por (operario, fecha) devolviendo contexto con flag `accionable`, y refuerza la autorización de `resolver`/`reabrir` por contrato. Frontend Next.js suma tres páginas dentro de `(protected)` con hooks de TanStack Query, una utilidad pura de agrupación y formularios/diálogos.

**Tech Stack:** NestJS 11 + Prisma 7 (backend); Next.js 16 + TS + Tailwind v4 + shadcn/ui + TanStack Query v5 + React Hook Form + Zod + Vitest/RTL (frontend).

## Global Constraints

- **Dos repos:** backend en `Formulario_Horas/Backend` (`formulario-horas-backend`), frontend en `Formulario_Horas/Frontend` (`formulario-horas-frontend`). Cada tarea commitea en su repo, rama `main`, sin ramas nuevas.
- Backend API base `http://localhost:3001`; frontend lee `NEXT_PUBLIC_API_URL`.
- **Nunca** `prisma db push`/`migrate` (BD compartida). DDL a mano (no aplica en esta fase: no hay cambios de schema).
- Roles: `Operario, JefeCuadrilla, JefeContrato, Supervisor, HyS, Admin`.
- Aprobar horas / reabrir: solo `JefeContrato` (de **su** contrato) y `Admin`. Resolver novedades HyS: `HyS`, `Admin`. Crear novedades: `Supervisor`, `JefeContrato`, `Admin`.
- La bandeja del Jefe de Contrato agrupa por **(operario, fecha)**; muestra filas de otros contratos como **contexto** (`accionable=false`), y solo actúa sobre las filas de sus contratos.
- Registro `estado`: `pendiente|aprobado|desaprobado`. Novedad `estadoHys`: `pendiente|aprobada|desaprobada|no_aplica`.
- `INCLUDE_BASICO` de registros = `{ operario{cuil,apellido_nombre}, contrato{id,codigo,nombre}, tarea{id,nombre}, provincia{id,nombre}, moviles{movil{id,identificador}} }`.
- Usuarios de prueba: `admin@test.local`/`admin1234`, `jefecuadrilla@test.local`/`jdc12345`, `operario@test.local`/`oper1234`.
- Spec: `Backend/docs/superpowers/specs/2026-07-03-fase3-aprobaciones-novedades-ausencias-design.md`.

---

### Task 1: Backend — `GET /catalogos/tipos-novedad` + `GET /registros-horas/por-aprobar`

**Files:**
- Modify: `src/catalogos/catalogos.service.ts`, `src/catalogos/catalogos.controller.ts`
- Modify: `src/registros-horas/registros-horas.service.ts`, `src/registros-horas/registros-horas.controller.ts`

Working dir: `Formulario_Horas/Backend`.

**Interfaces:**
- Produces:
  - `GET /catalogos/tipos-novedad` → `{ id, nombre, requiereAprobacionHys }[]` (activos).
  - `GET /registros-horas/por-aprobar` (`JefeContrato`/`Admin`) → filas pendientes de los pares (operario, fecha) con ≥1 fila del/los contrato(s) del jefe, cada una con `accionable: boolean`.

- [ ] **Step 1: Agregar `getTiposNovedad()` a `catalogos.service.ts`**

Agregar el método dentro de la clase `CatalogosService`:

```typescript
  getTiposNovedad() {
    return this.prisma.tipoNovedad.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, requiereAprobacionHys: true },
      orderBy: { nombre: 'asc' },
    });
  }
```

- [ ] **Step 2: Exponerlo en `catalogos.controller.ts`**

Agregar el handler dentro de `CatalogosController`:

```typescript
  @Get('tipos-novedad')
  getTiposNovedad() {
    return this.service.getTiposNovedad();
  }
```

- [ ] **Step 3: Agregar `porAprobar()` a `registros-horas.service.ts`**

Agregar el método dentro de `RegistrosHorasService` (usa el `INCLUDE_BASICO` ya definido en el archivo):

```typescript
  async porAprobar(usuario: { cuil: string; rol: string }) {
    // 1) Contratos de los que el usuario es jefe (Admin = todos)
    const contratos = await this.prisma.contrato.findMany({
      where: usuario.rol === 'Admin' ? {} : { jefeContratoCuil: usuario.cuil },
      select: { id: true },
    });
    const misContratoIds = contratos.map((c) => c.id);
    if (misContratoIds.length === 0) return [];

    // 2) Pares (operario, fecha) con al menos una fila pendiente en mis contratos
    const pares = await this.prisma.registroHoras.findMany({
      where: { estado: 'pendiente', contratoId: { in: misContratoIds } },
      select: { operarioCuil: true, fecha: true },
      distinct: ['operarioCuil', 'fecha'],
    });
    if (pares.length === 0) return [];

    // 3) Todas las filas pendientes de esos pares (incluye otros contratos = contexto)
    const filas = await this.prisma.registroHoras.findMany({
      where: {
        estado: 'pendiente',
        OR: pares.map((p) => ({ operarioCuil: p.operarioCuil, fecha: p.fecha })),
      },
      include: INCLUDE_BASICO,
      orderBy: [{ fecha: 'desc' }, { operarioCuil: 'asc' }],
    });

    const setIds = new Set(misContratoIds);
    return filas.map((f) => ({ ...f, accionable: setIds.has(f.contratoId) }));
  }
```

- [ ] **Step 4: Exponer `por-aprobar` en `registros-horas.controller.ts`**

Agregar el handler (ubicarlo **antes** del `@Get()` genérico no es necesario porque la ruta es literal `por-aprobar`, pero sí antes del `@Patch(':id')` no aplica). Colocarlo junto al `@Get()`:

```typescript
  @Get('por-aprobar')
  @Roles('JefeContrato', 'Admin')
  porAprobar(@Request() req) {
    return this.service.porAprobar({ cuil: req.user.cuil, rol: req.user.rol });
  }
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: compila sin errores.

- [ ] **Step 6: Verificar en vivo**

Reiniciar backend (matar el proceso en :3001 y `node dist/src/main.js`). Necesitás datos: asegurate de que exista un Jefe de Contrato de K5. Como el seed de prueba no define jefe de K5, seteá el admin como jefe de K5 para probar, y creá un par de registros pendientes:

```bash
# (script node ad-hoc) set jefeContratoCuil de K5 = admin, y crear 1 registro pendiente via /batch con el JdC
```

Probar con token admin:
```bash
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login -H "Content-Type: application/json" -d '{"email":"admin@test.local","password":"admin1234"}' | sed -E 's/.*"access_token":"([^"]+)".*/\1/')
curl -s "http://localhost:3001/catalogos/tipos-novedad" -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:3001/registros-horas/por-aprobar" -H "Authorization: Bearer $TOKEN"
```

Expected: `tipos-novedad` responde `[]` (o los tipos si hay). `por-aprobar` (admin = todos los contratos) devuelve las filas pendientes existentes con `"accionable":true`. HTTP 200. Reportar las salidas reales. Limpiar los registros de prueba creados al terminar.

- [ ] **Step 7: Commit**

```bash
git add src/catalogos src/registros-horas
git commit -m "feat: catalogos tipos-novedad + endpoint por-aprobar (scope jefe + contexto)"
```

---

### Task 2: Backend — autorización por contrato en `resolver` y `reabrir`

**Files:**
- Modify: `src/registros-horas/registros-horas.service.ts` (métodos `resolver`, `reabrir`)
- Modify: `src/registros-horas/registros-horas.controller.ts` (pasar `{cuil, rol}`)

Working dir: `Formulario_Horas/Backend`.

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `resolver(id, dto, usuario: {cuil, rol})` y `reabrir(id, usuario: {cuil, rol})` que rechazan con 403 si el usuario no es Admin ni jefe del contrato de esa fila.

- [ ] **Step 1: Cambiar la firma y el check en `resolver` (service)**

Reemplazar el encabezado del método `resolver` (la carga del registro y la validación). El método actual empieza así:

```typescript
  async resolver(id: number, dto: ResolverRegistroDto, aprobadoPorCuil: string) {
    const registro = await this.prisma.registroHoras.findUnique({ where: { id } });
    if (!registro) throw new NotFoundException('Registro no encontrado');
    if (registro.estado !== 'pendiente') {
```

Reemplazarlo por:

```typescript
  async resolver(
    id: number,
    dto: ResolverRegistroDto,
    usuario: { cuil: string; rol: string },
  ) {
    const registro = await this.prisma.registroHoras.findUnique({
      where: { id },
      include: { contrato: { select: { jefeContratoCuil: true } } },
    });
    if (!registro) throw new NotFoundException('Registro no encontrado');
    if (
      usuario.rol !== 'Admin' &&
      registro.contrato.jefeContratoCuil !== usuario.cuil
    ) {
      throw new ForbiddenException('No sos jefe del contrato de este registro');
    }
    if (registro.estado !== 'pendiente') {
```

Y dentro del mismo método, donde se usa `aprobadoPorCuil` (en el `data.aprobadoPorCuil` y en la auditoría `usuarioCuil`), reemplazar `aprobadoPorCuil` por `usuario.cuil`. (Son 2 usos: `aprobadoPorCuil: aprobadoPorCuil` → `aprobadoPorCuil: usuario.cuil`, y `usuarioCuil: aprobadoPorCuil` → `usuarioCuil: usuario.cuil`.)

- [ ] **Step 2: Cambiar la firma y el check en `reabrir` (service)**

El método actual empieza:

```typescript
  async reabrir(id: number, usuarioCuil: string) {
    const registro = await this.prisma.registroHoras.findUnique({ where: { id } });
    if (!registro) throw new NotFoundException('Registro no encontrado');
```

Reemplazarlo por:

```typescript
  async reabrir(id: number, usuario: { cuil: string; rol: string }) {
    const registro = await this.prisma.registroHoras.findUnique({
      where: { id },
      include: { contrato: { select: { jefeContratoCuil: true } } },
    });
    if (!registro) throw new NotFoundException('Registro no encontrado');
    if (
      usuario.rol !== 'Admin' &&
      registro.contrato.jefeContratoCuil !== usuario.cuil
    ) {
      throw new ForbiddenException('No sos jefe del contrato de este registro');
    }
```

Y reemplazar los usos de `usuarioCuil` dentro de `reabrir` por `usuario.cuil` (en la auditoría: `usuarioCuil: usuarioCuil` → `usuarioCuil: usuario.cuil`).

- [ ] **Step 3: Actualizar el controller para pasar `{cuil, rol}`**

En `registros-horas.controller.ts`, cambiar las llamadas de `resolver` y `reabrir`:

```typescript
  @Patch(':id/resolver')
  @Roles('JefeContrato', 'Admin')
  resolver(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolverRegistroDto,
    @Request() req,
  ) {
    return this.service.resolver(id, dto, { cuil: req.user.cuil, rol: req.user.rol });
  }

  @Patch(':id/reabrir')
  @Roles('JefeContrato', 'Admin')
  reabrir(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.reabrir(id, { cuil: req.user.cuil, rol: req.user.rol });
  }
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compila sin errores.

- [ ] **Step 5: Verificar en vivo**

Con el backend reiniciado: un Jefe de Contrato (o el admin como jefe de K5) resuelve una fila de K5 → 200; un JefeContrato que NO es jefe de ese contrato → 403. Con admin siempre 200. Reportar los códigos. (Podés usar el admin como jefe de K5 y un segundo contrato sin jefe para simular el 403, o probar solo el happy-path admin y documentar que el check está.)

```bash
curl -s -o /dev/null -w "[HTTP %{http_code}]\n" -X PATCH http://localhost:3001/registros-horas/<ID>/resolver -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"estado":"aprobado"}'
```

- [ ] **Step 6: Commit**

```bash
git add src/registros-horas
git commit -m "feat: resolver/reabrir solo por el jefe del contrato (o Admin)"
```

---

### Task 3: Frontend — tipos, utilidad de agrupación (pura, TDD) y hooks de API

**Files:**
- Modify: `src/types/domain.ts`
- Create: `src/lib/agrupar.ts` + `src/lib/agrupar.test.ts`
- Create: `src/lib/api/aprobaciones.ts`
- Create: `src/lib/api/novedades.ts`

Working dir: `Formulario_Horas/Frontend`. TDD para `agrupar`.

**Interfaces:**
- Consumes: `api` (`@/lib/api/client`), TanStack Query.
- Produces:
  - Tipos en `domain.ts`: `RegistroPorAprobar = RegistroHoras & { accionable: boolean }`; `EstadoHys = 'pendiente'|'aprobada'|'desaprobada'|'no_aplica'`; `TipoNovedad = { id, nombre, requiereAprobacionHys }`; `Novedad`; `CrearNovedadInput`.
  - `agrupar.ts`: `type GrupoAprobacion = { operarioCuil: string; operarioNombre: string; fecha: string; filas: RegistroPorAprobar[] }`; `agruparPorOperarioFecha(filas: RegistroPorAprobar[]): GrupoAprobacion[]`.
  - `aprobaciones.ts`: `usePorAprobar()`, `useResolverRegistro()`, `useReabrirRegistro()`.
  - `novedades.ts`: `useTiposNovedad()`, `useNovedades()`, `useNovedadesPorEstado(estadoHys)`, `useCrearNovedad()`, `useResolverHys()`.

- [ ] **Step 1: Agregar tipos a `src/types/domain.ts`**

Agregar al final:

```typescript
export type RegistroPorAprobar = RegistroHoras & { accionable: boolean };

export type EstadoHys = 'pendiente' | 'aprobada' | 'desaprobada' | 'no_aplica';

export interface TipoNovedad {
  id: number;
  nombre: string;
  requiereAprobacionHys: boolean;
}

export interface Novedad {
  id: number;
  operarioCuil: string;
  tipoNovedadId: number;
  fechaInicio: string;
  fechaFin: string | null;
  justificacionTexto: string | null;
  estadoHys: EstadoHys;
  operario: { cuil: string; apellido_nombre: string };
  tipoNovedad: { id: number; nombre: string; requiereAprobacionHys: boolean };
  cargadoPor: { cuil: string; email: string };
}

export interface CrearNovedadInput {
  operarioCuil: string;
  tipoNovedadId: number;
  fechaInicio: string;
  fechaFin?: string;
  justificacionTexto?: string;
}
```

- [ ] **Step 2: Escribir el test de `agrupar` (falla primero)**

Create: `src/lib/agrupar.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { agruparPorOperarioFecha } from './agrupar';
import type { RegistroPorAprobar } from '@/types/domain';

function fila(id: number, cuil: string, nombre: string, fecha: string, accionable = true): RegistroPorAprobar {
  return {
    id, fecha, horas: '8', estado: 'pendiente', alertaHoras: false, motivoDesaprobacion: null,
    operario: { cuil, apellido_nombre: nombre },
    contrato: { id: 1, codigo: 'K5', nombre: 'K5' },
    tarea: { id: 1, nombre: 'Excavación' },
    provincia: { id: 1, nombre: 'Córdoba' },
    moviles: [],
    accionable,
  };
}

describe('agruparPorOperarioFecha', () => {
  it('agrupa filas del mismo operario y fecha en un solo grupo', () => {
    const grupos = agruparPorOperarioFecha([
      fila(1, '20111', 'PEREZ', '2026-07-10'),
      fila(2, '20111', 'PEREZ', '2026-07-10', false),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].filas).toHaveLength(2);
    expect(grupos[0].operarioNombre).toBe('PEREZ');
  });

  it('separa por operario y por fecha', () => {
    const grupos = agruparPorOperarioFecha([
      fila(1, '20111', 'PEREZ', '2026-07-10'),
      fila(2, '20222', 'GOMEZ', '2026-07-10'),
      fila(3, '20111', 'PEREZ', '2026-07-11'),
    ]);
    expect(grupos).toHaveLength(3);
  });
});
```

- [ ] **Step 3: Correr para verlo fallar**

Run: `npm test -- agrupar`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 4: Implementar `src/lib/agrupar.ts`**

```typescript
import type { RegistroPorAprobar } from '@/types/domain';

export type GrupoAprobacion = {
  operarioCuil: string;
  operarioNombre: string;
  fecha: string;
  filas: RegistroPorAprobar[];
};

export function agruparPorOperarioFecha(filas: RegistroPorAprobar[]): GrupoAprobacion[] {
  const mapa = new Map<string, GrupoAprobacion>();
  for (const f of filas) {
    const fecha = f.fecha.slice(0, 10);
    const clave = `${f.operario.cuil}|${fecha}`;
    let grupo = mapa.get(clave);
    if (!grupo) {
      grupo = {
        operarioCuil: f.operario.cuil,
        operarioNombre: f.operario.apellido_nombre,
        fecha,
        filas: [],
      };
      mapa.set(clave, grupo);
    }
    grupo.filas.push(f);
  }
  return [...mapa.values()];
}
```

- [ ] **Step 5: Correr el test (pasa)**

Run: `npm test -- agrupar`
Expected: PASS.

- [ ] **Step 6: Crear `src/lib/api/aprobaciones.ts`**

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { RegistroPorAprobar } from '@/types/domain';

export function usePorAprobar() {
  return useQuery({
    queryKey: ['por-aprobar'],
    queryFn: async () =>
      (await api.get<RegistroPorAprobar[]>('/registros-horas/por-aprobar')).data,
  });
}

export function useResolverRegistro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: number;
      estado: 'aprobado' | 'desaprobado';
      motivoDesaprobacion?: string;
    }) =>
      (await api.patch(`/registros-horas/${input.id}/resolver`, {
        estado: input.estado,
        motivoDesaprobacion: input.motivoDesaprobacion,
      })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['por-aprobar'] }),
  });
}

export function useReabrirRegistro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      (await api.patch(`/registros-horas/${id}/reabrir`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['por-aprobar'] }),
  });
}
```

- [ ] **Step 7: Crear `src/lib/api/novedades.ts`**

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Novedad, TipoNovedad, CrearNovedadInput, EstadoHys } from '@/types/domain';

export function useTiposNovedad() {
  return useQuery({
    queryKey: ['tipos-novedad'],
    queryFn: async () => (await api.get<TipoNovedad[]>('/catalogos/tipos-novedad')).data,
  });
}

export function useNovedades() {
  return useQuery({
    queryKey: ['novedades'],
    queryFn: async () => (await api.get<Novedad[]>('/novedades')).data,
  });
}

export function useNovedadesPorEstado(estadoHys: EstadoHys) {
  return useQuery({
    queryKey: ['novedades', estadoHys],
    queryFn: async () =>
      (await api.get<Novedad[]>('/novedades', { params: { estadoHys } })).data,
  });
}

export function useCrearNovedad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CrearNovedadInput) =>
      (await api.post<Novedad>('/novedades', payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['novedades'] }),
  });
}

export function useResolverHys() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: number; estadoHys: 'aprobada' | 'desaprobada' }) =>
      (await api.patch(`/novedades/${input.id}/resolver-hys`, {
        estadoHys: input.estadoHys,
      })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['novedades'] }),
  });
}
```

- [ ] **Step 8: Verificar tipos y test**

Run: `npm test -- agrupar`
Expected: PASS.

Run: `npm run build`
Expected: compila sin errores de tipos.

- [ ] **Step 9: Commit**

```bash
git add src/types/domain.ts src/lib/agrupar.ts src/lib/agrupar.test.ts src/lib/api/aprobaciones.ts src/lib/api/novedades.ts
git commit -m "feat: tipos, util de agrupacion y hooks de API (aprobaciones/novedades)"
```

---

### Task 4: Frontend — página Aprobaciones (`/aprobaciones`)

**Files:**
- Create: `src/features/aprobaciones/desaprobar-dialog.tsx`
- Create: `src/app/(protected)/aprobaciones/page.tsx`
- Test: `src/app/(protected)/aprobaciones/aprobaciones-page.test.tsx`

Working dir: `Formulario_Horas/Frontend`. TDD (acciones + accionable).

**Interfaces:**
- Consumes: `usePorAprobar`, `useResolverRegistro`, `useReabrirRegistro` (`@/lib/api/aprobaciones`), `agruparPorOperarioFecha` (`@/lib/agrupar`), `toast` (`sonner`).
- Produces: ruta `/aprobaciones` con tarjetas por grupo; filas `accionable` con Aprobar/Desaprobar; filas no accionable en gris.

- [ ] **Step 1: Crear `src/features/aprobaciones/desaprobar-dialog.tsx`**

```tsx
'use client';

import { useState } from 'react';

export function DesaprobarDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: (motivo: string) => void;
  onCancel: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm space-y-3 rounded-lg bg-white p-6">
        <h3 className="font-semibold text-neutral">Desaprobar registro</h3>
        <label className="block text-sm text-neutral">
          Motivo
          <textarea
            aria-label="Motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="mt-1 w-full rounded border border-neutral/40 px-2 py-1"
            rows={3}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-neutral">
            Cancelar
          </button>
          <button
            type="button"
            disabled={motivo.trim().length === 0}
            onClick={() => onConfirm(motivo.trim())}
            className="rounded bg-alert px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Escribir el test de la página (falla primero)**

Create: `src/app/(protected)/aprobaciones/aprobaciones-page.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const resolver = vi.fn().mockResolvedValue({});
const reabrir = vi.fn().mockResolvedValue({});

function fila(id: number, accionable: boolean, codigo = 'K5') {
  return {
    id, fecha: '2026-07-10', horas: '8', estado: 'pendiente', alertaHoras: false, motivoDesaprobacion: null,
    operario: { cuil: '20111', apellido_nombre: 'PEREZ JUAN' },
    contrato: { id: 1, codigo, nombre: codigo },
    tarea: { id: 1, nombre: 'Excavación' },
    provincia: { id: 1, nombre: 'Córdoba' }, moviles: [], accionable,
  };
}

vi.mock('@/lib/api/aprobaciones', () => ({
  usePorAprobar: () => ({ data: [fila(1, true), fila(2, false, 'K8')], isLoading: false }),
  useResolverRegistro: () => ({ mutateAsync: resolver, isPending: false }),
  useReabrirRegistro: () => ({ mutateAsync: reabrir, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AprobacionesPage from './page';

describe('AprobacionesPage', () => {
  beforeEach(() => { resolver.mockClear(); });

  it('la fila accionable tiene Aprobar; la de otro contrato (K8) no', () => {
    render(<AprobacionesPage />);
    // exactamente un botón "Aprobar" (match exacto, no "Desaprobar")
    expect(screen.getAllByRole('button', { name: /^aprobar$/i })).toHaveLength(1);
    // la fila de contexto muestra el código K8
    expect(screen.getByText('K8')).toBeInTheDocument();
  });

  it('aprobar llama la mutación con el id y estado aprobado', async () => {
    render(<AprobacionesPage />);
    await userEvent.click(screen.getByRole('button', { name: /aprobar/i }));
    await waitFor(() =>
      expect(resolver).toHaveBeenCalledWith({ id: 1, estado: 'aprobado' }),
    );
  });

  it('desaprobar exige motivo y luego llama la mutación', async () => {
    render(<AprobacionesPage />);
    await userEvent.click(screen.getByRole('button', { name: /desaprobar/i }));
    await userEvent.type(screen.getByLabelText(/motivo/i), 'faltan datos');
    await userEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    await waitFor(() =>
      expect(resolver).toHaveBeenCalledWith({ id: 1, estado: 'desaprobado', motivoDesaprobacion: 'faltan datos' }),
    );
  });
});
```

- [ ] **Step 3: Correr para verlo fallar**

Run: `npm test -- aprobaciones-page`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 4: Implementar `src/app/(protected)/aprobaciones/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { usePorAprobar, useResolverRegistro, useReabrirRegistro } from '@/lib/api/aprobaciones';
import { agruparPorOperarioFecha } from '@/lib/agrupar';
import { DesaprobarDialog } from '@/features/aprobaciones/desaprobar-dialog';

export default function AprobacionesPage() {
  const { data, isLoading } = usePorAprobar();
  const resolver = useResolverRegistro();
  const reabrir = useReabrirRegistro();
  const [desaprobandoId, setDesaprobandoId] = useState<number | null>(null);

  const grupos = agruparPorOperarioFecha(data ?? []);

  async function aprobar(id: number) {
    try {
      await resolver.mutateAsync({ id, estado: 'aprobado' });
      toast.success('Registro aprobado');
    } catch {
      toast.error('No se pudo aprobar');
    }
  }

  async function confirmarDesaprobar(id: number, motivo: string) {
    try {
      await resolver.mutateAsync({ id, estado: 'desaprobado', motivoDesaprobacion: motivo });
      toast.success('Registro desaprobado');
    } catch {
      toast.error('No se pudo desaprobar');
    } finally {
      setDesaprobandoId(null);
    }
  }

  if (isLoading) return <p className="text-neutral">Cargando…</p>;

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold text-neutral">Aprobaciones</h1>
      {grupos.length === 0 ? (
        <p className="text-neutral/60">No hay registros pendientes.</p>
      ) : (
        grupos.map((g) => (
          <div key={`${g.operarioCuil}-${g.fecha}`} className="rounded-lg border border-neutral/20 p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-medium text-neutral">{g.operarioNombre}</h2>
              <span className="text-sm text-neutral/60">{g.fecha}</span>
            </div>
            <div className="space-y-2">
              {g.filas.map((f) => (
                <div
                  key={f.id}
                  className={`flex flex-wrap items-center gap-3 rounded border p-2 text-sm ${
                    f.accionable ? 'border-neutral/20' : 'border-neutral/10 bg-neutral/5 text-neutral/50'
                  }`}
                >
                  <span className="font-medium">{f.contrato.codigo}</span>
                  <span>{f.tarea.nombre}</span>
                  <span>
                    {f.horas} hs
                    {f.alertaHoras && <span className="ml-1 rounded bg-alert/15 px-1 text-xs text-alert">+16h</span>}
                  </span>
                  {f.moviles.length > 0 && (
                    <span className="text-neutral/60">
                      {f.moviles.map((m) => m.movil.identificador).join(', ')}
                    </span>
                  )}
                  <span className="ml-auto flex gap-2">
                    {f.accionable ? (
                      <>
                        <button
                          type="button"
                          onClick={() => aprobar(f.id)}
                          className="rounded bg-brand px-2 py-1 text-xs font-medium text-white"
                        >
                          Aprobar
                        </button>
                        <button
                          type="button"
                          onClick={() => setDesaprobandoId(f.id)}
                          className="rounded border border-alert px-2 py-1 text-xs text-alert"
                        >
                          Desaprobar
                        </button>
                      </>
                    ) : (
                      <span className="text-xs italic">otro contrato</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {desaprobandoId != null && (
        <DesaprobarDialog
          onCancel={() => setDesaprobandoId(null)}
          onConfirm={(motivo) => confirmarDesaprobar(desaprobandoId, motivo)}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 5: Correr el test (pasa)**

Run: `npm test -- aprobaciones-page`
Expected: PASS (3 tests).

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: build OK; ruta `/aprobaciones` presente.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(protected)/aprobaciones" src/features/aprobaciones
git commit -m "feat: pagina Aprobaciones (grupos por operario/fecha, accionable + contexto)"
```

---

### Task 5: Frontend — página Novedades (`/novedades`)

**Files:**
- Create: `src/features/novedades/nueva-novedad-form.tsx`
- Create: `src/app/(protected)/novedades/page.tsx`
- Test: `src/app/(protected)/novedades/novedades-page.test.tsx`

Working dir: `Formulario_Horas/Frontend`. TDD (form valida + envía).

**Interfaces:**
- Consumes: `useNovedades`, `useCrearNovedad`, `useTiposNovedad` (`@/lib/api/novedades`), `OperariosSelect` (`@/features/reporte/operarios-select`), `toast`.
- Produces: ruta `/novedades` con lista + form Nueva novedad.

- [ ] **Step 1: Crear `src/features/novedades/nueva-novedad-form.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useCrearNovedad, useTiposNovedad } from '@/lib/api/novedades';
import { OperariosSelect } from '@/features/reporte/operarios-select';
import type { EmpleadoBusqueda } from '@/types/domain';

export function NuevaNovedadForm({ onCreada }: { onCreada: () => void }) {
  const { data: tipos } = useTiposNovedad();
  const crear = useCrearNovedad();
  const [operario, setOperario] = useState<EmpleadoBusqueda[]>([]);
  const [tipoNovedadId, setTipoNovedadId] = useState<number | null>(null);
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [justificacion, setJustificacion] = useState('');

  const puede = operario.length === 1 && tipoNovedadId != null && fechaInicio !== '';

  async function enviar() {
    if (!puede || tipoNovedadId == null) return;
    try {
      await crear.mutateAsync({
        operarioCuil: operario[0].cuil,
        tipoNovedadId,
        fechaInicio,
        fechaFin: fechaFin || undefined,
        justificacionTexto: justificacion || undefined,
      });
      toast.success('Novedad cargada');
      setOperario([]);
      setTipoNovedadId(null);
      setFechaInicio('');
      setFechaFin('');
      setJustificacion('');
      onCreada();
    } catch {
      toast.error('No se pudo cargar la novedad');
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-neutral/20 p-4">
      <h2 className="font-medium text-neutral">Nueva novedad</h2>
      <div className="space-y-1">
        <span className="text-sm text-neutral">Operario</span>
        <OperariosSelect value={operario} onChange={(v) => setOperario(v.slice(-1))} />
      </div>
      <label className="flex flex-col text-sm text-neutral">
        Tipo
        <select
          aria-label="Tipo"
          value={tipoNovedadId ?? ''}
          onChange={(e) => setTipoNovedadId(e.target.value ? Number(e.target.value) : null)}
          className="rounded border border-neutral/40 px-3 py-2"
        >
          <option value="">—</option>
          {(tipos ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col text-sm text-neutral">
          Fecha inicio
          <input type="date" aria-label="Fecha inicio" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} className="rounded border border-neutral/40 px-3 py-2" />
        </label>
        <label className="flex flex-col text-sm text-neutral">
          Fecha fin (opcional)
          <input type="date" aria-label="Fecha fin" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} className="rounded border border-neutral/40 px-3 py-2" />
        </label>
      </div>
      <label className="flex flex-col text-sm text-neutral">
        Justificación (opcional)
        <textarea value={justificacion} onChange={(e) => setJustificacion(e.target.value)} className="rounded border border-neutral/40 px-3 py-2" rows={2} />
      </label>
      <button
        type="button"
        disabled={!puede || crear.isPending}
        onClick={enviar}
        className="rounded bg-brand px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        Cargar novedad
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Escribir el test (falla primero)**

Create: `src/app/(protected)/novedades/novedades-page.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const crear = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/novedades', () => ({
  useNovedades: () => ({ data: [], isLoading: false }),
  useTiposNovedad: () => ({ data: [{ id: 5, nombre: 'Ausencia', requiereAprobacionHys: true }] }),
  useCrearNovedad: () => ({ mutateAsync: crear, isPending: false }),
}));
vi.mock('@/lib/api/empleados', () => ({
  useBuscarEmpleados: () => ({ data: [{ cuil: '20169', apellido_nombre: 'GOMEZ', legajo: 1, cargo: 'OF' }] }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import NovedadesPage from './page';

describe('NovedadesPage', () => {
  beforeEach(() => crear.mockClear());

  it('crea una novedad con operario, tipo y fecha inicio', async () => {
    render(<NovedadesPage />);
    await userEvent.type(screen.getByPlaceholderText(/buscar operario/i), 'gomez');
    await userEvent.click(await screen.findByText(/GOMEZ/));
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), '5');
    await userEvent.type(screen.getByLabelText('Fecha inicio'), '2026-07-10');
    await userEvent.click(screen.getByRole('button', { name: /cargar novedad/i }));
    await waitFor(() =>
      expect(crear).toHaveBeenCalledWith(
        expect.objectContaining({ operarioCuil: '20169', tipoNovedadId: 5, fechaInicio: '2026-07-10' }),
      ),
    );
  });
});
```

- [ ] **Step 3: Correr para verlo fallar**

Run: `npm test -- novedades-page`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 4: Implementar `src/app/(protected)/novedades/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useNovedades } from '@/lib/api/novedades';
import { NuevaNovedadForm } from '@/features/novedades/nueva-novedad-form';

const CHIP: Record<string, string> = {
  no_aplica: 'bg-neutral/15 text-neutral',
  pendiente: 'bg-neutral/15 text-neutral',
  aprobada: 'bg-green-100 text-green-800',
  desaprobada: 'bg-alert/15 text-alert',
};

export default function NovedadesPage() {
  const { data, isLoading } = useNovedades();
  const [mostrarForm, setMostrarForm] = useState(false);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral">Novedades</h1>
        <button
          type="button"
          onClick={() => setMostrarForm((v) => !v)}
          className="rounded bg-brand px-3 py-2 text-sm font-medium text-white"
        >
          {mostrarForm ? 'Cerrar' : 'Nueva novedad'}
        </button>
      </div>

      {mostrarForm && <NuevaNovedadForm onCreada={() => setMostrarForm(false)} />}

      {isLoading ? (
        <p className="text-neutral">Cargando…</p>
      ) : (data ?? []).length === 0 ? (
        <p className="text-neutral/60">Sin novedades.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral/20 text-left text-neutral/70">
                <th className="py-2">Operario</th>
                <th>Tipo</th>
                <th>Desde</th>
                <th>Hasta</th>
                <th>Estado HyS</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((n) => (
                <tr key={n.id} className="border-b border-neutral/10">
                  <td className="py-2">{n.operario.apellido_nombre}</td>
                  <td>{n.tipoNovedad.nombre}</td>
                  <td>{n.fechaInicio.slice(0, 10)}</td>
                  <td>{n.fechaFin ? n.fechaFin.slice(0, 10) : '—'}</td>
                  <td>
                    <span className={`rounded px-2 py-0.5 text-xs ${CHIP[n.estadoHys] ?? ''}`}>
                      {n.estadoHys}
                    </span>
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

- [ ] **Step 5: Correr el test (pasa)**

Run: `npm test -- novedades-page`
Expected: PASS.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: build OK; ruta `/novedades` presente.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(protected)/novedades" src/features/novedades
git commit -m "feat: pagina Novedades (lista + form nueva novedad)"
```

---

### Task 6: Frontend — página Ausencias (`/ausencias`)

**Files:**
- Create: `src/app/(protected)/ausencias/page.tsx`
- Test: `src/app/(protected)/ausencias/ausencias-page.test.tsx`

Working dir: `Formulario_Horas/Frontend`. TDD (aprobar/desaprobar HyS).

**Interfaces:**
- Consumes: `useNovedadesPorEstado`, `useResolverHys` (`@/lib/api/novedades`), `toast`.
- Produces: ruta `/ausencias` con bandeja de pendientes + acciones + filtro de estado.

- [ ] **Step 1: Escribir el test (falla primero)**

Create: `src/app/(protected)/ausencias/ausencias-page.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const resolver = vi.fn().mockResolvedValue({});

function nov(id: number) {
  return {
    id, operarioCuil: '20111', tipoNovedadId: 5, fechaInicio: '2026-07-10', fechaFin: null,
    justificacionTexto: 'gripe', estadoHys: 'pendiente',
    operario: { cuil: '20111', apellido_nombre: 'PEREZ' },
    tipoNovedad: { id: 5, nombre: 'Ausencia', requiereAprobacionHys: true },
    cargadoPor: { cuil: '20999', email: 'sup@test.local' },
  };
}

vi.mock('@/lib/api/novedades', () => ({
  useNovedadesPorEstado: () => ({ data: [nov(1)], isLoading: false }),
  useResolverHys: () => ({ mutateAsync: resolver, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AusenciasPage from './page';

describe('AusenciasPage', () => {
  beforeEach(() => resolver.mockClear());

  it('aprobar llama resolver-hys con estado aprobada', async () => {
    render(<AusenciasPage />);
    await userEvent.click(screen.getByRole('button', { name: /aprobar/i }));
    await waitFor(() => expect(resolver).toHaveBeenCalledWith({ id: 1, estadoHys: 'aprobada' }));
  });

  it('desaprobar llama resolver-hys con estado desaprobada', async () => {
    render(<AusenciasPage />);
    await userEvent.click(screen.getByRole('button', { name: /desaprobar/i }));
    await waitFor(() => expect(resolver).toHaveBeenCalledWith({ id: 1, estadoHys: 'desaprobada' }));
  });
});
```

- [ ] **Step 2: Correr para verlo fallar**

Run: `npm test -- ausencias-page`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 3: Implementar `src/app/(protected)/ausencias/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useNovedadesPorEstado, useResolverHys } from '@/lib/api/novedades';
import type { EstadoHys } from '@/types/domain';

export default function AusenciasPage() {
  const [estado, setEstado] = useState<EstadoHys>('pendiente');
  const { data, isLoading } = useNovedadesPorEstado(estado);
  const resolver = useResolverHys();

  async function resolverHys(id: number, estadoHys: 'aprobada' | 'desaprobada') {
    try {
      await resolver.mutateAsync({ id, estadoHys });
      toast.success(estadoHys === 'aprobada' ? 'Ausencia aprobada' : 'Ausencia desaprobada');
    } catch {
      toast.error('No se pudo resolver');
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral">Ausencias (HyS)</h1>
        <label className="text-sm text-neutral">
          Estado{' '}
          <select
            aria-label="Estado"
            value={estado}
            onChange={(e) => setEstado(e.target.value as EstadoHys)}
            className="rounded border border-neutral/40 px-2 py-1"
          >
            <option value="pendiente">Pendientes</option>
            <option value="aprobada">Aprobadas</option>
            <option value="desaprobada">Desaprobadas</option>
          </select>
        </label>
      </div>

      {isLoading ? (
        <p className="text-neutral">Cargando…</p>
      ) : (data ?? []).length === 0 ? (
        <p className="text-neutral/60">Sin novedades en este estado.</p>
      ) : (
        <div className="space-y-2">
          {(data ?? []).map((n) => (
            <div key={n.id} className="flex flex-wrap items-center gap-3 rounded border border-neutral/20 p-3 text-sm">
              <span className="font-medium text-neutral">{n.operario.apellido_nombre}</span>
              <span>{n.tipoNovedad.nombre}</span>
              <span>{n.fechaInicio.slice(0, 10)}{n.fechaFin ? ` → ${n.fechaFin.slice(0, 10)}` : ''}</span>
              {n.justificacionTexto && <span className="text-neutral/60">{n.justificacionTexto}</span>}
              {estado === 'pendiente' && (
                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => resolverHys(n.id, 'aprobada')}
                    className="rounded bg-brand px-2 py-1 text-xs font-medium text-white"
                  >
                    Aprobar
                  </button>
                  <button
                    type="button"
                    onClick={() => resolverHys(n.id, 'desaprobada')}
                    className="rounded border border-alert px-2 py-1 text-xs text-alert"
                  >
                    Desaprobar
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Correr el test (pasa)**

Run: `npm test -- ausencias-page`
Expected: PASS (2 tests).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build OK; ruta `/ausencias` presente.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(protected)/ausencias"
git commit -m "feat: pagina Ausencias HyS (bandeja + aprobar/desaprobar + filtro)"
```

---

### Task 7: Frontend — verificación final de la fase

**Files:**
- (ninguno nuevo; solo verificación)

Working dir: `Formulario_Horas/Frontend`.

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: PASS (todos: Fase 1 + 2 + los nuevos de Fase 3 — agrupar, aprobaciones, novedades, ausencias).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build OK; rutas `/aprobaciones`, `/novedades`, `/ausencias` presentes.

- [ ] **Step 4: (Si hay algo que commitear por fixes de lint) commit**

```bash
git add -A
git commit -m "chore: verificacion final Fase 3 (tests + lint + build)"
```

Si no hubo cambios, omitir el commit.

---

## Notas de cierre

- El backend (Tasks 1–2) commitea en `formulario-horas-backend`; el frontend (Tasks 3–7) en `formulario-horas-frontend`.
- Verificación E2E manual sugerida: con el admin seteado como jefe de K5 y algún registro pendiente, entrar como admin → `/aprobaciones` ve el grupo, aprueba una fila de K5 y ve la fila de otro contrato en gris; crear una novedad tipo "Ausencia" (requiere sembrar un tipo de novedad) y resolverla en `/ausencias`.
- Al terminar, actualizar `Backend/.claude/Contexto/contexto-proyecto.md` marcando la Fase 3 completa y dejando apuntado el pendiente: **rediseño visual** (contexto §16) y provisión de logins de operarios.
- **Gap de datos para probar:** no hay tipos de novedad ni jefe de contrato sembrados. Para el E2E hará falta un mini-seed (1 tipo de novedad, y setear `jefeContratoCuil` de K5). Es seed de prueba, reversible.
