# Control general — réplica visual del tablero Looker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar `/control-general` con la estructura del tablero Looker que usaban los Jefes de Contrato (filtros Contrato+Provincia, stat tile de horas totales, gráfico histórico por quincena, ranking top 10, detalle diario), manteniendo la estética actual de la app.

**Architecture:** Backend NestJS+Prisma agrega 3 endpoints nuevos (`mis-contratos`, `historico-quincenas`, `detalle-diario`) y extiende `resumen-operarios` con filtros server-side por contrato/provincia. Frontend Next.js reorganiza la página con dos componentes de gráfico hechos a mano (sin librería de charts) y el MultiFiltro estándar.

**Tech Stack:** NestJS 11 + Prisma (Backend), Next.js 16 + React 19 + Tailwind 4 + TanStack Query + Vitest (Frontend). Sin dependencias nuevas.

## Global Constraints

- Repos: Backend `C:\Users\Administrador\Desktop\SE Gero\Aplicaciones Web\Formulario_Horas\Backend`, Frontend `...\Formulario_Horas\Frontend`. Rama en ambos: `feature/control-general-looker` (crear desde `main`).
- Decisiones de producto (grilling 2026-08-10): filtros por **Contrato y Provincia** (la provincia es la del registro de horas, FK `sth_provincias`); horas del gráfico/tile = **pendientes + aprobadas, excluye rechazadas**; alcance = **"mis contratos"** (Admin: todos); umbral de control se ratifica en **≥16hs/día** (NO se adopta el >13 del Looker); "Días SIN Horas" del Looker NO se replica (queda la sección "Sin carga" actual); ranking = **top 10, barras horizontales**; histórico = **12 meses = 24 quincenas** terminando en la quincena seleccionada.
- Colores de gráficos (validados con dataviz sobre superficie blanca): serie "1ra quincena" `#a97a16` (token `brand-deep` existente), serie "2da quincena" `#3b6fc4` (token nuevo solo-charts), ranking mono-serie `#a97a16`. Texto siempre en tokens de texto (`text-ink`/`text-slate`), nunca del color de la serie. Leyenda obligatoria en el gráfico de 2 series; el ranking (1 serie) no lleva leyenda.
- Query params de listas de ids: comma-separated (`contratoIds=1,2&provinciaIds=3`), opcionales — ausentes = sin filtro.
- Backend: specs con Jest mockeando Prisma, siguiendo el patrón de `src/registros-horas/registros-horas.service.spec.ts` existente. Verificación: `npx jest registros-horas` y `npx nest build`.
- Frontend: tests Vitest + Testing Library por archivo (NO correr la suite completa — en esta máquina de 2 núcleos no termina; correr `npx vitest run <archivo>`), y `npx tsc --noEmit`.
- Commits frecuentes, mensajes en español estilo repo (`feat(control-general): ...`), con el trailer Co-Authored-By de Claude.

## Contrato de datos entre tareas (referencia rápida)

```ts
// GET /registros-horas/mis-contratos  → MisContrato[]
interface MisContrato { id: number; codigo: string; nombre: string }

// GET /registros-horas/resumen-operarios?anio&mes&quincena[&contratoIds&provinciaIds] → ResumenOperario[] (shape actual, sin cambios)

// GET /registros-horas/historico-quincenas?anio&mes&quincena[&contratoIds&provinciaIds] → PuntoHistorico[]
// 24 quincenas terminando en la seleccionada, orden cronológico ascendente.
interface PuntoHistorico { anio: number; mes: number; quincena: 1 | 2; horas: number }

// GET /registros-horas/detalle-diario?anio&mes&quincena[&contratoIds&provinciaIds] → FilaDetalleDiario[]
// Orden: fecha desc, luego operarioNombre asc.
interface FilaDetalleDiario {
  id: number;
  fecha: string; // YYYY-MM-DD
  contratoId: number;
  contratoCodigo: string;
  operarioCuil: string;
  operarioNombre: string;
  horas: number;
  estado: 'pendiente' | 'aprobado' | 'desaprobado';
}
```

---

# Parte A — Backend

### Task B0: Rama

- [ ] En el repo Backend: `git checkout main; git pull; git checkout -b feature/control-general-looker`

### Task B1: Helper de parseo de ids + quincenas hacia atrás

**Files:**
- Modify: `src/common/quincena.ts`
- Create: `src/common/quincena.spec.ts` (si no existe; si existe, agregar casos)

**Interfaces:**
- Produces: `quincenasHaciaAtras(anio, mes, quincena, cantidad): { anio: number; mes: number; quincena: number }[]` (orden ascendente, la última es la pedida) y `parseIds(valor?: string): number[] | undefined` (`"1,2"` → `[1,2]`; `undefined`/`""`/solo comas → `undefined`; ignora tokens no numéricos).

- [ ] **Step 1: Test que falla** — en `src/common/quincena.spec.ts`:

