# Análisis de la quincena (Liquidador) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sección nueva `/liquidacion/analisis` (Liquidador + Admin) con los KPIs de la quincena liquidada: total pagado y variación, composición del pago, top 10 cobradores con Δ% personal, corte por contrato (prorrateo por horas), serie histórica y tabla de variaciones por persona.

**Architecture:** Backend: `AnalisisService` nuevo que ORQUESTA el motor existente (`CalculoService#calcularQuincena`) — lo corre para la quincena elegida, la anterior y las últimas 8 para el histórico, agrega días trabajados (query propia) y el prorrateo por contrato (query propia + reparto). Un solo endpoint `GET /liquidacion/analisis`. Frontend: página nueva con Recharts (patrón de Control general) y tokens de color nuevos.

**Tech Stack:** NestJS + Prisma (sin DDL, cero cambios de esquema), Next.js + Recharts + Vitest.

## Global Constraints

- Decisiones del grilling 2026-08-12: ubicación `/liquidacion/analisis`, roles heredados del controller (`Admin`,`Liquidador`); **cálculo en vivo, sin snapshots** (misma regla que todo el módulo, ADR-010); corte por contrato por **prorrateo por horas aprobadas** con renglón "Sin contrato asignable" para regímenes sin horas; días trabajados = **días distintos con horas aprobadas** en la quincena.
- Rama `feature/analisis-quincena` en ambos repos, desde `main` actualizado. NO pushear, NO PR, NADA de deploy ni VPS ni DDL.
- Paleta de la composición (5 series, validada con el validador de dataviz sobre blanco): básico `#a97a16`, horas extra `#3b6fc4`, presentismo `#1f8a70`, plus `#7d5bc6`, bono `#b3543e`. Los dos primeros ya existen como `--color-chart-1/2`; agregar `--color-chart-3/4/5` en `globals.css`. En los componentes usar los HEX como constantes importadas (los tokens `@theme` NO llegan a SVG/style inline — lección documentada en memoria `graficos-con-libriera`/`graficos-con-libreria`).
- ⚠️ vitest en esta máquina: SIEMPRE por archivo; los render-tests del módulo liquidación pueden COLGARSE (§52) — si un test de render se cuelga (>120s), matarlo y testear por helpers puros + mocks livianos como hizo `control-general` (mock de `ResponsiveContainer` con tamaño fijo, patrón en `src/app/(protected)/control-general/control-general-page.test.tsx`).
- Formato de moneda: `toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })` para tiles/labels (los centavos no aportan en KPIs); 2 decimales solo en la tabla de variaciones.
- Backend: TDD con `prismaMock`/mocks de servicios como los specs existentes. Commits en español + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Contrato de datos (la interfaz entre los dos agentes — respetar EXACTO)

```ts
// GET /liquidacion/analisis?anio=2026&mes=8&quincena=1  →  AnalisisQuincena
interface AnalisisQuincena {
  periodo: { anio: number; mes: number; quincena: number };
  totales: {
    total: number;            // suma de fila.total de la quincena
    empleados: number;
    empleadosNuevos: number;  // sin fila en la quincena anterior
    horasCct: number;
    horasExtra: number;
    costoPromedio: number;    // total / empleados (0 si no hay empleados)
  };
  anterior: { total: number; empleados: number; costoPromedio: number } | null; // null si el motor devuelve 0 filas para la anterior
  composicion: { basico: number; extras: number; presentismo: number; plus: number; bono: number };
  topCobradores: {            // top 10 por total desc
    cuil: string; nombre: string; total: number;
    totalAnterior: number | null; deltaPct: number | null; // null = nuevo
    diasTrabajados: number;
  }[];
  contratos: {                // orden: monto desc; el bucket sin contrato va último
    contratoId: number | null;         // null = "Sin contrato asignable"
    codigo: string;                    // 'Sin contrato asignable' para el bucket
    nombre: string;
    monto: number;                     // prorrateo por horas del total de cada empleado
    horas: number;                     // horas aprobadas del contrato en la quincena (0 en el bucket)
    pctDelTotal: number;               // monto / totales.total * 100, 1 decimal
  }[];
  historico: { anio: number; mes: number; quincena: number; total: number }[]; // 8 quincenas asc, incluida la actual
  variaciones: {              // TODOS los empleados; orden |deltaPct| desc, los nuevos (delta null) al final
    cuil: string; nombre: string; regimen: string;
    total: number; totalAnterior: number | null;
    deltaMonto: number | null; deltaPct: number | null;
    diasTrabajados: number;
  }[];
}
```

