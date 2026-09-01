# ERP Etapa 2 — Lectura servida por NestJS (muere `apiCert`) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los datos de certificaciones (resumen, analytics, estado de cargas, presupuesto) pasan a servirse desde el backend NestJS de Horas; el frontend de Horas deja de llamar al FastAPI del portal (`apiCert` desaparece).

**Architecture:** Mudanza única de las tablas del portal de la base `testing` a `Horas_Sertec` con renombre `sth_cert_*` + vistas de compatibilidad con los nombres viejos (el portal no cambia código, solo repunta `DB_NAME`). En NestJS los 10 endpoints de lectura se implementan con `prisma.$queryRaw` (mismo estilo SQL que el portal) en servicios nuevos del módulo `certificaciones`, con la visibilidad resuelta por el claim `cert` del JWT. El frontend solo cambia la capa cliente (`src/lib/api/certificaciones.ts`): mismas interfaces, mismos hooks, URLs nuevas bajo `/certificaciones/*` del `api` de Horas.

**Tech Stack:** NestJS + Prisma (`$queryRaw` con `Prisma.sql`), MySQL compartido, Next.js + react-query + axios, Jest (backend), Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-09-01-unificacion-erp-certificaciones-design.md`

## Global Constraints

- Respuestas del backend con los MISMOS shapes (snake_case) que el FastAPI: las interfaces TS existentes (`EvolucionMensualPunto`, etc.) no cambian.
- Cruce Horas↔portal SIEMPRE por código K, nunca por id.
- NUNCA `prisma migrate dev` / `db push` contra la BD compartida (sin baseline): DDL por script one-off (`prisma db execute`), ver `prisma/migrations/README.md`.
- Todo DDL va a las dos bases (`Horas_Sertec` y `testing`); en `testing` NO se crean las vistas (ahí siguen las tablas viejas reales, que son la producción del portal hasta el repunte).
- SQL siempre con bind params (`Prisma.sql`), nunca interpolación de strings (el original tenía inyección en `contratos`/`provincias`: NO replicarla).
- Desvíos de comportamiento conscientes respecto del portal (fail-closed): (1) nivel `carga` cuyos filtros no intersecan sus Ks → resultado vacío, no "todo"; (2) `resumen` con `ks` vacío → `[]`, no error SQL; (3) `estado-cargas.cargado_en` → `YYYY-MM-DD` real (el `split("T")` del portal no cortaba nada).
- Deploy solo con pedido explícito del usuario; aviso antes de `pm2 restart`.
- TDD estricto: test primero, verlo fallar, implementar, verlo pasar, commit.
- Los montos de `$queryRaw` sobre columnas DECIMAL/SUM llegan como `Prisma.Decimal`: SIEMPRE pasarlos por `Number(...)` antes de responder.

---

### Task 1: Script SQL de mudanza + snapshot en `testing`

**Files:**
- Create: `docs/sql/2026-09-01-mudanza-certificaciones.sql`
- Create: `docs/sql/2026-09-01-mudanza-verificacion.sql`

**Interfaces:**
- Consumes: tablas viejas de la base `testing` (`fact_certificaciones`, `dim_item`, `dim_contrato`, `ma_provincias`, `carga_log`, `dim_presupuesto_contrato`, `usuarios`).
- Produces: tablas `sth_cert_certificaciones`, `sth_cert_items`, `sth_cert_contratos`, `sth_cert_provincias`, `sth_cert_cargas_log`, `sth_cert_presupuestos` (+ `usuarios` sin renombrar, solo en Horas_Sertec) — las usan las Tasks 2-6. En Horas_Sertec además vistas con los nombres viejos para el portal.

- [ ] **Step 1: Escribir el script de mudanza**

Contenido de `docs/sql/2026-09-01-mudanza-certificaciones.sql`:

```sql
-- Mudanza de las tablas del portal de certificaciones (spec 2026-09-01, §3).
-- SECCIÓN A: correr en `testing` DURANTE EL DESARROLLO (snapshot para dev).
--            Es aditiva: no toca las tablas viejas (producción del portal).
-- SECCIÓN B: correr en `Horas_Sertec` EN EL DEPLOY (copia cross-schema fresca
--            + vistas de compatibilidad). Requiere un usuario MySQL con
--            grants de lectura sobre `testing` y DDL sobre `Horas_Sertec`.
-- NUNCA correr con prisma migrate (sin baseline, ver prisma/migrations/README.md).

-- ============ SECCIÓN A (base: testing) ============
CREATE TABLE sth_cert_certificaciones LIKE fact_certificaciones;
INSERT INTO sth_cert_certificaciones SELECT * FROM fact_certificaciones;

CREATE TABLE sth_cert_items LIKE dim_item;
INSERT INTO sth_cert_items SELECT * FROM dim_item;

CREATE TABLE sth_cert_contratos LIKE dim_contrato;
INSERT INTO sth_cert_contratos SELECT * FROM dim_contrato;

CREATE TABLE sth_cert_provincias LIKE ma_provincias;
INSERT INTO sth_cert_provincias SELECT * FROM ma_provincias;

CREATE TABLE sth_cert_cargas_log LIKE carga_log;
INSERT INTO sth_cert_cargas_log SELECT * FROM carga_log;

CREATE TABLE sth_cert_presupuestos LIKE dim_presupuesto_contrato;
INSERT INTO sth_cert_presupuestos SELECT * FROM dim_presupuesto_contrato;

-- ============ SECCIÓN B (base: Horas_Sertec, en el deploy) ============
-- B.1 Copias frescas desde testing (el portal siguió escribiendo ahí):
-- CREATE TABLE sth_cert_certificaciones LIKE testing.fact_certificaciones;
-- INSERT INTO sth_cert_certificaciones SELECT * FROM testing.fact_certificaciones;
--   ... (idéntico para las otras 5 tablas renombradas)
-- CREATE TABLE usuarios LIKE testing.usuarios;
-- INSERT INTO usuarios SELECT * FROM testing.usuarios;
--
-- B.2 Vistas de compatibilidad (SOLO Horas_Sertec — el portal las consume
--     con sus nombres viejos; son de tabla única => actualizables, los
--     INSERT de la carga del portal siguen funcionando):
-- CREATE VIEW fact_certificaciones      AS SELECT * FROM sth_cert_certificaciones;
-- CREATE VIEW dim_item                  AS SELECT * FROM sth_cert_items;
-- CREATE VIEW dim_contrato              AS SELECT * FROM sth_cert_contratos;
-- CREATE VIEW ma_provincias             AS SELECT * FROM sth_cert_provincias;
-- CREATE VIEW carga_log                 AS SELECT * FROM sth_cert_cargas_log;
-- CREATE VIEW dim_presupuesto_contrato  AS SELECT * FROM sth_cert_presupuestos;
```

(La Sección B va comentada a propósito: se ejecuta a mano en el deploy — Task 8 — adaptando el prefijo de schema; dejarla comentada evita que un `db execute` distraído la corra contra la base equivocada.)

- [ ] **Step 2: Escribir el script de verificación**

Contenido de `docs/sql/2026-09-01-mudanza-verificacion.sql`:

```sql
-- Verificación post-mudanza: los pares viejo/nuevo deben dar conteos iguales
-- (y suma de montos igual en la fact). Correr en la base recién mudada.
SELECT 'fact' t, (SELECT COUNT(*) FROM fact_certificaciones) viejo,
       (SELECT COUNT(*) FROM sth_cert_certificaciones) nuevo