```ts
import { quincenasHaciaAtras, parseIds } from './quincena';

describe('quincenasHaciaAtras', () => {
  it('devuelve la cantidad pedida terminando en la quincena dada, ascendente', () => {
    const qs = quincenasHaciaAtras(2026, 8, 1, 4);
    expect(qs).toEqual([
      { anio: 2026, mes: 6, quincena: 2 },
      { anio: 2026, mes: 7, quincena: 1 },
      { anio: 2026, mes: 7, quincena: 2 },
      { anio: 2026, mes: 8, quincena: 1 },
    ]);
  });
  it('cruza el año hacia atrás', () => {
    expect(quincenasHaciaAtras(2026, 1, 1, 2)).toEqual([
      { anio: 2025, mes: 12, quincena: 2 },
      { anio: 2026, mes: 1, quincena: 1 },
    ]);
  });
});

describe('parseIds', () => {
  it('parsea lista separada por comas', () => expect(parseIds('1,2,30')).toEqual([1, 2, 30]));
  it('undefined y vacío devuelven undefined', () => {
    expect(parseIds(undefined)).toBeUndefined();
    expect(parseIds('')).toBeUndefined();
    expect(parseIds(',,')).toBeUndefined();
  });
  it('ignora tokens no numéricos', () => expect(parseIds('1,x,2')).toEqual([1, 2]));
});
```

- [ ] **Step 2: Correr y ver FAIL** — `npx jest quincena.spec` → funciones no existen.
- [ ] **Step 3: Implementar** en `src/common/quincena.ts` (debajo de `quincenaAnterior`):

```ts
/** Las últimas `cantidad` quincenas terminando en la dada, en orden
 * cronológico ascendente — para el histórico del panel Control general. */
export function quincenasHaciaAtras(
  anio: number,
  mes: number,
  quincena: number,
  cantidad: number,
): { anio: number; mes: number; quincena: number }[] {
  const lista = [{ anio, mes, quincena }];
  while (lista.length < cantidad) {
    const prev = quincenaAnterior(lista[0].anio, lista[0].mes, lista[0].quincena);
    lista.unshift(prev);
  }
  return lista;
}

/** "1,2,30" → [1, 2, 30]. undefined/vacío/sin números → undefined (= sin filtro). */
export function parseIds(valor?: string): number[] | undefined {
  if (!valor) return undefined;
  const ids = valor
    .split(',')
    .map((t) => Number(t.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ids.length > 0 ? ids : undefined;
}
```

- [ ] **Step 4: Correr y ver PASS** — `npx jest quincena.spec`
- [ ] **Step 5: Commit** — `feat(control-general): helpers quincenasHaciaAtras y parseIds`

### Task B2: Endpoint `mis-contratos`

**Files:**
- Modify: `src/registros-horas/registros-horas.service.ts` (nuevo método al final), `src/registros-horas/registros-horas.controller.ts`
- Test: `src/registros-horas/registros-horas.service.spec.ts`

**Interfaces:**
- Produces: `GET /registros-horas/mis-contratos` (Roles: JefeContrato, Admin) → `{ id, codigo, nombre }[]` ordenado por `codigo`. JefeContrato: contratos donde es jefe (`jefes.some`); Admin: todos los activos.

- [ ] **Step 1: Test que falla** (patrón de mocks del spec existente — mirar cómo el spec actual construye el service con un objeto `prisma` falso y replicarlo):

```ts
describe('misContratos', () => {
  it('JefeContrato ve solo sus contratos; Admin todos los activos', async () => {
    prisma.contrato.findMany.mockResolvedValue([{ id: 1, codigo: 'K5', nombre: 'Gasnor K5' }]);
    const r = await service.misContratos({ cuil: '20-1-1', rol: 'JefeContrato' });
    expect(prisma.contrato.findMany).toHaveBeenCalledWith({
      where: { activo: true, jefes: { some: { usuarioCuil: '20-1-1' } } },
      select: { id: true, codigo: true, nombre: true },
      orderBy: { codigo: 'asc' },
    });
    expect(r).toEqual([{ id: 1, codigo: 'K5', nombre: 'Gasnor K5' }]);

    await service.misContratos({ cuil: '20-9-9', rol: 'Admin' });
    expect(prisma.contrato.findMany).toHaveBeenLastCalledWith({
      where: { activo: true },
      select: { id: true, codigo: true, nombre: true },
      orderBy: { codigo: 'asc' },
    });
  });
});
```

- [ ] **Step 2: FAIL** — `npx jest registros-horas.service.spec`
- [ ] **Step 3: Implementar** — service:

```ts
/** Contratos del jefe (o todos los activos para Admin) — opciones del filtro
 * por contrato del panel Control general. */
async misContratos(usuario: { cuil: string; rol: string }) {
  return this.prisma.contrato.findMany({
    where: {
      activo: true,
      ...(usuario.rol === 'Admin' ? {} : { jefes: { some: { usuarioCuil: usuario.cuil } } }),
    },
    select: { id: true, codigo: true, nombre: true },
    orderBy: { codigo: 'asc' },
  });
}
```

Controller (junto a `resumenOperarios`):

```ts
@Get('mis-contratos')
@Roles('JefeContrato', 'Admin')
misContratos(@Request() req) {
  return this.service.misContratos({ cuil: req.user.cuil, rol: req.user.rol });
}
```

- [ ] **Step 4: PASS** — `npx jest registros-horas.service.spec`
- [ ] **Step 5: Commit** — `feat(control-general): endpoint mis-contratos para el filtro por contrato`