Reglas de cálculo:
- `deltaPct = (total - totalAnterior) / totalAnterior * 100` con 1 decimal; si `totalAnterior === 0` o no existe → null (es "nuevo").
- Prorrateo: por empleado, `horasPorContrato` = suma de horas **aprobadas** por contrato en la quincena; su `fila.total` se reparte proporcional. Si el empleado no tiene ninguna hora aprobada (mensualizado puro, por tantos sin registros) → todo su total al bucket `contratoId: null`.
- Redondeos monetarios a 2 decimales en el backend (`Math.round(x*100)/100`).
- La quincena anterior sale de `quincenaAnterior(anio, mes, quincena)` de `src/common/quincena.ts`; el histórico de `quincenasHaciaAtras(anio, mes, quincena, 8)`.

---

# Parte A — Backend

### Task B0: Rama
- [ ] `git checkout main; git pull; git checkout -b feature/analisis-quincena`. Incluir este plan (`docs/superpowers/plans/2026-08-12-analisis-quincena.md`, está sin commitear) en el primer commit.

### Task B1: `AnalisisService` con TDD

**Files:**
- Create: `src/liquidacion/analisis.service.ts`
- Create: `src/liquidacion/analisis.service.spec.ts`
- Modify: `src/liquidacion/liquidacion.module.ts` (provider + export si hace falta)

**Interfaces:**
- Consumes: `CalculoService#calcularQuincena(anio, mes, quincena)` (leer `calculo.service.ts:66-283` para el shape real de la fila: `{ cuil, apellidoNombre, regimen, total, totalBruto, montoHorasExtra, montoPresentismo, plus: {monto}[], noRemunerativo, horasCct, horasExtra, ... }`), `rangoQuincena`/`quincenaAnterior`/`quincenasHaciaAtras` de `../common/quincena`, `prisma.registroHoras` y `prisma.contrato`.
- Produces: `getAnalisis(anio, mes, quincena): Promise<AnalisisQuincena>` (contrato de datos de arriba).

- [ ] **Step 1: Spec que falla** — mockear `CalculoService` (un `{ calcularQuincena: jest.fn() }`) y prisma. Casos mínimos (leer un spec existente del módulo para el armado):