UNION ALL SELECT 'item', (SELECT COUNT(*) FROM dim_item), (SELECT COUNT(*) FROM sth_cert_items)
UNION ALL SELECT 'contrato', (SELECT COUNT(*) FROM dim_contrato), (SELECT COUNT(*) FROM sth_cert_contratos)
UNION ALL SELECT 'provincia', (SELECT COUNT(*) FROM ma_provincias), (SELECT COUNT(*) FROM sth_cert_provincias)
UNION ALL SELECT 'carga_log', (SELECT COUNT(*) FROM carga_log), (SELECT COUNT(*) FROM sth_cert_cargas_log)
UNION ALL SELECT 'presupuesto', (SELECT COUNT(*) FROM dim_presupuesto_contrato), (SELECT COUNT(*) FROM sth_cert_presupuestos);

SELECT 'fact suma total_mes' t, (SELECT SUM(total_mes) FROM fact_certificaciones) viejo,
       (SELECT SUM(total_mes) FROM sth_cert_certificaciones) nuevo;
```

- [ ] **Step 3: Aplicar la Sección A en `testing`** (el `.env` local ya apunta ahí)

Run: extraer la Sección A a un archivo temporal del scratchpad y `npx prisma db execute --file <ese archivo>`
Expected: "Script executed successfully."

- [ ] **Step 4: Verificar conteos**

Run: script node one-off en el scratchpad que ejecute las queries de verificación vía `PrismaClient().$queryRawUnsafe` e imprima las filas.
Expected: columna `viejo` == columna `nuevo` en las 6 tablas y en la suma.

- [ ] **Step 5: Commit**

```bash
git add docs/sql/2026-09-01-mudanza-certificaciones.sql docs/sql/2026-09-01-mudanza-verificacion.sql
git commit -m "feat(certificaciones): script de mudanza sth_cert_* + snapshot aplicado en testing"
```

---

### Task 2: Constructor de filtros de analítica (visibilidad por claim)

**Files:**
- Create: `src/certificaciones/filtros-analitica.ts`
- Test: `src/certificaciones/filtros-analitica.spec.ts`

**Interfaces:**
- Consumes: `CertClaim` de `./accesos.service` (`{ nivel: string; ks: string[]; inc: boolean }`).
- Produces: `interface FiltrosAnalitica { desde?: string; hasta?: string; contratos?: string[]; provincias?: string[]; tipo?: string }` y `function condicionesFiltros(f: FiltrosAnalitica, cert: CertClaim): Prisma.Sql | null` — `null` significa "resultado vacío garantizado" (fail-closed); si no, un fragmento `AND ...` (o `Prisma.empty`) para anexar al `WHERE 1=1`. También `function aLista(v: unknown): string[]` para normalizar query params repetidos (`?contratos=A&contratos=B` llega como string o string[]).

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { Prisma } from '@prisma/client';
import { aLista, condicionesFiltros } from './filtros-analitica';

const lectura = { nivel: 'lectura', ks: [], inc: true };
const carga = (ks: string[]) => ({ nivel: 'carga', ks, inc: false });

describe('condicionesFiltros', () => {
  it('sin filtros y nivel lectura devuelve Prisma.empty (sin condiciones)', () => {
    expect(condicionesFiltros({}, lectura)).toEqual(Prisma.empty);
  });

  it('desde/hasta/tipo generan condiciones con bind params', () => {
    const sql = condicionesFiltros({ desde: '2026-01', hasta: '2026-06', tipo: 'OPEX' }, lectura)!;
    expect(sql.sql).toContain("DATE_FORMAT(fc.fecha, '%Y-%m') >= ?");
    expect(sql.sql).toContain("DATE_FORMAT(fc.fecha, '%Y-%m') <= ?");
    expect(sql.sql).toContain('fc.tipo = ?');
    expect(sql.values).toEqual(['2026-01', '2026-06', 'OPEX']);
  });

  it('tipo fuera de la lista blanca se ignora', () => {
    expect(condicionesFiltros({ tipo: 'ROBADO' }, lectura)).toEqual(Prisma.empty);
  });

  it('nivel carga sin filtro de contratos restringe a sus Ks', () => {
    const sql = condicionesFiltros({}, carga(['K6', 'K11']))!;
    expect(sql.sql).toContain('dc.codigo_k IN');
    expect(sql.values).toEqual(['K6', 'K11']);
  });

  it('nivel carga que pide contratos ajenos devuelve null (fail-closed, NO todo)', () => {
    expect(condicionesFiltros({ contratos: ['K2'] }, carga(['K6']))).toBeNull();
  });

  it('nivel carga interseca lo pedido con lo propio, case-insensitive', () => {
    const sql = condicionesFiltros({ contratos: ['k6', 'K2'] }, carga(['K6', 'K11']))!;
    expect(sql.values).toEqual(['K6']);
  });

  it('provincias van como IN con bind params', () => {
    const sql = condicionesFiltros({ provincias: ['Salta', 'Jujuy'] }, lectura)!;
    expect(sql.sql).toContain('pv.provincia IN');
    expect(sql.values).toEqual(['Salta', 'Jujuy']);
  });
});

describe('aLista', () => {
  it('undefined → [], string → [string], array → array', () => {
    expect(aLista(undefined)).toEqual([]);
    expect(aLista('K6')).toEqual(['K6']);
    expect(aLista(['K6', 'K2'])).toEqual(['K6', 'K2']);
  });
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx jest src/certificaciones/filtros-analitica.spec.ts`
Expected: FAIL — "Cannot find module './filtros-analitica'"

- [ ] **Step 3: Implementación mínima**