### Task B3: Filtros contrato/provincia en `resumen-operarios`

**Files:**
- Modify: `src/registros-horas/registros-horas.service.ts:697-807` (`resumenOperarios`), `src/registros-horas/registros-horas.controller.ts:105-114`
- Test: `src/registros-horas/registros-horas.service.spec.ts`

**Interfaces:**
- Consumes: `parseIds` de `common/quincena.ts`.
- Produces: `resumenOperarios(usuario, anio, mes, quincena, filtros?: { contratoIds?: number[]; provinciaIds?: number[] })` — mismo shape de respuesta. Los filtros achican el scope del agregado principal Y de la quincena anterior (intersección con "mis contratos"); la **alerta cruzada NO se filtra** (sigue cruzando todos los contratos — esa es su razón de ser).

- [ ] **Step 1: Test que falla** — casos: (a) con `contratoIds: [2]` el `where` del agregado principal usa `contratoId: { in: [2] }` (intersección de mis contratos [1,2] con [2]); (b) con `provinciaIds: [3]` los `where` del agregado principal y de la quincena anterior incluyen `provinciaId: { in: [3] }` pero el query de alerta cruzada NO lo incluye; (c) `contratoIds` que no interseca con mis contratos → `[]` sin consultar registros.

```ts
describe('resumenOperarios con filtros', () => {
  it('interseca contratoIds con mis contratos y filtra provincia (pero no en la alerta cruzada)', async () => {
    prisma.contrato.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    prisma.registroHoras.findMany.mockResolvedValue([]);
    prisma.snuempleados.findMany.mockResolvedValue([]);
    await service.resumenOperarios({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1, {
      contratoIds: [2, 99],
      provinciaIds: [3],
    });
    const llamadas = prisma.registroHoras.findMany.mock.calls.map((c) => c[0].where);
    // agregado principal: contratos intersecados + provincia
    expect(llamadas[0]).toMatchObject({ contratoId: { in: [2] }, provinciaId: { in: [3] } });
    // alerta cruzada: sin filtro de provincia ni contrato
    expect(llamadas[1].provinciaId).toBeUndefined();
    expect(llamadas[1].contratoId).toBeUndefined();
    // quincena anterior: mismos filtros que el principal
    expect(llamadas[2]).toMatchObject({ contratoId: { in: [2] }, provinciaId: { in: [3] } });
  });

  it('sin intersección de contratos devuelve [] sin tocar registros', async () => {
    prisma.contrato.findMany.mockResolvedValue([{ id: 1 }]);
    const r = await service.resumenOperarios({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1, {
      contratoIds: [99],
    });
    expect(r).toEqual([]);
    expect(prisma.registroHoras.findMany).not.toHaveBeenCalled();
  });
});
```

(Nota: si en el spec existente el orden de las llamadas a `findMany` difiere — p. ej. usa `mockResolvedValueOnce` encadenados — adaptar los índices a ese patrón, sin cambiar las aserciones de fondo.)

- [ ] **Step 2: FAIL**
- [ ] **Step 3: Implementar** — en `resumenOperarios`, firma nueva `filtros: { contratoIds?: number[]; provinciaIds?: number[] } = {}`. Después de armar `misContratoIds`:

```ts
const contratoIdsEfectivos = filtros.contratoIds
  ? misContratoIds.filter((id) => filtros.contratoIds!.includes(id))
  : misContratoIds;
if (contratoIdsEfectivos.length === 0) return [];
const filtroProvincia = filtros.provinciaIds ? { provinciaId: { in: filtros.provinciaIds } } : {};
```

Reemplazar `contratoId: { in: misContratoIds }` por `contratoId: { in: contratoIdsEfectivos }, ...filtroProvincia` en el agregado principal (línea ~716) y en el de la quincena anterior (línea ~777). El query de `filasQuincenaCompleta` (alerta cruzada, línea ~750) queda EXACTAMENTE como está. Controller: agregar `@Query('contratoIds') contratoIds?: string` y `@Query('provinciaIds') provinciaIds?: string`, pasar `{ contratoIds: parseIds(contratoIds), provinciaIds: parseIds(provinciaIds) }`.

- [ ] **Step 4: PASS** (correr el spec completo del archivo: los tests viejos de `resumenOperarios` deben seguir verdes — la firma nueva tiene default `{}`).
- [ ] **Step 5: Commit** — `feat(control-general): filtros por contrato y provincia en resumen-operarios`

### Task B4: Endpoint `historico-quincenas`

**Files:**
- Modify: `src/registros-horas/registros-horas.service.ts`, `src/registros-horas/registros-horas.controller.ts`
- Test: `src/registros-horas/registros-horas.service.spec.ts`

**Interfaces:**
- Consumes: `rangoQuincena`, `quincenasHaciaAtras` (Task B1), scope de contratos igual a B3.
- Produces: `historicoQuincenas(usuario, anio, mes, quincena, filtros?)` → `PuntoHistorico[]` (24 puntos, ascendente, `horas` redondeadas a 2 decimales; quincenas sin registros = 0).

- [ ] **Step 1: Test que falla:**