```ts
// helper del spec
const fila = (cuil: string, nombre: string, total: number, extras = {}) => ({
  cuil, apellidoNombre: nombre, regimen: 'jornalizado', total,
  totalBruto: total, montoHorasExtra: 0, montoPresentismo: 0, plus: [], noRemunerativo: 0,
  horasCct: 88, horasExtra: 0, ...extras,
});

it('totales, composición y variaciones contra la quincena anterior', async () => {
  calculoMock.calcularQuincena.mockImplementation((a: number, m: number, q: number) => {
    if (m === 8 && q === 1) return Promise.resolve([
      fila('20-1', 'PEREZ', 1100, { totalBruto: 800, montoHorasExtra: 200, montoPresentismo: 100 }),
      fila('20-2', 'GOMEZ', 500),   // nuevo: no está en la anterior
    ]);
    if (m === 7 && q === 2) return Promise.resolve([fila('20-1', 'PEREZ', 1000)]);
    return Promise.resolve([]);     // resto del histórico vacío
  });
  prismaMock.registroHoras.findMany.mockResolvedValue([]);   // días trabajados
  prismaMock.registroHoras.groupBy.mockResolvedValue([]);    // prorrateo
  prismaMock.contrato.findMany.mockResolvedValue([]);

  const r = await service.getAnalisis(2026, 8, 1);
  expect(r.totales).toMatchObject({ total: 1600, empleados: 2, empleadosNuevos: 1 });
  expect(r.anterior).toMatchObject({ total: 1000, empleados: 1 });
  expect(r.composicion).toEqual({ basico: 1300, extras: 200, presentismo: 100, plus: 0, bono: 0 });
  // PEREZ subió 10% → primero; GOMEZ es nuevo (delta null) → al final
  expect(r.variaciones[0]).toMatchObject({ cuil: '20-1', deltaPct: 10 });
  expect(r.variaciones[1]).toMatchObject({ cuil: '20-2', deltaPct: null });
  expect(r.historico).toHaveLength(8);
  expect(r.historico[7]).toMatchObject({ anio: 2026, mes: 8, quincena: 1, total: 1600 });
});

it('prorrateo por horas: reparte el total del empleado entre sus contratos y manda a los sin horas al bucket', async () => {
  calculoMock.calcularQuincena.mockImplementation((a: number, m: number, q: number) =>
    Promise.resolve(m === 8 && q === 1 ? [fila('20-1', 'PEREZ', 900), fila('20-3', 'MENSU', 300)] : []),
  );
  prismaMock.registroHoras.findMany.mockResolvedValue([]);
  // PEREZ: 60hs en contrato 1 y 30hs en contrato 2; MENSU sin horas
  prismaMock.registroHoras.groupBy.mockResolvedValue([
    { operarioCuil: '20-1', contratoId: 1, _sum: { horas: 60 } },
    { operarioCuil: '20-1', contratoId: 2, _sum: { horas: 30 } },
  ]);
  prismaMock.contrato.findMany.mockResolvedValue([
    { id: 1, codigo: 'K5', nombre: 'Gasnor K5' },
    { id: 2, codigo: 'K9', nombre: 'Gasnor K9' },
  ]);

  const r = await service.getAnalisis(2026, 8, 1);
  expect(r.contratos[0]).toMatchObject({ contratoId: 1, codigo: 'K5', monto: 600, horas: 60 });
  expect(r.contratos[1]).toMatchObject({ contratoId: 2, codigo: 'K9', monto: 300, horas: 30 });
  expect(r.contratos[2]).toMatchObject({ contratoId: null, codigo: 'Sin contrato asignable', monto: 300 });
  // el prorrateo cierra contra el total
  expect(r.contratos.reduce((s, c) => s + c.monto, 0)).toBe(1200);
});

it('días trabajados = días distintos con horas aprobadas', async () => {
  calculoMock.calcularQuincena.mockImplementation((a: number, m: number, q: number) =>
    Promise.resolve(m === 8 && q === 1 ? [fila('20-1', 'PEREZ', 100)] : []),
  );
  prismaMock.registroHoras.findMany.mockResolvedValue([
    { operarioCuil: '20-1', fecha: new Date(2026, 7, 3) },
    { operarioCuil: '20-1', fecha: new Date(2026, 7, 4) },
  ]);
  prismaMock.registroHoras.groupBy.mockResolvedValue([]);
  prismaMock.contrato.findMany.mockResolvedValue([]);
  const r = await service.getAnalisis(2026, 8, 1);
  expect(r.variaciones[0].diasTrabajados).toBe(2);
});
```