```ts
import { Prisma } from '@prisma/client';
import { CertClaim } from './accesos.service';

export interface FiltrosAnalitica {
  desde?: string;
  hasta?: string;
  contratos?: string[];
  provincias?: string[];
  tipo?: string;
}

/** Query params repetidos de Nest (`?contratos=A&contratos=B`) llegan como
 * string o string[]; esto los normaliza a lista. */
export function aLista(v: unknown): string[] {
  if (v == null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

/**
 * Fragmento `AND ...` para anexar a `WHERE 1=1` en las queries de analítica
 * (misma semántica que `_filtros()` del portal FastAPI, con dos correcciones
 * conscientes: bind params en vez de interpolación, y fail-closed — `null` —
 * cuando un nivel `carga` filtra solo por contratos ajenos).
 */
export function condicionesFiltros(f: FiltrosAnalitica, cert: CertClaim): Prisma.Sql | null {
  const conds: Prisma.Sql[] = [];
  if (f.desde) conds.push(Prisma.sql`DATE_FORMAT(fc.fecha, '%Y-%m') >= ${f.desde}`);
  if (f.hasta) conds.push(Prisma.sql`DATE_FORMAT(fc.fecha, '%Y-%m') <= ${f.hasta}`);

  let ks: string[] | null = null;
  if (cert.nivel === 'carga') {
    const propios = cert.ks.map((k) => k.toUpperCase());
    const pedidos = (f.contratos ?? []).map((k) => k.toUpperCase());
    ks = pedidos.length ? pedidos.filter((k) => propios.includes(k)) : propios;
    if (ks.length === 0) return null; // fail-closed: nada visible
  } else if (f.contratos?.length) {
    ks = f.contratos;
  }
  if (ks?.length) conds.push(Prisma.sql`dc.codigo_k IN (${Prisma.join(ks)})`);

  if (f.provincias?.length) conds.push(Prisma.sql`pv.provincia IN (${Prisma.join(f.provincias)})`);
  if (f.tipo === 'OPEX' || f.tipo === 'CAPEX') conds.push(Prisma.sql`fc.tipo = ${f.tipo}`);

  return conds.length ? Prisma.sql` AND ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
}
```

- [ ] **Step 4: Verificar que pasan**

Run: `npx jest src/certificaciones/filtros-analitica.spec.ts`
Expected: PASS (8 tests). Si `sql.values` de Prisma aplana distinto los `Prisma.join`, ajustar los asserts de `values` al aplanado real — el contrato importante es: bind params, no interpolación.

- [ ] **Step 5: Commit**

```bash
git add src/certificaciones/filtros-analitica.ts src/certificaciones/filtros-analitica.spec.ts
git commit -m "feat(certificaciones): constructor de filtros de analitica con visibilidad fail-closed"
```

---

### Task 3: AnaliticaService — evolución, por contrato, por provincia, top ítems

**Files:**
- Create: `src/certificaciones/analitica.service.ts`
- Test: `src/certificaciones/analitica.service.spec.ts`
- Modify: `src/certificaciones/certificaciones.module.ts` (agregar provider)
- Modify: `src/certificaciones/certificaciones.controller.ts` (4 rutas GET)

**Interfaces:**
- Consumes: `condicionesFiltros`/`aLista`/`FiltrosAnalitica` (Task 2), `PrismaService`, `CertClaim`.
- Produces (los shapes calcan las interfaces TS del frontend, §1.2 del inventario):
  - `evolucionMensual(f, cert): Promise<{ periodo: string; monto_total: number; pgn_total: number }[]>`
  - `porContratoMes(f, cert): Promise<{ periodo: string; contrato: string; monto_total: number; pgn_total: number }[]>`
  - `porProvincia(f, cert): Promise<{ provincia: string; monto_total: number; pgn_total: number; lineas: number }[]>`
  - `topItems(f, cert, limite = 10): Promise<{ item_codigo: string; tarea: string; contrato: string; monto_total: number; pgn_total: number }[]>`
  - Rutas: `GET /certificaciones/analytics/evolucion-mensual|por-contrato-mes|por-provincia|top-items` (query: `desde`, `hasta`, `contratos` y `provincias` repetidos, `tipo`; `top-items` además `limite` opcional).
  - Autorización: cualquier nivel del claim (`admin`/`lectura`/`carga`); sin claim → 403. La visibilidad por Ks la resuelve `condicionesFiltros`.

- [ ] **Step 1: Tests que fallan** (mock de `PrismaService` — mismo estilo que `incidencia.service.spec.ts`)

```ts
import { ForbiddenException } from '@nestjs/common';
import { AnaliticaService } from './analitica.service';

const lectura = { nivel: 'lectura', ks: [], inc: true };
const carga = { nivel: 'carga', ks: ['K6'], inc: false };

describe('AnaliticaService', () => {
  const prisma = { $queryRaw: jest.fn() } as any;
  const service = new AnaliticaService(prisma);
  beforeEach(() => prisma.$queryRaw.mockReset());

  it('sin claim tira Forbidden', async () => {
    await expect(service.evolucionMensual({}, null)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('evolucionMensual castea los Decimal de SUM a number', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { periodo: '2026-08', monto_total: '1234.50', pgn_total: '99.9' },
    ]);
    expect(await service.evolucionMensual({}, lectura)).toEqual([
      { periodo: '2026-08', monto_total: 1234.5, pgn_total: 99.9 },
    ]);
  });

  it('nivel carga con filtro de contratos ajenos devuelve [] sin tocar la BD (fail-closed)', async () => {
    expect(await service.porContratoMes({ contratos: ['K2'] }, carga)).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('porProvincia castea lineas (BigInt de COUNT) a number', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { provincia: 'Salta', monto_total: '10', pgn_total: '1', lineas: 5n },
    ]);
    expect(await service.porProvincia({}, lectura)).toEqual([
      { provincia: 'Salta', monto_total: 10, pgn_total: 1, lineas: 5 },
    ]);
  });

  it('topItems pasa el límite como bind param (default 10)', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await service.topItems({}, lectura);
    const sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.sql).toContain('LIMIT ?');
    expect(sql.values).toContain(10);
  });
});
```

- [ ] **Step 2: Verificar que fallan** — `npx jest src/certificaciones/analitica.service.spec.ts` → FAIL (módulo inexistente)

- [ ] **Step 3: Implementación**

```ts
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CertClaim } from './accesos.service';
import { condicionesFiltros, FiltrosAnalitica } from './filtros-analitica';

const num = (x: unknown) => (x == null ? 0 : Number(x));

/**
 * Endpoints de analítica del módulo Certificaciones, portados 1:1 del
 * FastAPI del portal (app/routers/analytics.py) sobre las tablas mudadas
 * sth_cert_* (spec etapa 2). PGN = SUM(cantidades * COALESCE(ptos_gasnor,0)),
 * con ptos_gasnor de la certificación (no del maestro) para calzar con PBI.
 */
@Injectable()
export class AnaliticaService {
  constructor(private readonly prisma: PrismaService) {}

  private exigirClaim(cert: CertClaim | null): CertClaim {
    if (!cert) throw new ForbiddenException('Sin acceso al módulo Certificaciones.');
    return cert;
  }

  // FROM compartido: fact ⋈ contrato ⋈ provincia (INNER, como el portal).
  private readonly fromBase = Prisma.sql`
    FROM sth_cert_certificaciones fc
    JOIN sth_cert_contratos  dc ON fc.id_contrato  = dc.id_contrato
    JOIN sth_cert_provincias pv ON fc.id_provincia = pv.id
  `;