```ts
describe('historicoQuincenas', () => {
  it('agrupa por quincena calendario, excluye desaprobado en el where y rellena con 0', async () => {
    prisma.contrato.findMany.mockResolvedValue([{ id: 1 }]);
    prisma.registroHoras.findMany.mockResolvedValue([
      { fecha: new Date(2026, 7, 3), horas: 8 },   // 1ra ago
      { fecha: new Date(2026, 7, 3), horas: 2.5 }, // 1ra ago
      { fecha: new Date(2026, 6, 20), horas: 4 },  // 2da jul
    ]);
    const r = await service.historicoQuincenas({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1);
    expect(r).toHaveLength(24);
    expect(r[23]).toEqual({ anio: 2026, mes: 8, quincena: 1, horas: 10.5 });
    expect(r[22]).toEqual({ anio: 2026, mes: 7, quincena: 2, horas: 4 });
    expect(r[21]).toEqual({ anio: 2026, mes: 7, quincena: 1, horas: 0 });
    const where = prisma.registroHoras.findMany.mock.calls[0][0].where;
    expect(where.estado).toEqual({ not: 'desaprobado' });
  });
});
```

- [ ] **Step 2: FAIL**
- [ ] **Step 3: Implementar:**

```ts
/** Histórico de horas (pendientes + aprobadas) por quincena calendario, 24
 * quincenas (12 meses) terminando en la seleccionada — la vista "Horas Por
 * Quincena" del viejo tablero Looker, scopeada a mis contratos. */
async historicoQuincenas(
  usuario: { cuil: string; rol: string },
  anio: number,
  mes: number,
  quincena: number,
  filtros: { contratoIds?: number[]; provinciaIds?: number[] } = {},
) {
  const contratos = await this.prisma.contrato.findMany({
    where:
      usuario.rol === 'Admin' ? {} : { jefes: { some: { usuarioCuil: usuario.cuil } } },
    select: { id: true },
  });
  const misContratoIds = contratos.map((c) => c.id);
  const contratoIdsEfectivos = filtros.contratoIds
    ? misContratoIds.filter((id) => filtros.contratoIds!.includes(id))
    : misContratoIds;
  const quincenas = quincenasHaciaAtras(anio, mes, quincena, 24);
  if (contratoIdsEfectivos.length === 0)
    return quincenas.map((q) => ({ ...q, horas: 0 }));

  const { desde } = rangoQuincena(quincenas[0].anio, quincenas[0].mes, quincenas[0].quincena);
  const { hasta } = rangoQuincena(anio, mes, quincena);
  const filas = await this.prisma.registroHoras.findMany({
    where: {
      contratoId: { in: contratoIdsEfectivos },
      ...(filtros.provinciaIds ? { provinciaId: { in: filtros.provinciaIds } } : {}),
      fecha: { gte: desde, lte: hasta },
      estado: { not: 'desaprobado' },
    },
    select: { fecha: true, horas: true },
  });

  const acum = new Map<string, number>();
  for (const f of filas) {
    const q = f.fecha.getDate() <= 15 ? 1 : 2;
    const k = `${f.fecha.getFullYear()}-${f.fecha.getMonth() + 1}-${q}`;
    acum.set(k, (acum.get(k) ?? 0) + Number(f.horas));
  }
  return quincenas.map((q) => ({
    ...q,
    horas: Math.round((acum.get(`${q.anio}-${q.mes}-${q.quincena}`) ?? 0) * 100) / 100,
  }));
}
```

Controller:

```ts
@Get('historico-quincenas')
@Roles('JefeContrato', 'Admin')
historicoQuincenas(
  @Query('anio', ParseIntPipe) anio: number,
  @Query('mes', ParseIntPipe) mes: number,
  @Query('quincena', ParseIntPipe) quincena: number,
  @Query('contratoIds') contratoIds: string | undefined,
  @Query('provinciaIds') provinciaIds: string | undefined,
  @Request() req,
) {
  return this.service.historicoQuincenas(
    { cuil: req.user.cuil, rol: req.user.rol },
    anio, mes, quincena,
    { contratoIds: parseIds(contratoIds), provinciaIds: parseIds(provinciaIds) },
  );
}
```

- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** — `feat(control-general): endpoint historico-quincenas (12 meses, réplica Looker)`

### Task B5: Endpoint `detalle-diario`

**Files:**
- Modify: `src/registros-horas/registros-horas.service.ts`, `src/registros-horas/registros-horas.controller.ts`
- Test: `src/registros-horas/registros-horas.service.spec.ts`

**Interfaces:**
- Produces: `detalleDiario(usuario, anio, mes, quincena, filtros?)` → `FilaDetalleDiario[]` (ver contrato de datos). Nombre del operario vía relación `operario.apellido_nombre`; orden `fecha desc` en el query y desempate por nombre en memoria.

- [ ] **Step 1: Test que falla:**