- [ ] **Step 2: FAIL** — `npx jest analisis.service`
- [ ] **Step 3: Implementar** `AnalisisService.getAnalisis`:
  1. `const filas = await this.calculo.calcularQuincena(anio, mes, quincena)`.
  2. `const ant = quincenaAnterior(anio, mes, quincena); const filasAnt = await this.calculo.calcularQuincena(ant.anio, ant.mes, ant.quincena)`.
  3. **Histórico**: `quincenasHaciaAtras(anio, mes, quincena, 8)`; para cada una que no sea la actual ni la anterior, correr el motor y sumar `total` (reusar los resultados ya calculados de actual/anterior para no correrlas dos veces). Nota de perf en comentario: el motor hace ~10 queries por quincena (prefetch masivo, §39) — 8 quincenas ≈ 80 queries, aceptable para una pantalla de análisis.
  4. **Días trabajados**: `findMany` de `registroHoras` con `where: { fecha: { gte: desde, lte: hasta }, estado: 'aprobado' }`, `select: { operarioCuil: true, fecha: true }`, `distinct: ['operarioCuil', 'fecha']` → contar por cuil en memoria.
  5. **Prorrateo**: `groupBy(['operarioCuil', 'contratoId'])` con `_sum.horas`, mismo where; armar `Map<cuil, {contratoId, horas}[]>`; repartir `fila.total`; acumular por contrato; resolver codigo/nombre con `prisma.contrato.findMany({ where: { id: { in: [...] } } })`; bucket `null` al final.
  6. **Composición**: sumar `totalBruto`, `montoHorasExtra`, `montoPresentismo`, `plus.reduce(...)`, `noRemunerativo` de las filas.
  7. Variaciones y topCobradores según el contrato de datos (top 10 = mismas variaciones ordenadas por `total` desc, cortadas).
- [ ] **Step 4: PASS** + `npx nest build` (si falla por cliente Prisma viejo: `npx prisma generate`).
- [ ] **Step 5: Commit** — `feat(liquidacion): motor de analisis de la quincena (AnalisisService)`

### Task B2: Endpoint

**Files:**
- Modify: `src/liquidacion/liquidacion.controller.ts` (inyectar `AnalisisService`, agregar handler junto a los de quincena)

```ts
@Get('analisis')
getAnalisis(
  @Query('anio', ParseIntPipe) anio: number,
  @Query('mes', ParseIntPipe) mes: number,
  @Query('quincena', ParseIntPipe) quincena: number,
) {
  return this.analisis.getAnalisis(anio, mes, quincena);
}
```

- [ ] Roles: NO agregar decorador propio — hereda `@Roles('Admin', 'Liquidador')` del controller, que es lo decidido.
- [ ] **Verificar** build + spec completo del módulo (`npx jest liquidacion`) y **Commit** — `feat(liquidacion): endpoint GET /liquidacion/analisis`

---

# Parte B — Frontend

### Task F0: Rama
- [ ] `git checkout main; git pull; git checkout -b feature/analisis-quincena`

### Task F1: Tipos + hook

**Files:**
- Modify: `src/lib/api/liquidacion.ts`

- [ ] Copiar la interface `AnalisisQuincena` EXACTA del contrato de datos + hook `useAnalisisQuincena(anio, mes, quincena)` con `queryKey: ['liquidacion', 'analisis', anio, mes, quincena]`, siguiendo el patrón de los hooks vecinos del archivo. Verificar `npx tsc --noEmit`. Commit — `feat(liquidacion): hook de analisis de quincena`.

### Task F2: Tokens + componentes de gráficos