  async evolucionMensual(f: FiltrosAnalitica, certIn: CertClaim | null) {
    const cert = this.exigirClaim(certIn);
    const cond = condicionesFiltros(f, cert);
    if (cond === null) return [];
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT DATE_FORMAT(fc.fecha, '%Y-%m') AS periodo,
             SUM(fc.total_mes) AS monto_total,
             SUM(fc.cantidades * COALESCE(fc.ptos_gasnor, 0)) AS pgn_total
      ${this.fromBase}
      WHERE 1=1 ${cond}
      GROUP BY periodo ORDER BY periodo ASC
    `);
    return rows.map((r) => ({ periodo: r.periodo, monto_total: num(r.monto_total), pgn_total: num(r.pgn_total) }));
  }

  async porContratoMes(f: FiltrosAnalitica, certIn: CertClaim | null) {
    const cert = this.exigirClaim(certIn);
    const cond = condicionesFiltros(f, cert);
    if (cond === null) return [];
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT DATE_FORMAT(fc.fecha, '%Y-%m') AS periodo,
             dc.codigo_k AS contrato,
             SUM(fc.total_mes) AS monto_total,
             SUM(fc.cantidades * COALESCE(fc.ptos_gasnor, 0)) AS pgn_total
      ${this.fromBase}
      WHERE 1=1 ${cond}
      GROUP BY periodo, dc.codigo_k
      ORDER BY periodo ASC, dc.codigo_k
    `);
    return rows.map((r) => ({
      periodo: r.periodo, contrato: r.contrato,
      monto_total: num(r.monto_total), pgn_total: num(r.pgn_total),
    }));
  }

  async porProvincia(f: FiltrosAnalitica, certIn: CertClaim | null) {
    const cert = this.exigirClaim(certIn);
    const cond = condicionesFiltros(f, cert);
    if (cond === null) return [];
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT pv.provincia,
             SUM(fc.total_mes) AS monto_total,
             SUM(fc.cantidades * COALESCE(fc.ptos_gasnor, 0)) AS pgn_total,
             COUNT(*) AS lineas
      ${this.fromBase}
      WHERE 1=1 ${cond}
      GROUP BY pv.provincia
      ORDER BY monto_total DESC
    `);
    return rows.map((r) => ({
      provincia: r.provincia,
      monto_total: num(r.monto_total), pgn_total: num(r.pgn_total), lineas: num(r.lineas),
    }));
  }

  async topItems(f: FiltrosAnalitica, certIn: CertClaim | null, limite = 10) {
    const cert = this.exigirClaim(certIn);
    const cond = condicionesFiltros(f, cert);
    if (cond === null) return [];
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT di.item_codigo,
             LEFT(fc.tarea, 60) AS tarea,
             dc.codigo_k AS contrato,
             SUM(fc.total_mes) AS monto_total,
             SUM(fc.cantidades * COALESCE(fc.ptos_gasnor, 0)) AS pgn_total
      FROM sth_cert_certificaciones fc
      JOIN sth_cert_items      di ON fc.id_item      = di.id_item
      JOIN sth_cert_contratos  dc ON fc.id_contrato  = dc.id_contrato
      JOIN sth_cert_provincias pv ON fc.id_provincia = pv.id
      WHERE 1=1 ${cond}
      GROUP BY di.item_codigo, fc.tarea, dc.codigo_k
      ORDER BY monto_total DESC
      LIMIT ${limite}
    `);
    return rows.map((r) => ({
      item_codigo: r.item_codigo, tarea: r.tarea, contrato: r.contrato,
      monto_total: num(r.monto_total), pgn_total: num(r.pgn_total),
    }));
  }
}
```

Rutas en `certificaciones.controller.ts` (mismo patrón de obtención del claim `cert` que las rutas `incidencia-mo` ya existentes en ese archivo — reusar el mismo decorator/param que ellas usan para llegar a `req.user.cert`):

```ts
@Get('analytics/evolucion-mensual')
evolucionMensual(@Query() q: Record<string, unknown>, /* claim cert como en incidencia-mo */) {
  return this.analitica.evolucionMensual(filtrosDesdeQuery(q), cert);
}
// ... idem por-contrato-mes / por-provincia / top-items
// top-items: limite = q.limite ? parseInt(String(q.limite), 10) : 10
```

con el helper (en `filtros-analitica.ts`, exportado):

```ts
export function filtrosDesdeQuery(q: Record<string, unknown>): FiltrosAnalitica {
  return {
    desde: q.desde ? String(q.desde) : undefined,
    hasta: q.hasta ? String(q.hasta) : undefined,
    contratos: aLista(q.contratos),
    provincias: aLista(q.provincias),
    tipo: q.tipo ? String(q.tipo) : undefined,
  };
}
```

(Agregar 1 test de `filtrosDesdeQuery` al spec de Task 2 en este mismo task: entrada `{ contratos: 'K6', desde: '2026-01' }` → `{ desde: '2026-01', hasta: undefined, contratos: ['K6'], provincias: [], tipo: undefined }`.)

- [ ] **Step 4: Verificar que pasan** — `npx jest src/certificaciones` → PASS todo el módulo

- [ ] **Step 5: Commit**

```bash
git add src/certificaciones
git commit -m "feat(certificaciones): analytics NestJS — evolucion, por contrato, por provincia, top items"
```

---

### Task 4: Interanual

**Files:**
- Create: `src/certificaciones/interanual.ts` (transformación pura)
- Test: `src/certificaciones/interanual.spec.ts`
- Modify: `src/certificaciones/analitica.service.ts` (método `interanual`)
- Modify: `src/certificaciones/certificaciones.controller.ts` (ruta `GET analytics/interanual`)

**Interfaces:**
- Consumes: filas `{ anio: number; mes: number; monto_total: unknown; pgn_total: unknown }[]` de la query.
- Produces: `function armarInteranual(rows): InteranualResponse` con `InteranualResponse = { anio_actual: number | null; anio_anterior: number | null; meses: InteranualMes[] }` y `InteranualMes = { mes: number; monto_actual: number | null; monto_anterior: number | null; pgn_actual: number | null; pgn_anterior: number | null; var_monto: number | null; var_pgn: number | null }`. Ruta `GET /certificaciones/analytics/interanual` (query: `contratos`, `provincias`, `tipo`; NO acepta `desde`/`hasta`, igual que el portal).

- [ ] **Step 1: Tests que fallan** (la lógica calcada del post-procesamiento Python del portal)

```ts
import { armarInteranual } from './interanual';

describe('armarInteranual', () => {
  it('separa año actual/anterior según los datos presentes (no según el calendario)', () => {
    const r = armarInteranual([
      { anio: 2026, mes: 3, monto_total: '200', pgn_total: '20' },
      { anio: 2025, mes: 3, monto_total: '100', pgn_total: '10' },
    ]);
    expect(r.anio_actual).toBe(2026);
    expect(r.anio_anterior).toBe(2025);
    expect(r.meses).toEqual([
      {
        mes: 3, monto_actual: 200, monto_anterior: 100, pgn_actual: 20, pgn_anterior: 10,
        var_monto: 100, var_pgn: 100,
      },
    ]);
  });

  it('con datos de un solo año, anio_anterior es null y las variaciones null', () => {
    const r = armarInteranual([{ anio: 2025, mes: 1, monto_total: '50', pgn_total: '5' }]);
    expect(r.anio_actual).toBe(2025);
    expect(r.anio_anterior).toBeNull();
    expect(r.meses[0].var_monto).toBeNull();
  });

  it('variación redondeada a 1 decimal y null si el anterior es 0', () => {
    const r = armarInteranual([
      { anio: 2026, mes: 1, monto_total: '3', pgn_total: '1' },
      { anio: 2025, mes: 1, monto_total: '9', pgn_total: '0' },
    ]);
    expect(r.meses[0].var_monto).toBe(-66.7);
    expect(r.meses[0].var_pgn).toBeNull();
  });

  it('meses sin datos no se rellenan; salen ordenados ascendente', () => {
    const r = armarInteranual([
      { anio: 2026, mes: 5, monto_total: '1', pgn_total: '1' },
      { anio: 2026, mes: 2, monto_total: '1', pgn_total: '1' },
    ]);
    expect(r.meses.map((m) => m.mes)).toEqual([2, 5]);
  });

  it('sin filas: todo null y meses vacío', () => {
    expect(armarInteranual([])).toEqual({ anio_actual: null, anio_anterior: null, meses: [] });
  });
});
```

- [ ] **Step 2: Verificar que fallan** — `npx jest src/certificaciones/interanual.spec.ts` → FAIL

- [ ] **Step 3: Implementación**

```ts
export interface InteranualMes {
  mes: number;
  monto_actual: number | null;
  monto_anterior: number | null;
  pgn_actual: number | null;
  pgn_anterior: number | null;
  var_monto: number | null;
  var_pgn: number | null;
}
export interface InteranualResponse {
  anio_actual: number | null;
  anio_anterior: number | null;
  meses: InteranualMes[];
}