```ts
describe('detalleDiario', () => {
  it('devuelve filas planas con contrato y nombre, orden fecha desc + nombre', async () => {
    prisma.contrato.findMany.mockResolvedValue([{ id: 1 }]);
    prisma.registroHoras.findMany.mockResolvedValue([
      {
        id: 10, fecha: new Date(2026, 7, 3), contratoId: 1, operarioCuil: '20-2-2',
        horas: 8, estado: 'pendiente',
        contrato: { codigo: 'K5' }, operario: { apellido_nombre: 'Zeta Juan' },
      },
      {
        id: 11, fecha: new Date(2026, 7, 3), contratoId: 1, operarioCuil: '20-3-3',
        horas: 4, estado: 'aprobado',
        contrato: { codigo: 'K5' }, operario: { apellido_nombre: 'Alfa Pedro' },
      },
    ]);
    const r = await service.detalleDiario({ cuil: '20-1-1', rol: 'JefeContrato' }, 2026, 8, 1);
    expect(r[0]).toEqual({
      id: 11, fecha: '2026-08-03', contratoId: 1, contratoCodigo: 'K5',
      operarioCuil: '20-3-3', operarioNombre: 'Alfa Pedro', horas: 4, estado: 'aprobado',
    });
    expect(r[1].operarioNombre).toBe('Zeta Juan');
  });
});
```

- [ ] **Step 2: FAIL**
- [ ] **Step 3: Implementar** (misma resolución de `contratoIdsEfectivos`/`filtroProvincia` que en B4; con scope vacío devolver `[]`):

```ts
/** Detalle plano de la quincena (la tabla "Detalle Diario" del Looker):
 * una fila por registro, con contrato y nombre resueltos. */
async detalleDiario(
  usuario: { cuil: string; rol: string },
  anio: number,
  mes: number,
  quincena: number,
  filtros: { contratoIds?: number[]; provinciaIds?: number[] } = {},
) {
  const contratos = await this.prisma.contrato.findMany({
    where:
      usuario.rol === 'Admin' ? {} : { jefes: { some: { usuarioCuil: usuario.cuil } } },
    select: { id: true },
  });
  const misContratoIds = contratos.map((c) => c.id);
  const contratoIdsEfectivos = filtros.contratoIds
    ? misContratoIds.filter((id) => filtros.contratoIds!.includes(id))
    : misContratoIds;
  if (contratoIdsEfectivos.length === 0) return [];

  const { desde, hasta } = rangoQuincena(anio, mes, quincena);
  const filas = await this.prisma.registroHoras.findMany({
    where: {
      contratoId: { in: contratoIdsEfectivos },
      ...(filtros.provinciaIds ? { provinciaId: { in: filtros.provinciaIds } } : {}),
      fecha: { gte: desde, lte: hasta },
    },
    select: {
      id: true, fecha: true, contratoId: true, operarioCuil: true, horas: true, estado: true,
      contrato: { select: { codigo: true } },
      operario: { select: { apellido_nombre: true } },
    },
    orderBy: { fecha: 'desc' },
  });
  return filas
    .map((f) => ({
      id: f.id,
      fecha: f.fecha.toISOString().slice(0, 10),
      contratoId: f.contratoId,
      contratoCodigo: f.contrato.codigo,
      operarioCuil: f.operarioCuil,
      operarioNombre: f.operario.apellido_nombre,
      horas: Number(f.horas),
      estado: f.estado,
    }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.operarioNombre.localeCompare(b.operarioNombre));
}
```

Nota sobre `fecha`: `rangoQuincena` construye `Date` locales — si el spec existente serializa fechas de otra forma (mirar cómo `sinCarga` arma `ultimaCarga`, línea ~847: usa `toISOString().slice(0, 10)`), seguir ese mismo patrón, y si el test da corrido por timezone ajustar la construcción del mock (`new Date(Date.UTC(...))`) como haga el spec existente.

Controller: mismo shape que `historico-quincenas` pero ruta `'detalle-diario'` y llamando `this.service.detalleDiario(...)`.

- [ ] **Step 4: PASS** — y correr todo: `npx jest registros-horas`
- [ ] **Step 5: Build** — `npx nest build` limpio.
- [ ] **Step 6: Commit** — `feat(control-general): endpoint detalle-diario de la quincena`

---

# Parte B — Frontend

### Task F0: Rama

- [ ] En el repo Frontend: `git checkout main; git pull; git checkout -b feature/control-general-looker`

### Task F1: API layer — tipos y hooks nuevos

**Files:**
- Modify: `src/lib/api/panel-general.ts`
- Test: `src/lib/api/panel-general.test.ts` (crear; si el repo no testea hooks de api así, verificar solo con tsc)

**Interfaces:**
- Consumes: contrato de datos del plan (Parte A).
- Produces: `interface FiltrosPanel { contratoIds?: number[]; provinciaIds?: number[] }`, `interface MisContrato`, `interface PuntoHistorico`, `interface FilaDetalleDiario` (idénticos al contrato de datos); hooks `useMisContratos()`, `useHistoricoQuincenas(quincena, filtros)`, `useDetalleDiario(quincena, filtros)`, y `useResumenOperarios(quincena, filtros)` (parámetro nuevo opcional). Helper interno `paramsFiltros(filtros)` → `{ contratoIds: '1,2', provinciaIds: '3' }` solo con las claves presentes y no vacías.

- [ ] **Step 1: Implementar** (patrón existente del archivo — `useQuery` + `api.get`, queryKey incluye quincena y filtros):