**Files:**
- Modify: `src/app/globals.css` (junto a `--color-chart-1/2`): `--color-chart-3: #1f8a70; --color-chart-4: #7d5bc6; --color-chart-5: #b3543e;`
- Create: `src/features/liquidacion/analisis/colores.ts` — exporta las 5 constantes HEX con nombres (`COLOR_BASICO = '#a97a16'`, `COLOR_EXTRAS = '#3b6fc4'`, `COLOR_PRESENTISMO = '#1f8a70'`, `COLOR_PLUS = '#7d5bc6'`, `COLOR_BONO = '#b3543e'`) y `fmtMoneda(n: number, decimales = 0)` (es-AR, ARS).
- Create: `src/features/liquidacion/analisis/composicion-pago.tsx` — UNA barra horizontal apilada (Recharts `BarChart layout="vertical"` con un solo dato y 5 `<Bar stackId>`), leyenda con los 5 componentes y su $ y %, tooltip con formato moneda. Los segmentos con `stroke="#fff" strokeWidth={2}` (el gap de 2px que exige dataviz entre segmentos apilados).
- Create: `src/features/liquidacion/analisis/top-cobradores.tsx` — barras horizontales (patrón visual de `ranking-operarios.tsx` de control-general, mismo alto por fila) con el nombre, `fmtMoneda(total)` al final de la barra, y un chip de delta: `▲ +12.3%` en `text-danger` si sube fuerte (>25%), `text-warn` si sube, `text-slate` si baja, `(nuevo)` en itálica si `deltaPct === null`. Tooltip: días trabajados y total anterior.
- Create: `src/features/liquidacion/analisis/contratos-chart.tsx` — barras horizontales por contrato (monto) + mini tabla al pie (código, nombre, $, horas, % del total). El bucket "Sin contrato asignable" en gris (`text-slate`).
- Create: `src/features/liquidacion/analisis/historico-chart.tsx` — barras verticales de total por quincena (etiqueta `1ª ago`/`2ª ago`), color `--color-chart-1`, la quincena seleccionada resaltada (opacity 1 vs 0.55 el resto), tooltip con moneda.
- Test: `src/features/liquidacion/analisis/analisis-charts.test.tsx` — patrón EXACTO de `src/features/control-general/charts.test.tsx` (mock de `ResponsiveContainer` con `cloneElement` a 800×400): composición renderiza 5 leyendas; top-cobradores muestra nombres, deltas y "(nuevo)"; contratos muestra el bucket; histórico renderiza 8 etiquetas. ⚠️ Si el archivo se CUELGA en vitest (>120s): matar, partir en tests por componente en archivos separados, y si persiste, testear solo `colores.ts`/lógica pura y documentar en el commit (limitación §52).

- [ ] TDD: tests primero (rojo por módulos inexistentes), implementar, verde por archivo + tsc. Commit — `feat(liquidacion): graficos del analisis de quincena`.

### Task F3: Página + navegación

**Files:**
- Create: `src/app/(protected)/liquidacion/analisis/page.tsx`
- Modify: `src/features/liquidacion/liquidacion-nav.ts` — agregar `{ label: 'Análisis', href: '/liquidacion/analisis' }` al final.
- Test: `src/app/(protected)/liquidacion/analisis/analisis-page.test.tsx` (mock del hook, patrón del test de página de control-general; mismas advertencias de cuelgue)

Estructura de la página (de arriba a abajo, layout con las cards estándar `rounded-xl border border-line bg-surface p-4`):
1. `PageHeader eyebrow="Liquidación" title="Análisis de la quincena"` + selector año/mes/quincena (usar el mismo trío `FiltroSelect`/`FiltroNumero` que usa `sueldos-mensualizados-tab.tsx`, más el selector de quincena 1ª/2ª — arrancar en la quincena ANTERIOR a la actual, la última cerrada, como hace control-general).
2. Fila de 4 stat tiles (patrón `StatTile` de control-general, no clickeables): **Total de la quincena** (`fmtMoneda`) con sub-línea `▲/▼ X% vs quincena anterior` (verde `text-approved` si baja, rojo `text-danger` si sube — acá subir es costo — y "—" si `anterior === null`); **Empleados liquidados** con sub-línea "N nuevos"; **Horas pagadas** `CCT + extra` con las extra en `text-warn`; **Costo promedio por empleado** con su Δ%.
3. Grid `lg:grid-cols-2`: card "Composición del pago" + card "Histórico (últimas 8 quincenas)".
4. Grid `lg:grid-cols-2`: card "Top 10 cobradores" + card "$ por contrato (prorrateo por horas)".
5. Card "Variaciones por persona": buscador por nombre (input simple, filtro client-side), tabla Empleado · Régimen · Total · Total anterior · Δ$ · Δ% · Días — orden ya viene del backend; los "(nuevo)" con la etiqueta itálica. Δ% con el mismo código de color del top.
6. Estados: `isLoading` → "Cargando…"; sin filas (`totales.empleados === 0`) → empty state "Sin liquidación calculada para esta quincena.".