const num = (x: unknown) => (x == null ? 0 : Number(x));
const var1dec = (actual: number | null, anterior: number | null): number | null =>
  actual !== null && anterior !== null && anterior > 0
    ? Math.round(((actual - anterior) / anterior) * 1000) / 10
    : null;

/** Post-procesamiento calcado del portal: años según datos presentes,
 * meses solo los que tienen filas, variación a 1 decimal. */
export function armarInteranual(
  rows: { anio: number; mes: number; monto_total: unknown; pgn_total: unknown }[],
): InteranualResponse {
  const anios = [...new Set(rows.map((r) => r.anio))].sort((a, b) => b - a);
  const anioActual = anios[0] ?? null;
  const anioAnterior = anios[1] ?? null;

  const porMes = new Map<number, InteranualMes>();
  for (const r of rows) {
    let d = porMes.get(r.mes);
    if (!d) {
      d = { mes: r.mes, monto_actual: null, monto_anterior: null, pgn_actual: null, pgn_anterior: null, var_monto: null, var_pgn: null };
      porMes.set(r.mes, d);
    }
    if (r.anio === anioActual) {
      d.monto_actual = num(r.monto_total);
      d.pgn_actual = num(r.pgn_total);
    } else if (r.anio === anioAnterior) {
      d.monto_anterior = num(r.monto_total);
      d.pgn_anterior = num(r.pgn_total);
    }
  }
  for (const d of porMes.values()) {
    d.var_monto = var1dec(d.monto_actual, d.monto_anterior);
    d.var_pgn = var1dec(d.pgn_actual, d.pgn_anterior);
  }
  return {
    anio_actual: anioActual,
    anio_anterior: anioAnterior,
    meses: [...porMes.keys()].sort((a, b) => a - b).map((m) => porMes.get(m)!),
  };
}
```

Método en `AnaliticaService` (query igual al portal, sobre los dos años calendario en curso):

```ts
async interanual(f: FiltrosAnalitica, certIn: CertClaim | null): Promise<InteranualResponse> {
  const cert = this.exigirClaim(certIn);
  const cond = condicionesFiltros({ ...f, desde: undefined, hasta: undefined }, cert);
  if (cond === null) return { anio_actual: null, anio_anterior: null, meses: [] };
  const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT YEAR(fc.fecha) AS anio, MONTH(fc.fecha) AS mes,
           SUM(fc.total_mes) AS monto_total,
           SUM(fc.cantidades * COALESCE(fc.ptos_gasnor, 0)) AS pgn_total
    ${this.fromBase}
    WHERE YEAR(fc.fecha) IN (YEAR(CURDATE()), YEAR(CURDATE()) - 1) ${cond}
    GROUP BY anio, mes
    ORDER BY mes ASC, anio ASC
  `);
  return armarInteranual(rows.map((r) => ({ ...r, anio: Number(r.anio), mes: Number(r.mes) })));
}
```

y la ruta `@Get('analytics/interanual')` en el controller (query sin `desde`/`hasta`).

- [ ] **Step 4: Verificar** — `npx jest src/certificaciones` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(certificaciones): analytics interanual"`

---

### Task 5: Listados de filtros + estado de cargas

**Files:**
- Create: `src/certificaciones/estado-cargas.ts` (lógica pura de la grilla)
- Test: `src/certificaciones/estado-cargas.spec.ts`
- Modify: `src/certificaciones/analitica.service.ts` (métodos `contratos`, `provincias`, `estadoCargas`)
- Modify: `src/certificaciones/certificaciones.controller.ts` (rutas `GET analytics/contratos`, `analytics/provincias`, `analytics/estado-cargas`)

**Interfaces:**
- Produces:
  - `contratos(cert): Promise<string[]>` — nivel `carga`: devuelve `cert.ks` directo (sin BD, como el portal); otros: `SELECT codigo_k FROM sth_cert_contratos ORDER BY codigo_k`.
  - `provincias(cert): Promise<string[]>` — `SELECT provincia FROM sth_cert_provincias WHERE activo = 1 ORDER BY provincia` (sin recorte por nivel).
  - `estadoCargas(cert): Promise<EstadoCargaContrato[]>` con `EstadoCargaContrato = { contrato: string; periodo: string; cargado: boolean; usuario: string | null; cargado_en: string | null; filas_cargadas: number | null; estado: string | null }`.
  - Pura: `construirEstadoCargas(contratosVisibles: string[], cargas: CargaLogFila[], hoy: Date): EstadoCargaContrato[]` con `CargaLogFila = { contrato: string | null; periodo: string; usuario_nombre: string | null; cargado_en: Date | null; filas_cargadas: number | null; estado: string | null }` (las filas ya vienen ordenadas `periodo DESC, contrato` desde SQL).

- [ ] **Step 1: Tests de la lógica pura que fallan**

```ts
import { construirEstadoCargas } from './estado-cargas';

const HOY = new Date(2025, 2, 15); // 2025-03-15 (día >= 10: incluye el mes en curso)

describe('construirEstadoCargas', () => {
  it('arma la grilla 2025-01..mes actual (más reciente primero) por contrato visible', () => {
    const r = construirEstadoCargas(['K5'], [], HOY);
    expect(r.map((f) => f.periodo)).toEqual(['2025-03', '2025-02', '2025-01']);
    expect(r.every((f) => f.contrato === 'K5' && f.cargado === false && f.usuario === null)).toBe(true);
  });

  it('un log con contrato CSV "K5, K6" marca cargados a los dos', () => {
    const r = construirEstadoCargas(['K5', 'K6'], [{
      contrato: 'K5, K6', periodo: '2025-01', usuario_nombre: 'Ana',
      cargado_en: new Date(2025, 1, 3, 10, 30), filas_cargadas: 12, estado: 'ok',
    }], HOY);
    const enero = r.filter((f) => f.periodo === '2025-01');
    expect(enero).toEqual([
      { contrato: 'K5', periodo: '2025-01', cargado: true, usuario: 'Ana', cargado_en: '2025-02-03', filas_cargadas: 12, estado: 'ok' },
      { contrato: 'K6', periodo: '2025-01', cargado: true, usuario: 'Ana', cargado_en: '2025-02-03', filas_cargadas: 12, estado: 'ok' },
    ]);
  });

  it('deduplica quedándose con la primera fila por contrato+periodo (orden de entrada)', () => {
    const base = { contrato: 'K5', periodo: '2025-01', filas_cargadas: 1, estado: 'ok', cargado_en: null };
    const r = construirEstadoCargas(['K5'], [
      { ...base, usuario_nombre: 'Primera' },
      { ...base, usuario_nombre: 'Segunda' },
    ], HOY);
    expect(r.find((f) => f.periodo === '2025-01')!.usuario).toBe('Primera');
  });

  it('contratos fuera de la lista visible se ignoran', () => {
    const r = construirEstadoCargas(['K5'], [{
      contrato: 'K6', periodo: '2025-01', usuario_nombre: 'Ana', cargado_en: null, filas_cargadas: 1, estado: 'ok',
    }], HOY);
    expect(r.find((f) => f.periodo === '2025-01')!.cargado).toBe(false);
  });

  it('antes del día 10 el mes en curso se omite entero', () => {
    const r = construirEstadoCargas(['K5'], [], new Date(2025, 2, 9)); // 2025-03-09
    expect(r.map((f) => f.periodo)).toEqual(['2025-02', '2025-01']);
  });
});
```

- [ ] **Step 2: Verificar que fallan** — FAIL (módulo inexistente)

- [ ] **Step 3: Implementación**

```ts
export interface CargaLogFila {
  contrato: string | null;
  periodo: string;
  usuario_nombre: string | null;
  cargado_en: Date | null;
  filas_cargadas: number | null;
  estado: string | null;
}
export interface EstadoCargaContrato {
  contrato: string;
  periodo: string;
  cargado: boolean;
  usuario: string | null;
  cargado_en: string | null;
  filas_cargadas: number | null;
  estado: string | null;
}

const fechaISO = (d: Date | null): string | null => {
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Grilla contrato × período (2025-01..mes actual, descendente) marcando qué
 * quincena de carga existe en el log. Calcada del portal, con un fix
 * consciente: cargado_en sale como fecha YYYY-MM-DD de verdad (el split("T")
 * del portal no cortaba nada y salía con hora). */
export function construirEstadoCargas(
  contratosVisibles: string[],
  cargas: CargaLogFila[],
  hoy: Date,
): EstadoCargaContrato[] {
  const visibles = new Set(contratosVisibles);
  const cargados = new Map<string, EstadoCargaContrato>();
  for (const c of cargas) {
    for (const k of (c.contrato ?? '').split(',').map((x) => x.trim())) {
      if (!k || !visibles.has(k)) continue;
      const clave = `${k}__${c.periodo}`;
      if (cargados.has(clave)) continue; // primera gana (entrada ya ordenada periodo DESC)
      cargados.set(clave, {
        contrato: k, periodo: c.periodo, cargado: true,
        usuario: c.usuario_nombre, cargado_en: fechaISO(c.cargado_en),
        filas_cargadas: c.filas_cargadas, estado: c.estado,
      });
    }
  }

  const periodos: string[] = [];
  for (let a = 2025, m = 1; a < hoy.getFullYear() || (a === hoy.getFullYear() && m <= hoy.getMonth() + 1); ) {
    periodos.push(`${a}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; a += 1; }
  }

  const resultado: EstadoCargaContrato[] = [];
  for (const periodo of [...periodos].reverse()) {
    const esActual = periodo === `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    if (esActual && hoy.getDate() < 10) continue; // regla del día 10
    for (const contrato of contratosVisibles) {
      resultado.push(
        cargados.get(`${contrato}__${periodo}`) ?? {
          contrato, periodo, cargado: false,
          usuario: null, cargado_en: null, filas_cargadas: null, estado: null,
        },
      );
    }
  }
  return resultado;
}
```

Métodos en `AnaliticaService`:

```ts
async contratos(certIn: CertClaim | null): Promise<string[]> {
  const cert = this.exigirClaim(certIn);
  if (cert.nivel === 'carga') return cert.ks; // como el portal: directo del claim
  const rows = await this.prisma.$queryRaw<{ codigo_k: string }[]>(
    Prisma.sql`SELECT codigo_k FROM sth_cert_contratos ORDER BY codigo_k`,
  );
  return rows.map((r) => r.codigo_k);
}

async provincias(certIn: CertClaim | null): Promise<string[]> {
  this.exigirClaim(certIn);
  const rows = await this.prisma.$queryRaw<{ provincia: string }[]>(
    Prisma.sql`SELECT provincia FROM sth_cert_provincias WHERE activo = 1 ORDER BY provincia`,
  );
  return rows.map((r) => r.provincia);
}

async estadoCargas(certIn: CertClaim | null): Promise<EstadoCargaContrato[]> {
  const cert = this.exigirClaim(certIn);
  const todosRows = await this.prisma.$queryRaw<{ codigo_k: string }[]>(
    Prisma.sql`SELECT codigo_k FROM sth_cert_contratos ORDER BY codigo_k`,
  );
  let todos = todosRows.map((r) => r.codigo_k);
  if (cert.nivel === 'carga') {
    const propios = new Set(cert.ks.map((k) => k.toUpperCase()));
    todos = todos.filter((k) => propios.has(k.toUpperCase()));
  }
  const cargas = await this.prisma.$queryRaw<CargaLogFila[]>(Prisma.sql`
    SELECT contrato, periodo, usuario_nombre, cargado_en, filas_cargadas, estado
    FROM sth_cert_cargas_log
    WHERE periodo >= '2025-01' AND estado != 'error'
    ORDER BY periodo DESC, contrato
  `);
  return construirEstadoCargas(todos, cargas, new Date());
}
```

y las 3 rutas en el controller. Test de service (agregar al spec de Task 3): `contratos` con nivel `carga` devuelve `cert.ks` sin llamar a `$queryRaw`.

- [ ] **Step 4: Verificar** — `npx jest src/certificaciones` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(certificaciones): listados de filtros y estado de cargas en NestJS"`

---

### Task 6: Resumen y presupuesto

**Files:**
- Create: `src/certificaciones/resumen.service.ts`
- Test: `src/certificaciones/resumen.service.spec.ts`
- Modify: `src/certificaciones/certificaciones.module.ts` (provider)
- Modify: `src/certificaciones/certificaciones.controller.ts` (rutas `GET resumen` y `GET analytics/presupuesto`)

**Interfaces:**
- Produces:
  - `resumen(cert): Promise<{ periodo: string; contrato: string; tipo: string; lineas: number; monto_total: number }[]>` — ruta `GET /certificaciones/resumen`, cualquier nivel; nivel `carga` recortado a sus Ks (con `ks` vacío → `[]`, fix del `IN ()` del portal); `GROUP BY periodo, codigo_k, tipo`, `ORDER BY periodo DESC, codigo_k`, `LIMIT 200`.
  - `presupuesto(cert): Promise<{ contrato: string; descripcion: string; periodo_desde: string; periodo_hasta: string; monto_presupuesto: number; consumido: number; pct: number }[]>` — ruta `GET /certificaciones/analytics/presupuesto`; nivel `carga` → 403 (equivale al `require_gerente_or_admin` del portal; es el 403 que el hook `usePresupuesto` ya espera con `retry: false`).

- [ ] **Step 1: Tests que fallan**

```ts
import { ForbiddenException } from '@nestjs/common';
import { ResumenService } from './resumen.service';

const lectura = { nivel: 'lectura', ks: [], inc: true };

describe('ResumenService.resumen', () => {
  const prisma = { $queryRaw: jest.fn() } as any;
  const service = new ResumenService(prisma);
  beforeEach(() => prisma.$queryRaw.mockReset());

  it('castea lineas y monto_total a number', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { periodo: '2026-08', contrato: 'K6', tipo: 'OPEX', lineas: 3n, monto_total: '150.5' },
    ]);
    expect(await service.resumen(lectura)).toEqual([
      { periodo: '2026-08', contrato: 'K6', tipo: 'OPEX', lineas: 3, monto_total: 150.5 },
    ]);
  });

  it('nivel carga con ks vacío devuelve [] sin tocar la BD (fix del IN () del portal)', async () => {
    expect(await service.resumen({ nivel: 'carga', ks: [], inc: false })).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('sin claim tira Forbidden', async () => {
    await expect(service.resumen(null)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ResumenService.presupuesto', () => {
  const prisma = { $queryRaw: jest.fn() } as any;
  const service = new ResumenService(prisma);
  beforeEach(() => prisma.$queryRaw.mockReset());

  it('nivel carga → Forbidden (el hook usePresupuesto espera este 403)', async () => {
    await expect(service.presupuesto({ nivel: 'carga', ks: ['K6'], inc: true }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('calcula pct a 1 decimal y serializa fechas YYYY-MM-DD', async () => {
    prisma.$queryRaw.mockResolvedValue([{
      contrato: 'K6', descripcion: 'Mant.', periodo_desde: new Date(2026, 0, 1),
      periodo_hasta: new Date(2026, 11, 31), monto_presupuesto: '3000', consumido: '1000',
    }]);
    expect(await service.presupuesto(lectura)).toEqual([{
      contrato: 'K6', descripcion: 'Mant.', periodo_desde: '2026-01-01', periodo_hasta: '2026-12-31',
      monto_presupuesto: 3000, consumido: 1000, pct: 33.3,
    }]);
  });

  it('monto_presupuesto 0 → pct 0 (sin división por cero)', async () => {
    prisma.$queryRaw.mockResolvedValue([{
      contrato: 'K6', descripcion: 'x', periodo_desde: new Date(2026, 0, 1),
      periodo_hasta: new Date(2026, 0, 2), monto_presupuesto: '0', consumido: '10',
    }]);
    expect((await service.presupuesto(lectura))[0].pct).toBe(0);
  });
});
```

- [ ] **Step 2: Verificar que fallan** — FAIL (módulo inexistente)

- [ ] **Step 3: Implementación**

```ts
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CertClaim } from './accesos.service';

const num = (x: unknown) => (x == null ? 0 : Number(x));
const fechaISO = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

@Injectable()
export class ResumenService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resumen por período × contrato × tipo (portado de /certificaciones/resumen
   * del portal). LIMIT 200 como el original — el filtro de período lo hace el
   * frontend client-side; si el volumen crece, agregar filtro server-side. */
  async resumen(cert: CertClaim | null) {
    if (!cert) throw new ForbiddenException('Sin acceso al módulo Certificaciones.');
    let filtro = Prisma.empty;
    if (cert.nivel === 'carga') {
      if (cert.ks.length === 0) return []; // fix: el portal generaba IN () inválido
      filtro = Prisma.sql`AND dc.codigo_k IN (${Prisma.join(cert.ks)})`;
    }
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT DATE_FORMAT(fc.fecha, '%Y-%m') AS periodo,
             dc.codigo_k AS contrato,
             fc.tipo,
             COUNT(*) AS lineas,
             SUM(fc.total_mes) AS monto_total
      FROM sth_cert_certificaciones fc
      JOIN sth_cert_contratos dc ON fc.id_contrato = dc.id_contrato
      WHERE 1=1 ${filtro}
      GROUP BY periodo, dc.codigo_k, fc.tipo
      ORDER BY periodo DESC, dc.codigo_k
      LIMIT 200
    `);
    return rows.map((r) => ({
      periodo: r.periodo, contrato: r.contrato, tipo: r.tipo,
      lineas: num(r.lineas), monto_total: num(r.monto_total),
    }));
  }

  /** Consumo del presupuesto Naturgy vigente por contrato. Solo niveles
   * admin/lectura (el portal exigía gerente|admin; carga → 403). */
  async presupuesto(cert: CertClaim | null) {
    if (!cert || cert.nivel === 'carga') {
      throw new ForbiddenException('Sin acceso al presupuesto por contrato.');
    }
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT dc.codigo_k AS contrato,
             dc.descripcion AS descripcion,
             dp.periodo_desde, dp.periodo_hasta, dp.monto_presupuesto,
             COALESCE(SUM(fc.total_mes), 0) AS consumido
      FROM sth_cert_presupuestos dp
      JOIN sth_cert_contratos dc ON dp.id_contrato = dc.id_contrato
      LEFT JOIN sth_cert_certificaciones fc
             ON fc.id_contrato = dp.id_contrato
            AND fc.fecha BETWEEN dp.periodo_desde AND dp.periodo_hasta
      WHERE dp.activo = 1
      GROUP BY dc.codigo_k, dc.descripcion, dp.periodo_desde, dp.periodo_hasta, dp.monto_presupuesto
      ORDER BY (COALESCE(SUM(fc.total_mes), 0) / dp.monto_presupuesto) DESC
    `);
    return rows.map((r) => {
      const monto = num(r.monto_presupuesto);
      const consumido = num(r.consumido);
      return {
        contrato: r.contrato, descripcion: r.descripcion,
        periodo_desde: fechaISO(r.periodo_desde), periodo_hasta: fechaISO(r.periodo_hasta),
        monto_presupuesto: monto, consumido,
        pct: monto ? Math.round((consumido / monto) * 1000) / 10 : 0,
      };
    });
  }
}
```

más las rutas `@Get('resumen')` y `@Get('analytics/presupuesto')` en el controller (claim como en las demás).

- [ ] **Step 4: Verificar** — `npx jest src/certificaciones` → PASS. Después `npm test` completo (backend) → PASS. Después `npx tsc --noEmit` → limpio.
- [ ] **Step 5: Commit** — `git commit -m "feat(certificaciones): resumen y presupuesto en NestJS"`

---

### Task 7: Frontend — adiós `apiCert`

**Files:**
- Modify: `src/lib/api/certificaciones.ts` (Frontend)
- Modify: `src/lib/api/certificaciones.test.tsx` (Frontend)
- Modify: `.env.example` (Frontend — borrar `NEXT_PUBLIC_CERT_API_URL`)

**Interfaces:**
- Consumes: las rutas NestJS de Tasks 3-6 (`/certificaciones/analytics/*` y `/certificaciones/resumen`).
- Produces: los mismos 11 hooks con las MISMAS firmas e interfaces — las páginas `certificaciones/page.tsx` y `certificaciones/analytics/page.tsx` NO se tocan.

- [ ] **Step 1: Actualizar los tests primero** (`certificaciones.test.tsx` mockea el adapter de `apiCert` en 7 tests; reapuntarlos al `api` de `./client` y a las URLs nuevas). Cambios de contrato a asertar:
  - Base URL: los requests van al `api` de Horas (mock del adapter de `api`), no a un axios propio.
  - URLs: `/certificaciones/analytics/evolucion-mensual`, `/certificaciones/analytics/por-contrato-mes`, `/certificaciones/analytics/por-provincia`, `/certificaciones/analytics/top-items`, `/certificaciones/analytics/interanual`, `/certificaciones/analytics/contratos`, `/certificaciones/analytics/provincias`, `/certificaciones/analytics/estado-cargas`, `/certificaciones/analytics/presupuesto`, `/certificaciones/resumen`.
  - Se conservan tal cual los asserts de: claves repetidas sin corchetes, interanual sin `desde`/`hasta`, sin query params vacíos.

- [ ] **Step 2: Correr los tests y verlos fallar** — `npx vitest run src/lib/api/certificaciones.test.tsx` → FAIL (siguen pegando a `apiCert`)

- [ ] **Step 3: Reescribir la capa cliente** en `certificaciones.ts`:
  - Borrar `apiCert` (el `axios.create`, su interceptor y los imports de `axios`/`getToken`).
  - Reemplazar los helpers:

```ts
const getCert = async <T>(url: string) => (await api.get<T>(url)).data;

const getCertAnalytics = async <T>(url: string, filtros: FiltrosAnalytics) =>
  (await api.get<T>(url, { params: paramsAnalytics(filtros) })).data;
```

  - Actualizar la URL de cada hook al prefijo nuevo (p. ej. `getCertAnalytics<EvolucionMensualPunto[]>('/certificaciones/analytics/evolucion-mensual', filtros)`, `getCert<FilaResumenCert[]>('/certificaciones/resumen')`, etc. — los 11).
  - `paramsAnalytics`, las interfaces y los `select` client-side quedan tal cual.
  - Actualizar el comentario de cabecera del archivo (ya no hay backend FastAPI aparte).

- [ ] **Step 4: Verificar** — `npx vitest run src/lib/api/certificaciones.test.tsx` → PASS; después `npm test` completo (frontend) → PASS; `npx tsc --noEmit` → limpio; `grep -r "apiCert\|NEXT_PUBLIC_CERT_API_URL" src/` → sin resultados.

- [ ] **Step 5: Borrar la variable del `.env.example`** (el bloque de `NEXT_PUBLIC_CERT_API_URL` completo) y **Commit**

```bash
git add src/lib/api/certificaciones.ts src/lib/api/certificaciones.test.tsx .env.example
git commit -m "feat(certificaciones): resumen y analytics contra NestJS — muere apiCert"
```

---

### Task 8: Checklist de deploy y documentación

**Files:**
- Create: `docs/2026-09-xx-erp-etapa2-deploy.md` (Backend Horas; fecha del día del deploy)

**Interfaces:**
- Consumes: scripts de Task 1, todo lo anterior mergeado.
- Produces: checklist ejecutable para el deploy (que se corre SOLO con pedido explícito del usuario, con aviso antes de cada restart).

- [ ] **Step 1: Escribir el checklist** con este contenido (orden estricto):

```markdown
# Deploy ERP etapa 2 — checklist

Pre-requisito: PRs de etapa 2 mergeados en Horas Backend y Frontend. El repo
del portal NO tiene cambios de código en esta etapa (verificarlo igual:
regla de los TRES repos).

1. Backup: mysqldump de las 7 tablas del portal en `testing`
   (fact_certificaciones, dim_item, dim_contrato, ma_provincias, carga_log,
   dim_presupuesto_contrato, usuarios) → guardar en el VPS con fecha.
2. En `Horas_Sertec`: ejecutar la Sección B del script de mudanza
   (docs/sql/2026-09-01-mudanza-certificaciones.sql), descomentada y con el
   prefijo `testing.` en los SELECT de origen. Necesita un usuario MySQL con
   lectura sobre `testing` y DDL sobre `Horas_Sertec`; si el usuario de la
   app no tiene esos grants, pedir a IT o correrlo por partes (dump/restore).
3. Verificar conteos con docs/sql/2026-09-01-mudanza-verificacion.sql
   (en Horas_Sertec las tablas "viejas" son las vistas: conteos iguales por
   definición — la verificación real es contra los conteos anotados de
   `testing` en el paso 1).
4. Repuntar el portal: en /var/www/PortalCertificaciones_back/.env cambiar
   DB_NAME=testing → DB_NAME=Horas_Sertec (backup del .env) y
   `sudo docker compose up -d --force-recreate` (restart NO recarga el .env).
   Smoke del portal: health 200, login propio OK, dashboard con datos.
5. Congelar: a partir de acá las tablas viejas de `testing` quedan stale
   (anotarlo — el snapshot dev sth_cert_* de testing se puede refrescar
   con la Sección A cuando haga falta).
6. Deploy Horas: pull main + npm install + build en ambos repos.
7. AVISO al usuario y `sudo pm2 restart forms-horas-back forms-horas-front`.
8. Smoke Horas: front 200; /api/certificaciones/resumen 401 sin token;
   con un usuario real: Resumen y Analytics con datos.
9. Paridad: para un período cerrado, comparar los totales de
   misregistros/certificaciones vs el portal (mismo monto certificado,
   mismo PGN, misma cantidad de filas de estado de cargas).
10. Limpieza: borrar NEXT_PUBLIC_CERT_API_URL del .env.production del
    frontend (quedó muerta; el build nuevo ya no la lee), sacar
    https://misregistros.serytec.com.ar de ALLOWED_ORIGINS del portal y
    (opcional, recomendado) vaciar HORAS_JWT_SECRET del portal — nada de
    Horas le pega más. Recreate del contenedor del portal.
11. Documentar la sesión: contexto de Horas (sección nueva) y
    CONTEXTO_SISTEMA.md del portal.
```

- [ ] **Step 2: Commit**

```bash
git add docs/2026-09-xx-erp-etapa2-deploy.md
git commit -m "docs(certificaciones): checklist de deploy de la etapa 2"
```

- [ ] **Step 3 (cierre de la etapa, con el usuario):** mostrarle el trabajo, OK, PRs (Backend y Frontend de Horas), merge `--admin`, y el deploy queda pendiente de su pedido explícito siguiendo el checklist.

---

## Self-review del plan (hecho)

- **Cobertura del spec (etapa 2):** mudanza+renombre+vistas (Task 1 y 8), endpoints NestJS de lectura (Tasks 3-6), muerte de `apiCert` + retiro de envs/CORS (Tasks 7 y 8 paso 10), paridad (Task 8 paso 9), tres repos (Task 8 pre-requisito). El claim `cert` sigue vivo en el JWT de Horas (lo usa el propio NestJS); lo que se retira es que el PORTAL lo acepte.
- **Placeholders:** ninguno — cada task tiene test y código completos; las únicas referencias externas son a código existente del repo (patrón del claim en `incidencia-mo`), que el ejecutor tiene a mano.
- **Consistencia de tipos:** `CertClaim` (Task 2-6) es el existente de `accesos.service.ts`; shapes de respuesta calcados de las interfaces TS del frontend (§1.2 del inventario); `EstadoCargaContrato` definido una sola vez (Task 5) y reusado.
