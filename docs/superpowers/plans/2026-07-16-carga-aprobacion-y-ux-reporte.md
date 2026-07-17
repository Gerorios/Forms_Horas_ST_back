# Aprobación por carga + mejoras UX — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El Jefe de Contrato aprueba/desaprueba una carga completa (su porción, por contrato) de
un solo click en vez de fila por fila; además, tres mejoras de UX en `/mis-registros` y `/reporte`
para operarios de campo con poca familiaridad tecnológica.

**Architecture:** Backend NestJS — nueva columna `loteId` (UUID) en `RegistroHoras`, generada una
vez por envío (`create`/`createBatch`) y compartida por todas sus filas; `porAprobar` agrupa por
`loteId`; nuevo endpoint `resolverLote` resuelve en bloque, con autorización recalculada
server-side (nunca confía en los ids que manda el cliente). Frontend Next.js — componentes nuevos
hand-rolled con Tailwind (sin librería de UI, consistente con el resto del proyecto): `LoteCard`
(aprobación en bloque), `RegistrosCards` (reemplaza la tabla de mis registros), `MovilesSelect`
(dropdown con checkboxes), `CargandoModal` (spinner de envío).

**Tech Stack:** NestJS 11, Prisma 7, MariaDB (BD compartida, DDL manual) — backend. Next.js (App
Router), TanStack Query, Vitest + Testing Library — frontend.

## Global Constraints

- Repos: backend en `Forms_Horas_ST_back` (este working directory), frontend en
  `Forms_Horas_ST_Frontend` (`../Frontend`). Ambos en la rama `feature/carga-aprobacion-ux`,
  creada desde `main`.
- Spec completa: `docs/superpowers/specs/2026-07-16-carga-aprobacion-y-ux-reporte-design.md`.
  ADR: `docs/adr/2026-07-16-adr-004-aprobacion-por-carga.md`.
- `loteId` es `CHAR(36)` **NOT NULL** — toda fila de `RegistroHoras` tiene un lote, generado con
  `crypto.randomUUID()` en el momento de crear (tanto `create()` individual como `createBatch()`
  masivo). Una carga individual es, simplemente, un lote de una sola fila.
- `resolverLote` **nunca confía en los `ids` que manda el cliente para decidir autorización** — el
  conjunto "accionable" (filas del lote que pertenecen a un contrato del jefe que llama, o todas
  si es Admin) se recalcula siempre server-side; los `ids` del cliente solo intersectan ese
  conjunto ya autorizado.
- `resolver()`, `reabrir()` y `update()` (corrección) de un registro individual **no cambian** —
  siguen operando por `id`, sin concepto de lote. `DesaprobarDialog` se reutiliza sin cambios
  tanto para el flujo individual (ya existente) como para el de lote (nuevo).
- El proyecto no tiene ninguna librería de UI (`@radix-ui`, `@headlessui`, etc.) — todos los
  componentes nuevos son hand-rolled con Tailwind, mismo criterio que el resto del formulario.
- Backend sin infraestructura de tests automatizada — verificación por build + checklist manual
  documentado. Frontend con Vitest + Testing Library — TDD obligatorio para cada componente nuevo.
- BD compartida: **NUNCA** `prisma db push`/`migrate` — el DDL se aplica a mano vía script,
  después se actualiza `schema.prisma` y se corre `npx prisma generate` (solo regenera el cliente,
  no toca la BD).

---

## Backend (`Forms_Horas_ST_back`)

### Task 1: Columna `loteId` — DDL + schema Prisma

**Files:**
- Modify: `prisma/schema.prisma`
- Ejecutar (no se commitea): script de migración contra la BD compartida.

**Interfaces:**
- Produces: `RegistroHoras.loteId: string` (NOT NULL, `@db.Char(36)`), índice `@@index([loteId])`.
  Tasks 2, 3 y 4 dependen de este campo existiendo tanto en la BD como en el cliente Prisma
  regenerado.

**Nota de riesgo:** esta tarea modifica la base de datos compartida (no reversible sin otro DDL).
Ejecutar con cuidado, verificar cada paso antes de continuar.

- [ ] **Step 1: Confirmar la conexión y el estado actual de la tabla**

Correr un script Node de una sola vez (mismo patrón ya usado en este proyecto —
`PrismaMariaDb(process.env.DATABASE_URL)` + `dotenv/config`) que haga
`SELECT COUNT(*) FROM sth_registros_horas` y confirme que la columna `lote_id` **no existe
todavía** (`DESCRIBE sth_registros_horas` o `SHOW COLUMNS FROM sth_registros_horas LIKE
'lote_id'`). Si ya existe, STOP y reportar — no continuar con el DDL.

- [ ] **Step 2: Aplicar el DDL**

Correr, en este orden, contra la BD compartida (vía `$executeRawUnsafe` desde el mismo script):

```sql
ALTER TABLE sth_registros_horas ADD COLUMN lote_id CHAR(36) NULL AFTER id;
UPDATE sth_registros_horas SET lote_id = UUID() WHERE lote_id IS NULL;
ALTER TABLE sth_registros_horas MODIFY COLUMN lote_id CHAR(36) NOT NULL;
CREATE INDEX idx_registros_horas_lote_id ON sth_registros_horas (lote_id);
```

- [ ] **Step 3: Verificar el resultado**

Correr `SELECT COUNT(*) AS total, COUNT(DISTINCT lote_id) AS distintos FROM
sth_registros_horas;` y confirmar `total === distintos` (cada fila de prueba existente quedó con
su propio lote, como corresponde a datos de prueba sin envío real que reconstruir — ver ADR-004).
También confirmar que no queden `NULL`: `SELECT COUNT(*) FROM sth_registros_horas WHERE lote_id
IS NULL` debe dar `0`.

- [ ] **Step 4: Actualizar `schema.prisma`**

En `prisma/schema.prisma`, dentro de `model RegistroHoras`, agregar el campo justo después de `id`:

```prisma
model RegistroHoras {
  id                  Int            @id @default(autoincrement())
  loteId              String         @map("lote_id") @db.Char(36)
  fecha               DateTime       @db.Date
  // ...resto de campos sin cambios
```

Y agregar el índice nuevo junto a los `@@index` existentes:

```prisma
  @@index([fecha])
  @@index([operarioCuil, fecha])
  @@index([contratoId, estado])
  @@index([loteId])
  @@map("sth_registros_horas")
```

- [ ] **Step 5: Regenerar el cliente Prisma (NO migrar/push)**

Run: `npx prisma generate`
Expected: termina sin errores, sin tocar la base (el DDL ya se aplicó a mano en el Step 2).

- [ ] **Step 6: Verificar que el proyecto compila**

Run: `npm run build`
Expected: termina sin errores (todavía no hay código nuevo que use `loteId`, este build solo
confirma que el schema regenerado no rompe nada existente).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): agregar loteId a RegistroHoras (ver ADR-004)"
```

---

### Task 2: `create()` y `createBatch()` generan `loteId`

**Files:**
- Modify: `src/registros-horas/registros-horas.service.ts`

**Interfaces:**
- Consumes: `RegistroHoras.loteId` (Task 1).
- Produces: toda fila creada (individual o batch) tiene `loteId` seteado. Task 3 y 4 dependen de
  que este campo esté poblado consistentemente para poder agrupar/resolver por lote.

- [ ] **Step 1: Importar `randomUUID`**

Al inicio de `src/registros-horas/registros-horas.service.ts`, agregar:

```ts
import { randomUUID } from 'crypto';
```

- [ ] **Step 2: `create()` — generar y setear `loteId`**

Dentro del método `create`, en el objeto `data` del `this.prisma.registroHoras.create({...})`,
agregar `loteId: randomUUID(),` (una carga individual es un lote de una sola fila):

```ts
    return this.prisma.registroHoras.create({
      data: {
        loteId: randomUUID(),
        fecha: new Date(dto.fecha),
        operarioCuil: dto.operarioCuil,
        cargadoPorCuil,
        contratoId: dto.contratoId,
        horas: dto.horas,
        provinciaId: dto.provinciaId,
        gpsLat: dto.gpsLat,
        gpsLng: dto.gpsLng,
        alertaHoras,
        tareas: { create: dto.tareaIds.map((tareaId) => ({ tareaId })) },
        moviles: dto.movilIds?.length
          ? { create: dto.movilIds.map((movilId) => ({ movilId })) }
          : undefined,
      },
      include: INCLUDE_BASICO,
    });