- [ ] TDD sobre la página (mock del hook con un `AnalisisQuincena` completo de fixture): tiles con valores formateados, orden de secciones, buscador filtra la tabla, empty state. Implementar. Verde + tsc. Commit — `feat(liquidacion): pagina de analisis de la quincena`.

---

## Self-review (hecho al escribir)

- Cobertura vs diseño acordado: tiles (total+Δ, empleados+nuevos, horas CCT/extra, costo promedio+Δ) ✔; composición ✔; top 10 con Δ personal, "(nuevo)" y días ✔; contratos con prorrateo + bucket + % ✔ (Q3); histórico 8 quincenas ✔; tabla de variaciones ordenada por |Δ%| ✔; en vivo sin snapshots ✔ (Q2); ubicación/roles ✔ (Q1).
- Tipos: `AnalisisQuincena` idéntico en contrato, B1 y F1 ✔; nombres de campos de fila del motor verificados contra `calculo.service.ts:257-279` ✔ (`apellidoNombre`, `totalBruto`, `montoHorasExtra`, `montoPresentismo`, `plus[].monto`, `noRemunerativo`, `horasCct`, `horasExtra`, `total`, `regimen`).
- Paleta validada con `validate_palette.js` (6 checks PASS sobre `#ffffff`); tritan bajo mitigado con gaps de 2px + leyenda + labels (secondary encoding, permitido).
- Sin placeholders: cada task tiene código o referencia a archivo/patrón concreto a leer.

---

# ADDENDUM (grilling 2026-08-12, segunda ronda): Contratos de imputación

**Decisiones**: los perfiles con régimen `mensualizado`, `fijo` o `por_tantos` pueden tener
**contratos de imputación** (0..N, tabla M:N). En el **corte por contrato del análisis**, si
el empleado es de uno de esos 3 regímenes y tiene asignación, su costo va a esos contratos en
**partes iguales** y **sus horas se ignoran para el corte** (la asignación manda siempre).
Sin asignación → bucket "Sin contrato asignable", como hoy. Los demás regímenes nunca usan
imputación (prorrateo por horas real). Se edita en `/liquidacion/perfiles` (Admin/Liquidador),
selector visible solo para esos 3 regímenes; si cambia el régimen, las asignaciones se
conservan pero dejan de usarse (y la UI las oculta). DDL **solo a `testing`**.

## Contrato de datos (addendum)

```ts
// GET /liquidacion/perfiles — cada perfil suma:
//   contratosImputacionIds: number[]
// POST /liquidacion/perfiles/:cuil — el body acepta (opcional):
//   contratosImputacionIds?: number[]   // reemplaza el set completo; ausente = no tocar
// GET /liquidacion/contratos — NUEVO (hereda Admin+Liquidador): { id, codigo, nombre }[] activos, orden codigo asc
//   (el Liquidador no puede usar /admin/contratos ni /registros-horas/mis-contratos)
```

### Task C1 (Backend): schema + DDL

- Prisma: `model PerfilContratoImputacion { cuil String @db.Char(13) @map("cuil"); contratoId Int @map("contrato_id"); perfil PerfilLiquidacion @relation(fields: [cuil], references: [cuil]); contrato Contrato @relation(fields: [contratoId], references: [id]); @@id([cuil, contratoId]) @@map("sth_perfil_contratos_imputacion") }` + relación inversa `contratosImputacion PerfilContratoImputacion[]` en `PerfilLiquidacion` y `Contrato`.
- DDL nuevo `docs/sql/2026-08-12-perfil-contratos-imputacion.sql` (CREATE TABLE con FKs, PK compuesta). Aplicar con `prisma db execute` SOLO a testing (verificar `.env` → `/testing`) + `npx prisma generate`.
- Commit: `feat(liquidacion): schema de contratos de imputacion + DDL`