```ts
export interface FiltrosPanel { contratoIds?: number[]; provinciaIds?: number[] }
export interface MisContrato { id: number; codigo: string; nombre: string }
export interface PuntoHistorico { anio: number; mes: number; quincena: 1 | 2; horas: number }
export interface FilaDetalleDiario {
  id: number; fecha: string; contratoId: number; contratoCodigo: string;
  operarioCuil: string; operarioNombre: string; horas: number;
  estado: 'pendiente' | 'aprobado' | 'desaprobado';
}

function paramsFiltros(f: FiltrosPanel = {}) {
  return {
    ...(f.contratoIds?.length ? { contratoIds: f.contratoIds.join(',') } : {}),
    ...(f.provinciaIds?.length ? { provinciaIds: f.provinciaIds.join(',') } : {}),
  };
}

export function useMisContratos() {
  return useQuery({
    queryKey: ['mis-contratos'],
    queryFn: async () => (await api.get<MisContrato[]>('/registros-horas/mis-contratos')).data,
  });
}

export function useHistoricoQuincenas(quincena: Quincena, filtros: FiltrosPanel = {}) {
  return useQuery({
    queryKey: ['historico-quincenas', quincena, filtros],
    queryFn: async () =>
      (
        await api.get<PuntoHistorico[]>('/registros-horas/historico-quincenas', {
          params: { anio: quincena.anio, mes: quincena.mes, quincena: quincena.parte, ...paramsFiltros(filtros) },
        })
      ).data,
  });
}

export function useDetalleDiario(quincena: Quincena, filtros: FiltrosPanel = {}) {
  return useQuery({
    queryKey: ['detalle-diario', quincena, filtros],
    queryFn: async () =>
      (
        await api.get<FilaDetalleDiario[]>('/registros-horas/detalle-diario', {
          params: { anio: quincena.anio, mes: quincena.mes, quincena: quincena.parte, ...paramsFiltros(filtros) },
        })
      ).data,
  });
}
```

Y en `useResumenOperarios`, agregar segundo parámetro `filtros: FiltrosPanel = {}`, sumarlo al `queryKey` y `...paramsFiltros(filtros)` a los params. `useSinCarga` queda igual (decisión: sin carga no se filtra por contrato/provincia — es compartido).

- [ ] **Step 2: Verificar** — `npx tsc --noEmit`
- [ ] **Step 3: Commit** — `feat(control-general): hooks de api para histórico, detalle diario y mis contratos`

### Task F2: Token de color + componentes de gráfico

**Files:**
- Modify: `src/app/globals.css` (tokens chart)
- Create: `src/features/control-general/horas-por-quincena-chart.tsx`
- Create: `src/features/control-general/ranking-operarios.tsx`
- Test: `src/features/control-general/charts.test.tsx`

**Interfaces:**
- Consumes: `PuntoHistorico` y `ResumenOperario` de `@/lib/api/panel-general`.
- Produces: `<HorasPorQuincenaChart datos={PuntoHistorico[]} />` y `<RankingOperarios resumen={ResumenOperario[]} />` (el ranking calcula top 10 por `totalHoras` internamente y linkea cada nombre a `/aprobaciones?operarioCuil=...`).

- [ ] **Step 1: Tokens** — en `globals.css`, junto a los tokens de marca:

```css
  /* Series de gráficos (panel Control general) — validados con el validador
     de dataviz sobre superficie blanca; chart-1 es brand-deep. */
  --color-chart-1: #a97a16;
  --color-chart-2: #3b6fc4;
```

- [ ] **Step 2: Test que falla** — `charts.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { HorasPorQuincenaChart } from './horas-por-quincena-chart';
import { RankingOperarios } from './ranking-operarios';
import type { PuntoHistorico, ResumenOperario } from '@/lib/api/panel-general';

const punto = (mes: number, quincena: 1 | 2, horas: number): PuntoHistorico => ({
  anio: 2026, mes, quincena, horas,
});

const operario = (cuil: string, nombre: string, totalHoras: number): ResumenOperario => ({
  cuil, apellido_nombre: nombre, totalHoras, pendiente: 0, aprobado: 0, desaprobado: 0,
  horasAprobadas: 0, superaHorasExtra: false, tieneAlertaCruzada: false,
  horasAprobadasAnterior: 0, deltaHorasAprobadas: 0,
});

describe('HorasPorQuincenaChart', () => {
  it('dibuja una barra por quincena con tooltip nativo y leyenda', () => {
    render(<HorasPorQuincenaChart datos={[punto(7, 1, 100), punto(7, 2, 50)]} />);
    expect(screen.getByText('1ra quincena')).toBeInTheDocument();
    expect(screen.getByText('2da quincena')).toBeInTheDocument();
    expect(screen.getByTitle('1ra quincena jul 2026: 100 hs')).toBeInTheDocument();
    expect(screen.getByTitle('2da quincena jul 2026: 50 hs')).toBeInTheDocument();
  });
  it('sin datos muestra vacío accesible', () => {
    render(<HorasPorQuincenaChart datos={[]} />);
    expect(screen.getByText('Sin horas en el período.')).toBeInTheDocument();
  });
});

describe('RankingOperarios', () => {
  it('ordena por total y corta en 10, con link a aprobaciones', () => {
    const muchos = Array.from({ length: 12 }, (_, i) => operario(`20-${i}-1`, `Operario ${i}`, i));
    render(<RankingOperarios resumen={muchos} />);
    const filas = screen.getAllByRole('link');
    expect(filas).toHaveLength(10);
    expect(filas[0]).toHaveTextContent('Operario 11');
    expect(filas[0]).toHaveAttribute('href', '/aprobaciones?operarioCuil=20-11-1');
  });
});
```