```

- [ ] **Step 3: `createBatch()` — un solo `loteId` para todo el envío**

Dentro de `createBatch`, ANTES del `return this.prisma.$transaction(...)`, generar un único
`loteId` para todo el batch:

```ts
    const loteId = randomUUID();

    return this.prisma.$transaction(
```

Y dentro del loop, en el objeto `data` del `tx.registroHoras.create({...})`, agregar `loteId,`:

```ts
            const registro = await tx.registroHoras.create({
              data: {
                loteId,
                fecha,
                operarioCuil,
                cargadoPorCuil,
                contratoId: linea.contratoId,
                horas: linea.horas,
                provinciaId: dto.provinciaId,
                gpsLat: dto.gpsLat,
                gpsLng: dto.gpsLng,
                alertaHoras,
                tareas: { create: linea.tareaIds.map((tareaId) => ({ tareaId })) },
                moviles: dto.movilIds?.length
                  ? { create: dto.movilIds.map((movilId) => ({ movilId })) }
                  : undefined,
              },
              include: INCLUDE_BASICO,
            });
```

- [ ] **Step 4: Verificar que compila**

Run: `npm run build`
Expected: termina sin errores.

- [ ] **Step 5: Verificación manual (curl, opcional para el usuario)**

Crear un registro individual y una carga batch con un token real; confirmar en la BD que las filas
de la carga batch comparten el mismo `lote_id` y que el registro individual tiene su propio
`lote_id` distinto.

- [ ] **Step 6: Commit**

```bash
git add src/registros-horas/registros-horas.service.ts
git commit -m "feat(registros): create/createBatch generan loteId"
```

---

### Task 3: `porAprobar()` agrupa por `loteId`

**Files:**
- Modify: `src/registros-horas/registros-horas.service.ts`

**Interfaces:**
- Consumes: `RegistroHoras.loteId` (Task 1, Task 2).
- Produces: `porAprobar()` sigue devolviendo `RegistroPorAprobar[]` (flat, sin agrupar
  server-side), pero cada fila ahora trae `loteId` (ya incluido automáticamente por `include:
  INCLUDE_BASICO`, es un campo escalar). Task 5 (frontend) depende de que este campo esté presente
  en la respuesta para poder agrupar.

- [ ] **Step 1: Reemplazar el método `porAprobar`**

Reemplazar el método completo:

```ts
  async porAprobar(usuario: { cuil: string; rol: string }) {
    // 1) Contratos de los que el usuario es jefe (Admin = todos)
    const contratos = await this.prisma.contrato.findMany({
      where: usuario.rol === 'Admin' ? {} : { jefeContratoCuil: usuario.cuil },
      select: { id: true },
    });
    const misContratoIds = contratos.map((c) => c.id);
    if (misContratoIds.length === 0) return [];

    // 2) Lotes con al menos una fila pendiente en mis contratos
    const lotes = await this.prisma.registroHoras.findMany({
      where: { estado: 'pendiente', contratoId: { in: misContratoIds } },
      select: { loteId: true },
      distinct: ['loteId'],
    });
    if (lotes.length === 0) return [];

    // 3) Todas las filas pendientes de esos lotes (incluye otros contratos = contexto)
    const loteIds = lotes.map((l) => l.loteId);
    const filas = await this.prisma.registroHoras.findMany({
      where: { estado: 'pendiente', loteId: { in: loteIds } },
      include: INCLUDE_BASICO,
      orderBy: [{ fecha: 'desc' }, { loteId: 'asc' }, { operarioCuil: 'asc' }],
    });

    const setIds = new Set(misContratoIds);
    return filas.map((f) => ({ ...f, accionable: setIds.has(f.contratoId) }));
  }
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build`
Expected: termina sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/registros-horas/registros-horas.service.ts
git commit -m "feat(registros): porAprobar agrupa por loteId en vez de (operario, fecha)"
```

---

### Task 4: `resolverLote` — servicio + DTO + endpoint

**Files:**
- Create: `src/registros-horas/dto/resolver-lote.dto.ts`
- Modify: `src/registros-horas/registros-horas.service.ts`
- Modify: `src/registros-horas/registros-horas.controller.ts`

**Interfaces:**
- Consumes: `RegistroHoras.loteId` (Task 1).
- Produces: `PATCH /registros-horas/lote/:loteId/resolver` — body
  `{ estado: 'aprobado' | 'desaprobado', ids?: number[], motivoDesaprobacion?: string }`,
  respuesta `{ resueltos: number, ids: number[] }`. Task 6 (frontend, hook `useResolverLote`)
  depende de esta forma exacta de request/response.

- [ ] **Step 1: Crear el DTO**

Crear `src/registros-horas/dto/resolver-lote.dto.ts`:

```ts
import { IsArray, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

export class ResolverLoteDto {
  @IsEnum(['aprobado', 'desaprobado'])
  estado: 'aprobado' | 'desaprobado';

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  ids?: number[];

  @IsOptional()
  @IsString()
  motivoDesaprobacion?: string;
}
```

- [ ] **Step 2: Agregar el método `resolverLote` al servicio**

En `src/registros-horas/registros-horas.service.ts`, agregar el import del nuevo DTO:

```ts
import { ResolverLoteDto } from './dto/resolver-lote.dto';
```

Y agregar el método (después de `resolver`, antes de `reabrir` — da igual el orden exacto, pero
mantenerlo cerca de `resolver` por afinidad):

```ts
  /**
   * Resuelve en bloque las filas `pendiente` de un lote que pertenecen a los contratos del
   * usuario (o todas si es Admin). El conjunto "accionable" se recalcula siempre server-side —
   * los `ids` del cliente solo intersectan ese conjunto ya autorizado, nunca lo amplían.
   */
  async resolverLote(
    loteId: string,
    dto: ResolverLoteDto,
    usuario: { cuil: string; rol: string },
  ) {
    if (dto.estado === 'desaprobado' && !dto.motivoDesaprobacion) {
      throw new BadRequestException('Se requiere motivo al desaprobar');
    }

    const accionables = await this.prisma.registroHoras.findMany({
      where: {
        loteId,
        estado: 'pendiente',
        contrato: usuario.rol === 'Admin' ? undefined : { jefeContratoCuil: usuario.cuil },
      },
      select: { id: true },
    });
    const accionablesIds = new Set(accionables.map((r) => r.id));

    const idsAResolver = dto.ids
      ? dto.ids.filter((id) => accionablesIds.has(id))
      : [...accionablesIds];

    if (idsAResolver.length === 0) {
      throw new BadRequestException('Nada para resolver');
    }

    await this.prisma.registroHoras.updateMany({
      where: { id: { in: idsAResolver } },
      data: {
        estado: dto.estado,
        aprobadoPorCuil: usuario.cuil,
        aprobadoEn: new Date(),
        motivoDesaprobacion: dto.motivoDesaprobacion ?? null,
      },
    });

    await this.prisma.auditoria.createMany({
      data: idsAResolver.map((id) => ({
        tabla: 'sth_registros_horas',
        registroId: id,
        usuarioCuil: usuario.cuil,
        accion: dto.estado === 'aprobado' ? 'aprobar' : 'desaprobar',
        campo: 'estado',
        valorAnterior: 'pendiente',
        valorNuevo: dto.estado,
      })),
    });

    return { resueltos: idsAResolver.length, ids: idsAResolver };
  }
```

- [ ] **Step 3: Agregar el endpoint al controller**

En `src/registros-horas/registros-horas.controller.ts`, agregar el import:

```ts
import { ResolverLoteDto } from './dto/resolver-lote.dto';
```

Y agregar el endpoint (después de `@Patch(':id/resolver') resolver(...)`):

```ts
  @Patch('lote/:loteId/resolver')
  @Roles('JefeContrato', 'Admin')
  resolverLote(
    @Param('loteId') loteId: string,
    @Body() dto: ResolverLoteDto,
    @Request() req,
  ) {
    return this.service.resolverLote(loteId, dto, { cuil: req.user.cuil, rol: req.user.rol });
  }
```

- [ ] **Step 4: Verificar que compila**

Run: `npm run build`
Expected: termina sin errores.

- [ ] **Step 5: Verificación manual (curl, opcional para el usuario)**

Con un token de JefeContrato real: `PATCH /registros-horas/lote/<loteId>/resolver` con
`{"estado":"aprobado"}` sin `ids` → confirmar que resuelve todas las filas accionables del lote
para ese contrato, y que las de otro contrato en el mismo lote quedan intactas. Repetir con `ids`
para confirmar que solo resuelve el subconjunto pedido.

- [ ] **Step 6: Commit**

```bash
git add src/registros-horas/dto/resolver-lote.dto.ts src/registros-horas/registros-horas.service.ts src/registros-horas/registros-horas.controller.ts
git commit -m "feat(registros): endpoint PATCH /registros-horas/lote/:loteId/resolver"
```

---

## Frontend (`Forms_Horas_ST_Frontend`)

> Todos los comandos de esta sección corren desde el repo frontend (`../Frontend` relativo a
> `Forms_Horas_ST_back`).

### Task 5: Tipos + `agruparPorLote`

**Files:**
- Modify: `src/types/domain.ts`
- Modify: `src/lib/agrupar.ts`
- Modify: `src/lib/agrupar.test.ts`

**Interfaces:**
- Consumes: `loteId` en la respuesta de `GET /registros-horas/por-aprobar` (Task 3 backend).
- Produces: `RegistroHoras.loteId: string`; `GrupoLote { loteId, fecha, filas: RegistroPorAprobar[],
  accionables: RegistroPorAprobar[] }`; `agruparPorLote(filas: RegistroPorAprobar[]): GrupoLote[]`.
  Task 7 (`LoteCard`) y Task 8 (wiring de la página) dependen de este tipo y esta función.

- [ ] **Step 1: Agregar `loteId` al tipo `RegistroHoras`**

En `src/types/domain.ts`, dentro de `RegistroHoras`, agregar el campo:

```ts
export interface RegistroHoras {
  id: number;
  loteId: string;
  fecha: string;
  // ...resto sin cambios
```

- [ ] **Step 2: Escribir el test de `agruparPorLote` (falla porque no existe)**

Reemplazar el contenido completo de `src/lib/agrupar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { agruparPorLote } from './agrupar';
import type { RegistroPorAprobar } from '@/types/domain';

function fila(id: number, loteId: string, fecha: string, accionable = true): RegistroPorAprobar {
  return {
    id, loteId, fecha, horas: '8', estado: 'pendiente', alertaHoras: false, motivoDesaprobacion: null,
    operario: { cuil: '20111', apellido_nombre: 'PEREZ' },
    contrato: { id: 1, codigo: 'K5', nombre: 'K5' },
    tareas: [{ tarea: { id: 1, nombre: 'Excavación' } }],
    provincia: { id: 1, nombre: 'Córdoba' },
    moviles: [],
    accionable,
  };
}

describe('agruparPorLote', () => {
  it('agrupa filas del mismo lote en un solo grupo', () => {
    const grupos = agruparPorLote([
      fila(1, 'lote-a', '2026-07-10'),
      fila(2, 'lote-a', '2026-07-10', false),
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].filas).toHaveLength(2);
    expect(grupos[0].accionables).toHaveLength(1);
  });

  it('separa por loteId', () => {
    const grupos = agruparPorLote([
      fila(1, 'lote-a', '2026-07-10'),
      fila(2, 'lote-b', '2026-07-10'),
    ]);
    expect(grupos).toHaveLength(2);
  });

  it('accionables solo incluye las filas con accionable=true', () => {
    const grupos = agruparPorLote([
      fila(1, 'lote-a', '2026-07-10', true),
      fila(2, 'lote-a', '2026-07-10', false),
      fila(3, 'lote-a', '2026-07-10', false),
    ]);
    expect(grupos[0].accionables).toHaveLength(1);
    expect(grupos[0].accionables[0].id).toBe(1);
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npm test -- src/lib/agrupar.test.ts`
Expected: FAIL — `Failed to resolve import` o `agruparPorLote is not a function`.

- [ ] **Step 4: Reemplazar `agrupar.ts`**

Reemplazar el contenido completo de `src/lib/agrupar.ts`:

```ts
import type { RegistroPorAprobar } from '@/types/domain';

export type GrupoLote = {
  loteId: string;
  fecha: string;
  filas: RegistroPorAprobar[];
  accionables: RegistroPorAprobar[];
};

export function agruparPorLote(filas: RegistroPorAprobar[]): GrupoLote[] {
  const mapa = new Map<string, GrupoLote>();
  for (const f of filas) {
    let grupo = mapa.get(f.loteId);
    if (!grupo) {
      grupo = {
        loteId: f.loteId,
        fecha: f.fecha.slice(0, 10),
        filas: [],
        accionables: [],
      };
      mapa.set(f.loteId, grupo);
    }
    grupo.filas.push(f);
    if (f.accionable) grupo.accionables.push(f);
  }
  return [...mapa.values()];
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm test -- src/lib/agrupar.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types/domain.ts src/lib/agrupar.ts src/lib/agrupar.test.ts
git commit -m "feat(aprobaciones): agruparPorLote reemplaza agruparPorOperarioFecha"
```

---

### Task 6: Hook `useResolverLote`

**Files:**
- Modify: `src/lib/api/aprobaciones.ts`

**Interfaces:**
- Consumes: `PATCH /registros-horas/lote/:loteId/resolver` (Task 4 backend).
- Produces: `useResolverLote()` con `mutationFn: (input: { loteId: string; estado: 'aprobado' |
  'desaprobado'; ids?: number[]; motivoDesaprobacion?: string }) => Promise<{ resueltos: number;
  ids: number[] }>`. Task 7 (`LoteCard`) depende de esta firma exacta.

- [ ] **Step 1: Agregar el hook**

En `src/lib/api/aprobaciones.ts`, agregar (después de `useResolverRegistro`, sin tocar los hooks
existentes):

```ts
export function useResolverLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      loteId: string;
      estado: 'aprobado' | 'desaprobado';
      ids?: number[];
      motivoDesaprobacion?: string;
    }) =>
      (await api.patch(`/registros-horas/lote/${input.loteId}/resolver`, {
        estado: input.estado,
        ids: input.ids,
        motivoDesaprobacion: input.motivoDesaprobacion,
      })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['por-aprobar'] }),
  });
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build`
Expected: termina sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/aprobaciones.ts
git commit -m "feat(aprobaciones): hook useResolverLote"
```

---

### Task 7: Componente `LoteCard`

**Files:**
- Create: `src/features/aprobaciones/lote-card.tsx`
- Create: `src/features/aprobaciones/lote-card.test.tsx`

**Interfaces:**
- Consumes: `useResolverLote()` (Task 6), `GrupoLote` (Task 5), `DesaprobarDialog` (ya existe,
  `src/features/aprobaciones/desaprobar-dialog.tsx`, sin cambios).
- Produces: `LoteCard({ grupo: GrupoLote })`. Task 8 (wiring de la página) depende de esta firma.

- [ ] **Step 1: Escribir el test (falla porque el componente no existe)**

Crear `src/features/aprobaciones/lote-card.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GrupoLote } from '@/lib/agrupar';