### Task C2 (Backend): perfiles + contratos (TDD)

- `getPerfiles`: include `contratosImputacion` → mapear a `contratosImputacionIds: number[]` (leer el shape actual del método y NO romper los campos existentes).
- `upsertPerfil` (y `upsertPerfilesMasivo` NO — masivo no toca imputación): si `dto.contratosImputacionIds !== undefined`, reemplazo total (deleteMany + createMany) en la misma transacción/secuencia del upsert.
- DTO: `@IsOptional() @IsArray() @IsInt({ each: true }) contratosImputacionIds?: number[]` en `UpsertPerfilLiquidacionDto`.
- `GET /liquidacion/contratos` en el controller → `prisma.contrato.findMany({ where: { activo: true }, select: { id, codigo, nombre }, orderBy: { codigo: 'asc' } })` (método nuevo en liquidacion.service).
- Spec (`liquidacion.service.spec.ts`): upsert reemplaza el set; getPerfiles devuelve los ids.
- Commit: `feat(liquidacion): contratos de imputacion en perfiles + listado de contratos`

### Task C3 (Backend): el análisis respeta la imputación (TDD)

En `AnalisisService.getAnalisis`, ANTES del prorrateo: traer `perfilContratoImputacion.findMany({ where: { cuil: { in: cuils de filas } } })`. Para cada fila con `regimen ∈ {mensualizado, fijo, por_tantos}` **y** asignaciones: repartir `fila.total` en partes iguales entre sus contratos asignados (acumular monto; **horas 0** — las horas reales de esa persona NO suman al corte). El resto sigue igual (prorrateo por horas / bucket).

Spec nuevo en `analisis.service.spec.ts`:
```ts
it('mensualizado con imputación multi-contrato: partes iguales, ignora sus horas', async () => {
  // fila MENSU total 300 regimen 'mensualizado' + imputación a contratos 1 y 2
  // groupBy devuelve horas de MENSU en contrato 3 (deben ignorarse para el corte)
  // → contrato 1: 150, contrato 2: 150, contrato 3: 0 de MENSU; sin bucket
});
it('por_tantos sin imputación sigue en el bucket', ...);
```
- Commit: `feat(liquidacion): el corte por contrato respeta los contratos de imputacion`

### Task C4 (Frontend): perfiles UI

- `src/lib/api/liquidacion.ts`: `contratosImputacionIds: number[]` en el tipo de perfil; el mutation de upsert acepta el campo; hook nuevo `useContratosLiquidacion()` → `GET /liquidacion/contratos`.
- `/liquidacion/perfiles`: leer la página y su fila de edición ANTES de tocar. Agregar, SOLO cuando el régimen elegido es mensualizado/fijo/por_tantos, un selector múltiple de contratos ("Contratos de imputación (análisis)") — usar el patrón de multi-select que ya exista en esa pantalla (hay MultiFiltro estándar en el repo); hint corto: "El costo de este empleado se imputa a estos contratos en partes iguales en el Análisis". Guardar manda `contratosImputacionIds`.
- Tests del archivo de la página de perfiles (extender los existentes): visible para mensualizado, oculto para jornalizado, guarda los ids.
- Commit: `feat(liquidacion): asignacion de contratos de imputacion en perfiles`

### Task C5 (Frontend): nota en el análisis

- En `contratos-chart.tsx`, actualizar el subtítulo/hint del bucket: "Sin contrato asignable: empleados sin horas aprobadas ni contratos de imputación asignados (se asignan en Perfiles)." Test de texto si el archivo de tests lo cubre.
- Commit: `feat(liquidacion): hint de imputacion en el corte por contrato`