- [ ] **Step 3: FAIL** — `npx vitest run src/features/control-general/charts.test.tsx`
- [ ] **Step 4: Implementar `horas-por-quincena-chart.tsx`** — barras agrupadas por mes, hechas con flex; alto fijo 180px; etiqueta de mes cada grupo (abreviatura es-AR); leyenda arriba a la derecha; grilla horizontal sutil; tooltip nativo por barra; gap de 2px entre barras del grupo:

```tsx
import type { PuntoHistorico } from '@/lib/api/panel-general';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Réplica del gráfico "Horas Por Quincena" del viejo tablero Looker:
 * barras agrupadas por mes (1ra vs 2da quincena), últimos 12 meses.
 * Sin librería de charts: flexbox + tokens de la app. */
export function HorasPorQuincenaChart({ datos }: { datos: PuntoHistorico[] }) {
  const max = Math.max(...datos.map((d) => d.horas), 0);
  if (datos.length === 0 || max === 0)
    return <p className="text-sm text-slate">Sin horas en el período.</p>;

  // agrupar por mes preservando el orden cronológico que ya trae el back
  const meses: { anio: number; mes: number; q1?: PuntoHistorico; q2?: PuntoHistorico }[] = [];
  for (const d of datos) {
    let g = meses.find((m) => m.anio === d.anio && m.mes === d.mes);
    if (!g) {
      g = { anio: d.anio, mes: d.mes };
      meses.push(g);
    }
    if (d.quincena === 1) g.q1 = d;
    else g.q2 = d;
  }

  const etiqueta = (d: PuntoHistorico) =>
    `${d.quincena === 1 ? '1ra' : '2da'} quincena ${MESES[d.mes - 1]} ${d.anio}: ${d.horas} hs`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-4 text-xs text-slate">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--color-chart-1)' }} />
          1ra quincena
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--color-chart-2)' }} />
          2da quincena
        </span>
      </div>
      <div className="relative h-44">
        {/* grilla: 0%, 50%, 100% del máximo */}
        {[0, 0.5, 1].map((f) => (
          <div
            key={f}
            className="absolute inset-x-0 border-t border-line/70"
            style={{ bottom: `${f * 100}%` }}
          >
            <span className="absolute -top-2 right-0 bg-surface pl-1 text-[10px] tabular-nums text-slate">
              {Math.round(max * f)}
            </span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-2 pr-8">
          {meses.map((m) => (
            <div key={`${m.anio}-${m.mes}`} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex h-40 w-full items-end justify-center gap-0.5">
                {[m.q1, m.q2].map(
                  (d, i) =>
                    d && (
                      <div
                        key={i}
                        role="img"
                        aria-label={etiqueta(d)}
                        title={etiqueta(d)}
                        className="w-full max-w-4 rounded-t"
                        style={{
                          height: `${(d.horas / max) * 100}%`,
                          background: `var(--color-chart-${i + 1})`,
                          minHeight: d.horas > 0 ? 2 : 0,
                        }}
                      />
                    ),
                )}
              </div>
              <span className="truncate text-[10px] text-slate">
                {MESES[m.mes - 1]}
                {m.mes === 1 ? ` ${String(m.anio).slice(2)}` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implementar `ranking-operarios.tsx`** — barras horizontales, una serie, valor al final de cada barra en texto (`text-ink`), nombre linkeado:

```tsx
import Link from 'next/link';
import type { ResumenOperario } from '@/lib/api/panel-general';

/** Réplica del "Ranking | Operarios con mayor cantidad de horas" del Looker:
 * top 10 por total de horas de la quincena (pendientes + aprobadas), barras
 * horizontales para que los nombres largos se lean completos. */