const resolverLote = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/aprobaciones', () => ({
  useResolverLote: () => ({ mutateAsync: resolverLote, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }));

import { LoteCard } from './lote-card';

function fila(id: number, apellido: string, accionable = true, codigo = 'K5') {
  return {
    id, loteId: 'lote-1', fecha: '2026-07-10', horas: '8', estado: 'pendiente',
    alertaHoras: false, motivoDesaprobacion: null,
    operario: { cuil: `2011${id}`, apellido_nombre: apellido },
    contrato: { id: 1, codigo, nombre: codigo },
    tareas: [{ tarea: { id: 1, nombre: 'Excavación' } }],
    provincia: { id: 1, nombre: 'Córdoba' },
    moviles: [],
    accionable,
  };
}

function grupo(filas = [fila(1, 'PEREZ'), fila(2, 'GOMEZ')]): GrupoLote {
  return {
    loteId: 'lote-1',
    fecha: '2026-07-10',
    filas,
    accionables: filas.filter((f) => f.accionable),
  };
}

describe('LoteCard', () => {
  beforeEach(() => resolverLote.mockClear());

  it('muestra el resumen de operarios accionables y la fecha, colapsado por default', () => {
    render(<LoteCard grupo={grupo()} />);
    expect(screen.getByText('2 operario(s)')).toBeInTheDocument();
    expect(screen.getByText('2026-07-10')).toBeInTheDocument();
    expect(screen.queryByText('PEREZ')).not.toBeInTheDocument();
  });

  it('Aprobar todo (colapsado) resuelve sin ids (todo lo accionable)', async () => {
    render(<LoteCard grupo={grupo()} />);
    await userEvent.click(screen.getByRole('button', { name: /^aprobar todo/i }));
    await waitFor(() =>
      expect(resolverLote).toHaveBeenCalledWith({ loteId: 'lote-1', estado: 'aprobado', ids: undefined }),
    );
  });

  it('al expandir, muestra checkboxes tildados para accionables y filas de otro contrato en gris sin checkbox', async () => {
    render(<LoteCard grupo={grupo([fila(1, 'PEREZ'), fila(2, 'GOMEZ', false, 'K8')])} />);
    await userEvent.click(screen.getByRole('button', { name: /ver detalle/i }));
    expect(screen.getByLabelText('Incluir a PEREZ')).toBeChecked();
    expect(screen.queryByLabelText('Incluir a GOMEZ')).not.toBeInTheDocument();
    expect(screen.getByText('GOMEZ')).toBeInTheDocument();
    expect(screen.getByText(/otro contrato/i)).toBeInTheDocument();
  });

  it('destildar una fila y aprobar seleccionados envía solo los ids tildados', async () => {
    render(<LoteCard grupo={grupo()} />);
    await userEvent.click(screen.getByRole('button', { name: /ver detalle/i }));
    await userEvent.click(screen.getByLabelText('Incluir a GOMEZ'));
    await userEvent.click(screen.getByRole('button', { name: /^aprobar seleccionados/i }));
    await waitFor(() =>
      expect(resolverLote).toHaveBeenCalledWith({ loteId: 'lote-1', estado: 'aprobado', ids: [1] }),
    );
  });

  it('desaprobar exige motivo y llama con ids undefined en modo colapsado', async () => {
    render(<LoteCard grupo={grupo()} />);
    await userEvent.click(screen.getByRole('button', { name: /^desaprobar todo/i }));
    await userEvent.type(screen.getByLabelText(/motivo/i), 'no corresponde');
    await userEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    await waitFor(() =>
      expect(resolverLote).toHaveBeenCalledWith({
        loteId: 'lote-1', estado: 'desaprobado', ids: undefined, motivoDesaprobacion: 'no corresponde',
      }),
    );
  });

  it('botones deshabilitados si expandido y 0 seleccionados', async () => {
    render(<LoteCard grupo={grupo([fila(1, 'PEREZ')])} />);
    await userEvent.click(screen.getByRole('button', { name: /ver detalle/i }));
    await userEvent.click(screen.getByLabelText('Incluir a PEREZ'));
    expect(screen.getByRole('button', { name: /^aprobar seleccionados/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^desaprobar seleccionados/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- src/features/aprobaciones/lote-card.test.tsx`
Expected: FAIL — `Failed to resolve import "./lote-card"`.

- [ ] **Step 3: Implementar `LoteCard`**

Crear `src/features/aprobaciones/lote-card.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useResolverLote } from '@/lib/api/aprobaciones';
import { DesaprobarDialog } from './desaprobar-dialog';
import type { GrupoLote } from '@/lib/agrupar';

export function LoteCard({ grupo }: { grupo: GrupoLote }) {
  const resolverLote = useResolverLote();
  const [expandido, setExpandido] = useState(false);
  const [seleccionados, setSeleccionados] = useState<Set<number>>(
    () => new Set(grupo.accionables.map((f) => f.id)),
  );
  const [desaprobando, setDesaprobando] = useState(false);

  useEffect(() => {
    setSeleccionados(new Set(grupo.accionables.map((f) => f.id)));
  }, [grupo.accionables]);

  function toggleSeleccion(id: number) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function aprobar() {
    if (expandido && seleccionados.size === 0) return;
    const ids = expandido ? [...seleccionados] : undefined;
    toast.promise(resolverLote.mutateAsync({ loteId: grupo.loteId, estado: 'aprobado', ids }), {
      loading: 'Aprobando…',
      success: 'Carga aprobada',
      error: 'No se pudo aprobar',
    });
  }

  function confirmarDesaprobar(motivo: string) {
    setDesaprobando(false);
    const ids = expandido ? [...seleccionados] : undefined;
    toast.promise(
      resolverLote.mutateAsync({
        loteId: grupo.loteId,
        estado: 'desaprobado',
        ids,
        motivoDesaprobacion: motivo,
      }),
      { loading: 'Desaprobando…', success: 'Carga desaprobada', error: 'No se pudo desaprobar' },
    );
  }

  const puedeConfirmar = !expandido || seleccionados.size > 0;
  const etiqueta = expandido ? `seleccionados (${seleccionados.size})` : 'todo';

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
        <h2 className="font-display text-sm font-semibold text-ink">
          {grupo.accionables.length} operario(s)
        </h2>
        <span className="text-sm tabular-nums text-slate">{grupo.fecha}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button
          type="button"
          disabled={resolverLote.isPending || !puedeConfirmar}
          onClick={aprobar}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-ink transition hover:brightness-95 disabled:opacity-50"
        >
          Aprobar {etiqueta}
        </button>
        <button
          type="button"
          disabled={resolverLote.isPending || !puedeConfirmar}
          onClick={() => setDesaprobando(true)}
          className="rounded-md border border-danger px-4 py-2 text-sm text-danger transition hover:bg-danger/10 disabled:opacity-50"
        >
          Desaprobar {etiqueta}
        </button>
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          className="ml-auto rounded-md border border-line px-3 py-1.5 text-sm font-medium text-slate transition hover:bg-accent/60"
        >
          {expandido ? 'Cerrar' : 'Ver detalle ▾'}
        </button>
      </div>

      {expandido && (
        <div className="divide-y divide-line">
          {grupo.filas.map((f) => (
            <div
              key={f.id}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-sm ${
                f.accionable ? '' : 'bg-sand/60 text-slate'
              }`}
            >
              {f.accionable && (
                <input
                  type="checkbox"
                  aria-label={`Incluir a ${f.operario.apellido_nombre}`}
                  checked={seleccionados.has(f.id)}
                  onChange={() => toggleSeleccion(f.id)}
                />
              )}
              <span className="font-medium text-ink">{f.operario.apellido_nombre}</span>
              <span className="font-medium text-ink">{f.contrato.codigo}</span>
              <span className={f.accionable ? 'text-slate' : ''}>
                {f.tareas.map((t) => t.tarea.nombre).join(', ') || '—'}
              </span>
              <span>
                <span className="tabular-nums text-ink">{f.horas}</span> hs
                {f.alertaHoras && (
                  <span className="ml-1 rounded bg-warn/10 px-1 text-xs font-medium text-warn">+16h</span>
                )}
              </span>
              {f.moviles.length > 0 && (
                <span className="text-slate">
                  {f.moviles.map((m) => m.movil.identificador).join(', ')}
                </span>
              )}
              {!f.accionable && (
                <span className="ml-auto text-xs italic text-slate/70">otro contrato</span>
              )}
            </div>
          ))}
        </div>
      )}

      {desaprobando && (
        <DesaprobarDialog onCancel={() => setDesaprobando(false)} onConfirm={confirmarDesaprobar} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- src/features/aprobaciones/lote-card.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint y build**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/features/aprobaciones/lote-card.tsx src/features/aprobaciones/lote-card.test.tsx
git commit -m "feat(aprobaciones): componente LoteCard (aprobación en bloque)"
```

---

### Task 8: Wiring en `aprobaciones/page.tsx`

**Files:**
- Modify: `src/app/(protected)/aprobaciones/page.tsx`
- Modify: `src/app/(protected)/aprobaciones/aprobaciones-page.test.tsx`

**Interfaces:**
- Consumes: `agruparPorLote` (Task 5), `LoteCard` (Task 7).

- [ ] **Step 1: Reescribir el test (falla porque la página todavía agrupa por operario+fecha)**

Reemplazar el contenido completo de `src/app/(protected)/aprobaciones/aprobaciones-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const resolverLote = vi.fn().mockResolvedValue({});

function fila(id: number, loteId: string, accionable: boolean, codigo = 'K5') {
  return {
    id, loteId, fecha: '2026-07-10', horas: '8', estado: 'pendiente', alertaHoras: false, motivoDesaprobacion: null,
    operario: { cuil: '20111', apellido_nombre: 'PEREZ JUAN' },
    contrato: { id: 1, codigo, nombre: codigo },
    tareas: [{ tarea: { id: 1, nombre: 'Excavación' } }],
    provincia: { id: 1, nombre: 'Córdoba' }, moviles: [], accionable,
  };
}

vi.mock('@/lib/api/aprobaciones', () => ({
  usePorAprobar: () => ({
    data: [fila(1, 'lote-a', true), fila(2, 'lote-a', false, 'K8'), fila(3, 'lote-b', true)],
    isLoading: false,
  }),
  useResolverLote: () => ({ mutateAsync: resolverLote, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { promise: vi.fn() } }));

import AprobacionesPage from './page';

describe('AprobacionesPage', () => {
  beforeEach(() => resolverLote.mockClear());

  it('agrupa por lote: 2 lotes distintos → 2 tarjetas, cada una con su botón Aprobar todo', () => {
    render(<AprobacionesPage />);
    expect(screen.getAllByRole('button', { name: /^aprobar todo/i })).toHaveLength(2);
  });

  it('expandir un lote muestra su detalle sin afectar al otro', async () => {
    render(<AprobacionesPage />);
    const detalles = screen.getAllByRole('button', { name: /ver detalle/i });
    await userEvent.click(detalles[0]);
    expect(screen.getAllByRole('button', { name: /^aprobar seleccionados/i })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- "src/app/(protected)/aprobaciones/aprobaciones-page.test.tsx"`
Expected: FAIL — la página sigue usando `agruparPorOperarioFecha`/`usePorAprobar` con la forma
vieja, no hay botones "Aprobar todo".

- [ ] **Step 3: Reescribir la página**

Reemplazar el contenido completo de `src/app/(protected)/aprobaciones/page.tsx`:

```tsx
'use client';

import { useMemo } from 'react';
import { usePorAprobar } from '@/lib/api/aprobaciones';
import { agruparPorLote } from '@/lib/agrupar';
import { LoteCard } from '@/features/aprobaciones/lote-card';
import { PageHeader } from '@/components/page-header';

export default function AprobacionesPage() {
  const { data, isLoading } = usePorAprobar();
  // useMemo: agruparPorLote() arma arrays nuevos en cada llamada. Sin memoizar,
  // grupo.accionables cambiaría de referencia en cada render del padre y
  // resetearía la selección de checkboxes de LoteCard sin necesidad.
  const grupos = useMemo(() => agruparPorLote(data ?? []), [data]);

  if (isLoading) return <p className="text-slate">Cargando…</p>;

  return (
    <section className="space-y-5">
      <PageHeader eyebrow="Jefe de contrato" title="Aprobaciones" />
      {grupos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center text-sm text-slate">
          No hay registros pendientes.
        </div>
      ) : (
        grupos.map((g) => <LoteCard key={g.loteId} grupo={g} />)
      )}
    </section>
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- "src/app/(protected)/aprobaciones/aprobaciones-page.test.tsx"`
Expected: PASS (2 tests).

- [ ] **Step 5: Correr también el test de `LoteCard` (no debe haber roto nada)**

Run: `npm test -- src/features/aprobaciones/lote-card.test.tsx "src/app/(protected)/aprobaciones/aprobaciones-page.test.tsx" src/lib/agrupar.test.ts`
Expected: PASS (11 tests en total).

- [ ] **Step 6: Lint y build**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(protected)/aprobaciones/page.tsx" "src/app/(protected)/aprobaciones/aprobaciones-page.test.tsx"
git commit -m "feat(aprobaciones): cablear LoteCard en /aprobaciones"
```

---

### Task 9: Componente `RegistrosCards`

**Files:**
- Create: `src/features/mis-registros/registros-cards.tsx`
- Create: `src/features/mis-registros/registros-cards.test.tsx`

**Interfaces:**
- Produces: `RegistrosCards({ registros: RegistroHoras[] | undefined; quincena: Quincena;
  isLoading: boolean; mostrarOperario?: boolean })` — mismo contrato que `RegistrosTabla` (que
  reemplaza). Task 10 (wiring) depende de esta firma idéntica.

- [ ] **Step 1: Escribir el test (falla porque el componente no existe)**

Crear `src/features/mis-registros/registros-cards.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RegistrosCards } from './registros-cards';
import type { RegistroHoras } from '@/types/domain';
import type { Quincena } from '@/lib/quincena';

function reg(
  id: number,
  fecha: string,
  horas: string,
  estado: RegistroHoras['estado'] = 'aprobado',
  codigo = 'K5',
): RegistroHoras {
  return {
    id, loteId: `lote-${id}`, fecha, horas, estado, alertaHoras: false, motivoDesaprobacion: null,
    operario: { cuil: '20111', apellido_nombre: 'PEREZ JUAN' },
    contrato: { id: 1, codigo, nombre: codigo },
    tareas: [{ tarea: { id: 1, nombre: 'Excavación' } }],
    provincia: { id: 1, nombre: 'Córdoba' },
    moviles: [],
  };
}

const QUINCENA_1: Quincena = { anio: 2026, mes: 7, parte: 1 };

describe('RegistrosCards', () => {
  it('muestra el total grande de la quincena', () => {
    render(<RegistrosCards registros={[reg(1, '2026-07-05', '8'), reg(2, '2026-07-10', '6')]} quincena={QUINCENA_1} isLoading={false} />);
    expect(screen.getByText('14 hs')).toBeInTheDocument();
  });

  it('una tarjeta por registro, no por día — 2 líneas el mismo día son 2 tarjetas', () => {
    render(
      <RegistrosCards
        registros={[reg(1, '2026-07-05', '8', 'aprobado', 'K5'), reg(2, '2026-07-05', '5', 'pendiente', 'K8')]}
        quincena={QUINCENA_1}
        isLoading={false}
      />,
    );
    expect(screen.getByText('K5')).toBeInTheDocument();
    expect(screen.getByText('K8')).toBeInTheDocument();
    expect(screen.getAllByText('2026-07-05')).toHaveLength(2);
  });

  it('filtra fuera de la quincena seleccionada', () => {
    render(<RegistrosCards registros={[reg(1, '2026-07-20', '8')]} quincena={QUINCENA_1} isLoading={false} />);
    expect(screen.getByText('Sin registros en esta quincena.')).toBeInTheDocument();
  });

  it('mostrarOperario agrega el nombre del operario en la tarjeta', () => {
    render(<RegistrosCards registros={[reg(1, '2026-07-05', '8')]} quincena={QUINCENA_1} isLoading={false} mostrarOperario />);
    expect(screen.getByText('PEREZ JUAN')).toBeInTheDocument();
  });

  it('muestra el motivo de desaprobación visible (no oculto en tooltip)', () => {
    const r = { ...reg(1, '2026-07-05', '8', 'desaprobado'), motivoDesaprobacion: 'faltan datos' };
    render(<RegistrosCards registros={[r]} quincena={QUINCENA_1} isLoading={false} />);
    expect(screen.getByText(/faltan datos/)).toBeInTheDocument();
  });

  it('isLoading muestra el estado de carga', () => {
    render(<RegistrosCards registros={undefined} quincena={QUINCENA_1} isLoading />);
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- src/features/mis-registros/registros-cards.test.tsx`
Expected: FAIL — `Failed to resolve import "./registros-cards"`.

- [ ] **Step 3: Implementar `RegistrosCards`**

Crear `src/features/mis-registros/registros-cards.tsx`:

```tsx
'use client';

import { useMemo } from 'react';
import { enQuincena, type Quincena } from '@/lib/quincena';
import { StatusBadge } from '@/components/status-badge';
import type { RegistroHoras } from '@/types/domain';

export function RegistrosCards({
  registros,
  quincena,
  isLoading,
  mostrarOperario = false,
}: {
  registros: RegistroHoras[] | undefined;
  quincena: Quincena;
  isLoading: boolean;
  mostrarOperario?: boolean;
}) {
  const filtrados = useMemo(
    () => (registros ?? []).filter((r) => enQuincena(r.fecha, quincena)),
    [registros, quincena],
  );
  const total = useMemo(
    () => filtrados.reduce((s, r) => s + Number(r.horas), 0),
    [filtrados],
  );

  if (isLoading) return <p className="text-slate">Cargando…</p>;
  if (filtrados.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center text-sm text-slate">
        Sin registros en esta quincena.
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-brand p-5 text-center">
        <div className="text-xs font-medium uppercase tracking-wide text-ink/70">
          Total {quincena.parte === 1 ? '1ª' : '2ª'} quincena
        </div>
        <div className="text-4xl font-extrabold tabular-nums text-ink">{total} hs</div>
      </div>

      <div className="space-y-2">
        {filtrados.map((r) => (
          <div key={r.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium text-ink">{r.fecha.slice(0, 10)}</div>
                {mostrarOperario && <div className="text-sm text-slate">{r.operario.apellido_nombre}</div>}
                <div className="text-sm text-slate">
                  {r.contrato.codigo} · {r.tareas.map((t) => t.tarea.nombre).join(', ') || '—'}
                </div>
                {r.moviles.length > 0 && (
                  <div className="text-xs text-slate/70">
                    {r.moviles.map((m) => m.movil.identificador).join(', ')}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-lg font-bold tabular-nums text-ink">
                  {r.horas} hs
                  {r.alertaHoras && (
                    <span className="ml-1 rounded bg-warn/10 px-1 text-xs font-medium text-warn">+16h</span>
                  )}
                </div>
                <StatusBadge estado={r.estado} />
              </div>
            </div>
            {r.estado === 'desaprobado' && r.motivoDesaprobacion && (
              <p className="mt-2 text-xs text-danger">Motivo: {r.motivoDesaprobacion}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- src/features/mis-registros/registros-cards.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint y build**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/features/mis-registros/registros-cards.tsx src/features/mis-registros/registros-cards.test.tsx
git commit -m "feat(mis-registros): componente RegistrosCards (total grande + tarjetas)"
```

---

### Task 10: Wiring en `mis-registros/page.tsx` + fix de test preexistente

**Files:**
- Modify: `src/app/(protected)/mis-registros/page.tsx`
- Modify: `src/app/(protected)/mis-registros/mis-registros-page.test.tsx`

**Interfaces:**
- Consumes: `RegistrosCards` (Task 9).

**Nota:** el test actual de esta página depende implícitamente de la quincena del día en que corre
(usa `quincenaDeFecha(new Date())` como default) con fechas de fixture hardcodeadas — eso ya rompió
una vez al cruzar un límite de quincena real (ver nota en el plan anterior,
`docs/superpowers/plans/2026-07-16-edicion-contratos-jefe.md`). Esta tarea lo corrige de paso,
seleccionando la quincena explícitamente en el test en vez de depender del default.

- [ ] **Step 1: Reemplazar `page.tsx` — swap de import**

En `src/app/(protected)/mis-registros/page.tsx`, cambiar el import:

```ts
import { RegistrosCards } from '@/features/mis-registros/registros-cards';
```

Y reemplazar los dos usos de `<RegistrosTabla ... />` por `<RegistrosCards ... />` (mismas props,
sin otro cambio):

```tsx
      {esJdC && tab === 'cargadas' ? (
        <RegistrosCards
          registros={cargadas.data}
          quincena={q}
          isLoading={cargadas.isLoading}
          mostrarOperario
        />
      ) : (
        <RegistrosCards registros={mias.data} quincena={q} isLoading={mias.isLoading} />
      )}
```

- [ ] **Step 2: Reescribir el test, seleccionando la quincena explícitamente**

Reemplazar el contenido completo de
`src/app/(protected)/mis-registros/mis-registros-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

function reg(id: number, fecha: string, horas: string, apellido = 'X', estado = 'aprobado') {
  return {
    id, loteId: `lote-${id}`, fecha, horas, estado, alertaHoras: false, motivoDesaprobacion: null,
    operario: { cuil: '20111', apellido_nombre: apellido },
    contrato: { id: 1, codigo: 'K5', nombre: 'K5' },
    tareas: [{ tarea: { id: 9, nombre: 'Excavación' } }],
    provincia: { id: 1, nombre: 'Córdoba' },
    moviles: [],
  };
}

const h = vi.hoisted(() => ({
  perfil: { cuil: '20111', rol: { nombre: 'Operario' } } as { cuil: string; rol: { nombre: string } },
  mias: [] as ReturnType<typeof reg>[],
  cargadas: [] as ReturnType<typeof reg>[],
}));

vi.mock('@/lib/auth/session', () => ({ useSession: () => ({ perfil: h.perfil }) }));
vi.mock('@/lib/api/registros', () => ({
  useMisRegistros: () => ({ data: h.mias, isLoading: false }),
  useCargasQueHice: () => ({ data: h.cargadas, isLoading: false }),
}));

import MisRegistrosPage from './page';

/** Fuerza la quincena a Julio 2026, 1ª — independiente de la fecha real del día que corre el test. */
async function irAJulio1ra2026() {
  await userEvent.selectOptions(screen.getByLabelText('Mes'), '7');
  await userEvent.clear(screen.getByLabelText('Año'));
  await userEvent.type(screen.getByLabelText('Año'), '2026');
  await userEvent.selectOptions(screen.getByLabelText('Quincena'), '1');
}

describe('MisRegistrosPage', () => {
  beforeEach(() => {
    h.perfil = { cuil: '20111', rol: { nombre: 'Operario' } };
    h.mias = [reg(1, '2026-07-10', '8'), reg(2, '2026-07-20', '5')];
    h.cargadas = [];
  });

  it('Operario: muestra sus registros de la quincena seleccionada y NO ve pestañas', async () => {
    render(<MisRegistrosPage />);
    await irAJulio1ra2026();
    expect(screen.getByText('Excavación')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cargas que hice/i })).toBeNull();
  });

  it('JefeCuadrilla: ve dos pestañas y "Cargas que hice" muestra al operario cargado', async () => {
    h.perfil = { cuil: '20111', rol: { nombre: 'JefeCuadrilla' } };
    h.cargadas = [reg(3, '2026-07-05', '7', 'GOMEZ SEGUNDO ALBERTO')];
    render(<MisRegistrosPage />);
    expect(screen.getByRole('button', { name: /mis horas/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /cargas que hice/i }));
    await irAJulio1ra2026();
    expect(screen.getByText('GOMEZ SEGUNDO ALBERTO')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Correr el test y verificar que pasa**

Run: `npm test -- "src/app/(protected)/mis-registros/mis-registros-page.test.tsx"`
Expected: PASS (2 tests) — determinístico sin importar qué día corre.

- [ ] **Step 4: Correr también el test de `RegistrosCards`**

Run: `npm test -- src/features/mis-registros/registros-cards.test.tsx "src/app/(protected)/mis-registros/mis-registros-page.test.tsx"`
Expected: PASS (8 tests en total).

- [ ] **Step 5: Verificar que `RegistrosTabla` quedó huérfana y borrarla**

Run: `grep -rn "RegistrosTabla" src --include="*.tsx" --include="*.ts"` (o equivalente con Grep).
Si el único resultado es la propia definición en `registros-tabla.tsx`, borrar ese archivo (ya no
tiene consumidores — `RegistrosCards` lo reemplazó por completo). Si aparece algún otro uso,
reportarlo y no borrar (dejarlo para revisión).

- [ ] **Step 6: Lint y build**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(protected)/mis-registros/page.tsx" "src/app/(protected)/mis-registros/mis-registros-page.test.tsx"
git rm --ignore-unmatch src/features/mis-registros/registros-tabla.tsx
git commit -m "feat(mis-registros): cablear RegistrosCards, fix test dependiente de la fecha del día"
```

---

### Task 11: Componente `MovilesSelect`

**Files:**
- Create: `src/features/reporte/moviles-select.tsx`
- Create: `src/features/reporte/moviles-select.test.tsx`

**Interfaces:**
- Produces: `MovilesSelect({ moviles: Movil[]; value: number[]; onChange: (ids: number[]) => void
  })`. Task 13 (wiring) depende de esta firma.

- [ ] **Step 1: Escribir el test (falla porque el componente no existe)**

Crear `src/features/reporte/moviles-select.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MovilesSelect } from './moviles-select';

const MOVILES = [
  { id: 1, identificador: 'M-01', descripcion: null },
  { id: 2, identificador: 'M-02', descripcion: null },
];

describe('MovilesSelect', () => {
  it('cerrado por default, muestra "Móviles ▾" sin selección', () => {
    render(<MovilesSelect moviles={MOVILES} value={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Móviles ▾' })).toBeInTheDocument();
    expect(screen.queryByText('M-01')).not.toBeInTheDocument();
  });

  it('muestra la cantidad seleccionada en el botón', () => {
    render(<MovilesSelect moviles={MOVILES} value={[1]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /1 seleccionados/i })).toBeInTheDocument();
  });

  it('al abrir, tildar un móvil llama onChange con el id agregado', async () => {
    const onChange = vi.fn();
    render(<MovilesSelect moviles={MOVILES} value={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /móviles/i }));
    await userEvent.click(screen.getByText('M-01'));
    expect(onChange).toHaveBeenCalledWith([1]);
  });

  it('destildar un móvil ya seleccionado llama onChange sin ese id', async () => {
    const onChange = vi.fn();
    render(<MovilesSelect moviles={MOVILES} value={[1, 2]} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /móviles/i }));
    await userEvent.click(screen.getByText('M-01'));
    expect(onChange).toHaveBeenCalledWith([2]);
  });

  it('click afuera cierra el desplegable', async () => {
    render(
      <div>
        <MovilesSelect moviles={MOVILES} value={[]} onChange={vi.fn()} />
        <button type="button">afuera</button>
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: /móviles/i }));
    expect(screen.getByText('M-01')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'afuera' }));
    expect(screen.queryByText('M-01')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- src/features/reporte/moviles-select.test.tsx`
Expected: FAIL — `Failed to resolve import "./moviles-select"`.

- [ ] **Step 3: Implementar `MovilesSelect`**

Crear `src/features/reporte/moviles-select.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { Movil } from '@/types/domain';

export function MovilesSelect({
  moviles,
  value,
  onChange,
}: {
  moviles: Movil[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickFuera(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener('mousedown', onClickFuera);
    return () => document.removeEventListener('mousedown', onClickFuera);
  }, []);

  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }

  const etiqueta = value.length > 0 ? `Móviles (${value.length} seleccionados) ▾` : 'Móviles ▾';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
      >
        {etiqueta}
      </button>
      {abierto && (
        <div className="absolute z-10 mt-1 max-h-56 w-56 overflow-auto rounded-md border border-line bg-surface p-2 shadow-lg">
          {moviles.length === 0 ? (
            <p className="px-1 py-1 text-xs text-slate/70">No hay móviles cargados.</p>
          ) : (
            moviles.map((m) => (
              <label
                key={m.id}
                className="flex items-center gap-2 rounded px-1 py-1.5 text-sm text-ink hover:bg-accent/60"
              >
                <input type="checkbox" checked={value.includes(m.id)} onChange={() => toggle(m.id)} />
                {m.identificador}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- src/features/reporte/moviles-select.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint y build**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/features/reporte/moviles-select.tsx src/features/reporte/moviles-select.test.tsx
git commit -m "feat(reporte): componente MovilesSelect (dropdown con checkboxes)"
```

---

### Task 12: Componente `CargandoModal`

**Files:**
- Create: `src/features/reporte/cargando-modal.tsx`
- Create: `src/features/reporte/cargando-modal.test.tsx`

**Interfaces:**
- Produces: `CargandoModal({ texto?: string })` (default `'Cargando reporte…'`). Task 13 (wiring)
  depende de esta firma.

- [ ] **Step 1: Escribir el test (falla porque el componente no existe)**

Crear `src/features/reporte/cargando-modal.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CargandoModal } from './cargando-modal';

describe('CargandoModal', () => {
  it('muestra el texto de carga por default', () => {
    render(<CargandoModal />);
    expect(screen.getByText('Cargando reporte…')).toBeInTheDocument();
  });

  it('acepta un texto custom', () => {
    render(<CargandoModal texto="Enviando…" />);
    expect(screen.getByText('Enviando…')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- src/features/reporte/cargando-modal.test.tsx`
Expected: FAIL — `Failed to resolve import "./cargando-modal"`.

- [ ] **Step 3: Implementar `CargandoModal`**

Crear `src/features/reporte/cargando-modal.tsx`:

```tsx
export function CargandoModal({ texto = 'Cargando reporte…' }: { texto?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-6 py-5 shadow-lg">
        <span
          role="status"
          aria-label="Cargando"
          className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent"
        />
        <span className="text-sm font-medium text-ink">{texto}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- src/features/reporte/cargando-modal.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Lint y build**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/features/reporte/cargando-modal.tsx src/features/reporte/cargando-modal.test.tsx
git commit -m "feat(reporte): componente CargandoModal"
```

---

### Task 13: Wiring en `reporte/page.tsx` — móviles + envío directo

**Files:**
- Modify: `src/app/(protected)/reporte/page.tsx`
- Modify: `src/app/(protected)/reporte/reporte-page.test.tsx`

**Interfaces:**
- Consumes: `MovilesSelect` (Task 11), `CargandoModal` (Task 12).

- [ ] **Step 1: Reescribir el test**

Reemplazar el contenido completo de `src/app/(protected)/reporte/reporte-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mutateAsync = vi.fn().mockResolvedValue({ creados: 1, registros: [] });
const h = vi.hoisted(() => ({ isPending: false }));

vi.mock('@/lib/auth/session', () => ({
  useSession: () => ({
    perfil: {
      cuil: '20111',
      rol: { nombre: 'Operario' },
      empleado: { apellido_nombre: 'X' },
      contratosHabilitados: [{ contrato: { id: 1, codigo: 'K5', nombre: 'K5' } }],
    },
  }),
}));
vi.mock('@/lib/api/catalogos', () => ({
  useProvincias: () => ({ data: [{ id: 1, nombre: 'Córdoba' }] }),
  useMoviles: () => ({ data: [{ id: 1, identificador: 'M-01', descripcion: null }] }),
  useTareas: () => ({ data: [{ id: 9, nombre: 'Excavación' }] }),
}));
vi.mock('@/lib/api/registros', () => ({
  useCrearReporteBatch: () => ({ mutateAsync, isPending: h.isPending }),
}));
vi.mock('@/lib/api/empleados', () => ({
  useBuscarEmpleados: () => ({ data: [{ cuil: '20169', apellido_nombre: 'GOMEZ', legajo: 1, cargo: 'OF' }] }),
}));
vi.mock('@/features/reporte/use-geolocation', () => ({ useGeolocation: () => ({ estado: 'denegado', coords: null }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), promise: vi.fn() } }));

import ReportePage from './page';

describe('ReportePage', () => {
  beforeEach(() => {
    mutateAsync.mockClear();
    h.isPending = false;
  });

  it('no envía si no hay operarios ni líneas completas', () => {
    render(<ReportePage />);
    expect(screen.getByRole('button', { name: /reportar/i })).toBeDisabled();
  });

  it('con 1 operario y 1 línea completa envía el batch directo, sin modal de confirmación', async () => {
    render(<ReportePage />);
    await userEvent.type(screen.getByPlaceholderText(/buscar operario/i), 'gomez');
    await userEvent.click(await screen.findByText(/GOMEZ/));
    await userEvent.selectOptions(screen.getByLabelText('Contrato'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Excavación' }));
    await userEvent.type(screen.getByLabelText('Horas'), '8');
    await userEvent.click(screen.getByRole('button', { name: /reportar/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mutateAsync.mock.calls[0][0];
    expect(payload.operarioCuils).toEqual(['20169']);
    expect(payload.lineas).toEqual([{ contratoId: 1, horas: 8, tareaIds: [9] }]);
    expect(payload.provinciaId).toBe(1);
  });

  it('muestra el modal de carga mientras la mutación está pendiente', () => {
    h.isPending = true;
    render(<ReportePage />);
    expect(screen.getByText('Cargando reporte…')).toBeInTheDocument();
  });

  it('el selector de móviles reemplaza los chips por un desplegable', () => {
    render(<ReportePage />);
    expect(screen.getByRole('button', { name: /móviles/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- "src/app/(protected)/reporte/reporte-page.test.tsx"`
Expected: FAIL — todavía pide el paso de "Confirmar", no hay botón "Móviles ▾", no hay texto
"Cargando reporte…" cuando `isPending`.

- [ ] **Step 3: Reescribir `page.tsx`**

Reemplazar el contenido completo de `src/app/(protected)/reporte/page.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useSession } from '@/lib/auth/session';
import { useProvincias, useMoviles } from '@/lib/api/catalogos';
import { useCrearReporteBatch } from '@/lib/api/registros';
import { OperariosSelect } from '@/features/reporte/operarios-select';
import { LineasField, type LineaBorrador } from '@/features/reporte/lineas-field';
import { MovilesSelect } from '@/features/reporte/moviles-select';
import { CargandoModal } from '@/features/reporte/cargando-modal';
import { useGeolocation } from '@/features/reporte/use-geolocation';
import { PageHeader } from '@/components/page-header';
import type { EmpleadoBusqueda } from '@/types/domain';

function hoyISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="mb-4 border-l-[3px] border-brand pl-2.5 font-display text-sm font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function ReportePage() {
  const { perfil } = useSession();
  const contratos = (perfil?.contratosHabilitados ?? []).map((c) => c.contrato);
  const { data: provincias } = useProvincias();
  const { data: moviles } = useMoviles();
  const { coords, estado: gps } = useGeolocation();
  const crear = useCrearReporteBatch();

  const [fecha, setFecha] = useState(hoyISO());
  const [provinciaId, setProvinciaId] = useState<number | null>(null);
  const [movilIds, setMovilIds] = useState<number[]>([]);
  const [operarios, setOperarios] = useState<EmpleadoBusqueda[]>([]);
  const [lineas, setLineas] = useState<LineaBorrador[]>([
    { contratoId: null, horas: null, tareaIds: [] },
  ]);

  const provinciaSel = provinciaId ?? provincias?.[0]?.id ?? null;

  const lineasCompletas = useMemo(
    () =>
      lineas.filter(
        (l) => l.contratoId != null && l.horas != null && l.horas > 0 && l.tareaIds.length > 0,
      ),
    [lineas],
  );
  const puedeEnviar = operarios.length > 0 && lineasCompletas.length > 0 && provinciaSel != null;

  async function enviar() {
    if (!puedeEnviar || provinciaSel == null) return;
    const promesa = crear.mutateAsync({
      fecha,
      provinciaId: provinciaSel,
      gpsLat: coords?.lat,
      gpsLng: coords?.lng,
      movilIds: movilIds.length ? movilIds : undefined,
      operarioCuils: operarios.map((o) => o.cuil),
      lineas: lineasCompletas.map((l) => ({
        contratoId: l.contratoId!,
        horas: l.horas!,
        tareaIds: l.tareaIds,
      })),
    });
    toast.promise(promesa, {
      loading: 'Cargando reporte…',
      success: 'Reporte cargado',
      error: (e: unknown) =>
        String(
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
            'No se pudo cargar el reporte',
        ),
    });
    try {
      await promesa;
      setOperarios([]);
      setLineas([{ contratoId: null, horas: null, tareaIds: [] }]);
    } catch {
      // el toast.promise ya avisó el error
    }
  }

  const gpsLabel =
    gps === 'ok' && coords
      ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`
      : gps === 'capturando'
        ? 'capturando…'
        : gps === 'denegado'
          ? 'sin permiso (se guarda igual)'
          : 'no disponible';

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Carga de horas" title="Reporte diario" />

      <Card title="Datos de la jornada">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col text-sm font-medium text-ink">
            Fecha
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="mt-1 rounded-md border border-line bg-surface px-3 py-2 text-ink tabular-nums outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </label>
          <label className="flex flex-col text-sm font-medium text-ink">
            Provincia
            <select
              aria-label="Provincia"
              value={provinciaSel ?? ''}
              onChange={(e) => setProvinciaId(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 rounded-md border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            >
              <option value="">—</option>
              {(provincias ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="mt-3 text-xs text-slate">
          GPS: <span className="tabular-nums text-ink/70">{gpsLabel}</span>
        </p>

        <div className="mt-4">
          <p className="text-sm font-medium text-ink">Móviles</p>
          <div className="mt-1.5">
            <MovilesSelect moviles={moviles ?? []} value={movilIds} onChange={setMovilIds} />
          </div>
        </div>
      </Card>

      <Card title="Operarios">
        <OperariosSelect value={operarios} onChange={setOperarios} />
      </Card>

      <Card title="Contratos y tareas">
        <LineasField contratos={contratos} value={lineas} onChange={setLineas} />
      </Card>

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end border-t border-line bg-sand/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <button
          type="button"
          disabled={!puedeEnviar || crear.isPending}
          onClick={enviar}
          className="rounded-md bg-brand px-5 py-2 font-medium text-ink transition hover:brightness-95 disabled:opacity-50"
        >
          Reportar
        </button>
      </div>

      {crear.isPending && <CargandoModal />}
    </div>
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- "src/app/(protected)/reporte/reporte-page.test.tsx"`
Expected: PASS (4 tests).

- [ ] **Step 5: Verificar que `lib/reporte-preview.ts` quedó sin consumidores**

Run: `grep -rn "contarFilas\|reporte-preview" src --include="*.tsx" --include="*.ts"` (o
equivalente con Grep). Si el único resultado es la propia definición de `reporte-preview.ts` y su
test (`reporte-preview.test.ts`, si existe), dejarlo así sin borrar — no forma parte del alcance
de este plan, puede quedar como utilidad sin uso por ahora (no genera error de build ni de lint).
Si aparece otro consumidor real, reportarlo.

- [ ] **Step 6: Correr toda la suite tocada**

Run: `npm test -- "src/app/(protected)/reporte/reporte-page.test.tsx" src/features/reporte/moviles-select.test.tsx src/features/reporte/cargando-modal.test.tsx`
Expected: PASS (11 tests en total).

- [ ] **Step 7: Lint y build**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(protected)/reporte/page.tsx" "src/app/(protected)/reporte/reporte-page.test.tsx"
git commit -m "feat(reporte): selector de móviles + envío directo con modal de carga"
```

---

### Task 14: Verificación final

**Files:** ninguno (solo comandos) + actualización de contexto.

- [ ] **Step 1: Suite completa de frontend**

Run: `npm test`
Expected: todos los tests pasan (los existentes + los nuevos de esta feature). En particular,
`mis-registros-page.test.tsx` ya no depende de la fecha del día (Task 10).

- [ ] **Step 2: Lint y build de frontend**

Run: `npm run lint && npm run build`
Expected: ambos terminan sin errores.

- [ ] **Step 3: Build de backend**

Desde `Forms_Horas_ST_back`:

Run: `npm run build`
Expected: termina sin errores.

- [ ] **Step 4: Checklist de verificación manual E2E (a cargo del usuario)**

Con el backend y el frontend corriendo, y logueado con usuarios reales:

- [ ] Cargar una carga masiva con varios operarios en un contrato propio + otro contrato ajeno →
      en `/aprobaciones`, confirmar que aparece **una** tarjeta de lote, con "Aprobar todo"
      resolviendo todas las filas del contrato propio de un solo click, y las del otro contrato
      visibles en gris sin acción.
- [ ] Expandir el detalle de una tarjeta, destildar un operario, aprobar el resto → confirmar que
      el destildado sigue `pendiente` y el resto queda `aprobado`.
- [ ] Repetir el flujo con "Desaprobar" (motivo obligatorio).
- [ ] `/mis-registros`: confirmar el total grande arriba y una tarjeta por registro.
- [ ] `/reporte`: confirmar el selector de móviles con checkboxes (sin buscador), y que "Reportar"
      ya no pide confirmación — muestra el modal de carga y al terminar limpia el formulario.

- [ ] **Step 5: Actualizar el contexto del proyecto**

Agregar una entrada nueva en `.claude/Contexto/contexto-proyecto.md` (verificar el número de
sección siguiente y la ruta real del archivo antes de editar) resumiendo: aprobación por carga
(`loteId`, ver ADR-004) reemplaza la aprobación fila por fila en `/aprobaciones`; rediseño de
`/mis-registros` (total grande + tarjetas por registro); selector de móviles con checkboxes en
`/reporte`; envío directo sin modal de confirmación previa. Mencionar el fix del test
`mis-registros-page.test.tsx` (ya no depende de la fecha del día).

- [ ] **Step 6: Commit final**

```bash
git add .claude/Contexto/contexto-proyecto.md
git commit -m "docs: contexto — aprobación por carga y mejoras UX (mis registros, móviles, envío)"
```