export function RankingOperarios({ resumen }: { resumen: ResumenOperario[] }) {
  const top = [...resumen].sort((a, b) => b.totalHoras - a.totalHoras).slice(0, 10);
  const max = Math.max(...top.map((r) => r.totalHoras), 0);
  if (top.length === 0 || max === 0)
    return <p className="text-sm text-slate">Sin horas en esta quincena.</p>;

  return (
    <ol className="space-y-1.5">
      {top.map((r) => (
        <li key={r.cuil} className="grid grid-cols-[minmax(0,11rem)_1fr] items-center gap-2 text-sm">
          <Link
            href={`/aprobaciones?operarioCuil=${r.cuil}`}
            className="truncate text-ink underline decoration-line hover:text-brand-deep hover:decoration-brand-deep"
            title={r.apellido_nombre}
          >
            {r.apellido_nombre}
          </Link>
          <div className="flex items-center gap-2">
            <div
              className="h-4 rounded-r"
              role="img"
              aria-label={`${r.apellido_nombre}: ${r.totalHoras} hs`}
              title={`${r.apellido_nombre}: ${r.totalHoras} hs`}
              style={{ width: `${(r.totalHoras / max) * 100}%`, background: 'var(--color-chart-1)', minWidth: 2 }}
            />
            <span className="tabular-nums text-xs text-ink">{r.totalHoras}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 6: PASS** — `npx vitest run src/features/control-general/charts.test.tsx`
- [ ] **Step 7: Commit** — `feat(control-general): gráficos de histórico por quincena y ranking top 10`

### Task F3: Página reorganizada

**Files:**
- Modify: `src/app/(protected)/control-general/page.tsx`
- Test: `src/app/(protected)/control-general/control-general-page.test.tsx` (extender los existentes)

**Interfaces:**
- Consumes: todo lo de F1 y F2, `MultiFiltro` de `@/components/ui/barra-filtros`, `useProvincias` de `@/lib/api/catalogos`.

Orden confirmado de secciones (decisión 2026-08-10):
1. `PageHeader` + `QuincenaSelect` + fila de filtros: MultiFiltro "Contrato" (opciones de `useMisContratos`, label `codigo — nombre`, value `String(id)`) y MultiFiltro "Provincia" (opciones de `useProvincias`, label `nombre`, value `String(id)`).
2. Stat tiles: **"Horas de la quincena"** (nuevo, primero: `resumen.reduce((s, r) => s + r.totalHoras, 0)`, redondeado a 1 decimal, sin `onClick`, tono neutro) + los 4 tiles existentes sin cambios de comportamiento.
3. Sección nueva "Horas por quincena (últimos 12 meses)" → `<HorasPorQuincenaChart datos={historico ?? []} />` (con "Cargando…" igual que las otras secciones).
4. "Resumen por operario" (tabla existente, sin cambios).
5. Sección nueva "Ranking — mayor cantidad de horas" → `<RankingOperarios resumen={resumen ?? []} />`. En desktop, 4 y 5 conviven en una grilla `lg:grid-cols-[2fr_1fr]` (resumen izquierda, ranking derecha); en mobile apilados.
6. Sección nueva "Detalle diario" → tabla plana Fecha / Contrato / Operario / Horas / Estado con paginación client-side de 50 filas ("Ver más" que suma 50; contador "mostrando X de Y"). Estado como badge de texto con los estilos ya usados en la app (pendiente `text-warn`, aprobado `text-approved`, desaprobado `text-danger`). El nombre del operario linkea a `/aprobaciones?operarioCuil=...`.
7. "Sin carga en esta quincena" (existente, sin cambios).

Los filtros de contrato/provincia son estado local (`useState<string[]>`), se convierten a `number[]` y se pasan a `useResumenOperarios`, `useHistoricoQuincenas` y `useDetalleDiario` como `FiltrosPanel`. `useSinCarga` NO los recibe. El MultiFiltro de operario del resumen y el buscador de sin-carga quedan como están.

- [ ] **Step 1: Tests que fallan** — extender el test de página existente (respetar sus mocks/patrón actual; mockear también los hooks nuevos) con: (a) "muestra el tile Horas de la quincena con la suma de totalHoras", (b) "renderiza las secciones nuevas Horas por quincena, Ranking y Detalle diario en orden", (c) "el filtro por contrato pasa contratoIds a los hooks" (asertar que `useResumenOperarios` fue llamado con `{ contratoIds: [2] }` tras seleccionar la opción — según el patrón de interacción con MultiFiltro que ya usen los tests de Aprobaciones; si no hay precedente, asertar al menos que las opciones del MultiFiltro de contrato salen de `useMisContratos`).
- [ ] **Step 2: FAIL** — `npx vitest run "src/app/(protected)/control-general/control-general-page.test.tsx"`
- [ ] **Step 3: Implementar** la página según el layout de arriba.
- [ ] **Step 4: PASS** el test de página + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(control-general): layout réplica del tablero Looker (filtros, tile de horas, detalle diario)`

### Task F4: Verificación visual final

- [ ] Levantar back (`npm run start:dev`) y front (`npm run dev`) contra la BD `testing`, loguearse como Admin, abrir `/control-general` y chequear: barras sin colisiones de etiquetas, meses legibles, ranking con nombres completos, filtros que refrescan las 4 secciones filtrables, "Sin carga" intacta. (Paso manual: si no se puede en esta sesión, dejarlo anotado como pendiente para el usuario.)

---

## Self-review (hecho al escribir)

- Cobertura: filtros ✔ (B2/B3 + F3), tile horas ✔ (F3), histórico ✔ (B4 + F2), detalle ✔ (B5 + F3), ranking ✔ (F2, client-side sobre resumen), sin-carga sin cambios ✔, umbral ≥16 sin cambios ✔.
- Tipos: `FiltrosPanel`/`PuntoHistorico`/`FilaDetalleDiario`/`MisContrato` idénticos en contrato de datos, Parte A y F1 ✔. `quincena.parte` es el nombre del campo en el tipo `Quincena` del front (verificado en `panel-general.ts` actual) ✔.
- El ranking y el tile usan `totalHoras` del resumen, que ya excluye desaprobado (línea 734 del service) — consistente con la decisión "pendientes + aprobadas" ✔.
