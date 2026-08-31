# Cierre de liquidación quincenal + export Excel + bono quincenal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir cierres versionados de la liquidación quincenal (snapshot puro), exportar el Excel oficial para el liquidador de sueldos + export aparte de por tantos en B, y pasar el bono no remunerativo de mensual a quincenal.

**Architecture:** Tres tablas de hechos desnormalizadas (`sth_cierres_liquidacion` cabecera versionada, `_detalle` una fila congelada por empleado, `_dias_trabajados`). El cierre corre el motor existente (`CalculoService.calcularQuincena`) y persiste el resultado en una transacción; el Excel (exceljs) se genera SOLO desde un cierre. El bono gana columna `quincena` con backfill.

**Tech Stack:** NestJS 11 + Prisma 7 (adapter mariadb) + exceljs (nuevo). Frontend Next.js App Router + TanStack Query + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-30-cierre-liquidacion-export-design.md` (leer ANTES; decisiones de fondo en `docs/adr/2026-08-30-adr-021-cierre-liquidacion-versionado.md`)

## Global Constraints

- ⚠️ BD compartida: DDL SOLO a mano vía `npx prisma db execute --file docs/sql/<archivo>.sql`. JAMÁS `prisma migrate` ni `db push`. En desarrollo se aplica a `testing`; a `Horas_Sertec` recién en el deploy.
- Columnas `cuil` nuevas: `CHAR(13)` con collation `utf8mb3_general_ci` (igual que el resto de las tablas `sth_`).
- Transacciones Prisma con `{ timeout: 30000, maxWait: 10000 }` (BD remota lenta, patrón del repo).
- Zona: NORTE = SALTA + JUJUY; SUR = TUCUMAN; otro/vacío = null (sin zona, alerta — nunca default).
- Tests backend: jest (`npm test`). Frontend: vitest POR ARCHIVO (`npx vitest run <archivo>`) — la suite completa cuelga en esta máquina. `tsc --noEmit` en ambos.
- Repos: Backend `Forms_Horas_ST_back`, Frontend `Forms_Horas_ST_Frontend`. Rama `feature/cierre-liquidacion` en ambos, desde `main`.

---

### Task 1: DDL + schema Prisma (tablas de cierre + bono quincenal)

**Files:**
- Create: `docs/sql/2026-08-30-cierres-liquidacion.sql`
- Create: `docs/sql/2026-08-30-bono-quincenal.sql`
- Modify: `prisma/schema.prisma` (3 modelos + enum + `BonoNoRemunerativo.quincena` + relación en `Usuario`)

**Interfaces:**
- Produces: modelos Prisma `CierreLiquidacion`, `CierreLiquidacionDetalle`, `CierreDiaTrabajado`, enum `ZonaLiquidacion`; `BonoNoRemunerativo.quincena: number`; unique compuesto `categoriaUocraId_vigenteDesde_quincena`.

- [ ] **Step 1: Escribir `docs/sql/2026-08-30-cierres-liquidacion.sql`**

```sql
-- ADR-021: tablas de hechos del cierre de liquidación. Aplicar A MANO en
-- testing y Horas_Sertec (NUNCA prisma migrate).
CREATE TABLE sth_cierres_liquidacion (
  id INT NOT NULL AUTO_INCREMENT,
  anio INT NOT NULL,
  mes INT NOT NULL,
  quincena INT NOT NULL,
  version INT NOT NULL,
  cerrado_por_cuil CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  nota VARCHAR(300) NULL,
  salvedades TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY sth_cierres_liquidacion_periodo_version_key (anio, mes, quincena, version),
  CONSTRAINT sth_cierres_liquidacion_cerrado_por_fkey
    FOREIGN KEY (cerrado_por_cuil) REFERENCES sth_usuarios (cuil)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE sth_cierre_liquidacion_detalle (
  id INT NOT NULL AUTO_INCREMENT,
  cierre_id INT NOT NULL,
  cuil CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  apellido_nombre VARCHAR(70) NOT NULL,
  legajo INT NULL,
  provincia VARCHAR(35) NULL,
  localidad VARCHAR(35) NULL,
  zona ENUM('norte','sur') NULL,
  regimen VARCHAR(20) NOT NULL,
  categoria VARCHAR(30) NULL,
  modalidad_pago VARCHAR(20) NULL,
  tiene_presentismo TINYINT(1) NOT NULL,
  precio_bruto DECIMAL(14,2) NULL,
  horas_total DECIMAL(14,2) NULL,
  horas_cct DECIMAL(14,2) NULL,
  horas_extra DECIMAL(14,2) NULL,
  total_bruto DECIMAL(14,2) NOT NULL,
  monto_horas_extra DECIMAL(14,2) NOT NULL,
  monto_presentismo DECIMAL(14,2) NOT NULL,
  no_remunerativo DECIMAL(14,2) NOT NULL,
  monto_guardias DECIMAL(14,2) NOT NULL,
  monto_productividad DECIMAL(14,2) NOT NULL,
  plus_individual DECIMAL(14,2) NOT NULL,
  km_total DECIMAL(14,2) NULL,
  monto_km_bruto DECIMAL(14,2) NULL,
  monto_a DECIMAL(14,2) NULL,
  monto_b DECIMAL(14,2) NULL,
  novedades_texto VARCHAR(500) NULL,
  salvedad VARCHAR(300) NULL,
  total DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY sth_cierre_detalle_cierre_cuil_key (cierre_id, cuil),
  KEY sth_cierre_detalle_cuil_idx (cuil),
  CONSTRAINT sth_cierre_detalle_cierre_fkey
    FOREIGN KEY (cierre_id) REFERENCES sth_cierres_liquidacion (id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE sth_cierre_dias_trabajados (
  id INT NOT NULL AUTO_INCREMENT,
  cierre_id INT NOT NULL,
  cuil CHAR(13) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL,
  apellido_nombre VARCHAR(70) NOT NULL,
  legajo INT NULL,
  fecha DATE NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY sth_cierre_dias_cierre_cuil_fecha_key (cierre_id, cuil, fecha),
  CONSTRAINT sth_cierre_dias_cierre_fkey
    FOREIGN KEY (cierre_id) REFERENCES sth_cierres_liquidacion (id)
) DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 2: Escribir `docs/sql/2026-08-30-bono-quincenal.sql`** (columna + backfill + unique nuevo, en este orden)

```sql
-- ADR-021 §6: bono no remunerativo por QUINCENA. Backfill: la fila mensual
-- existente queda como 1Q y se duplica en 2Q (el motor pagaba el bono
-- completo en ambas quincenas — esto es fiel a lo ya liquidado).
ALTER TABLE sth_bonos_no_remunerativos ADD COLUMN quincena TINYINT NOT NULL DEFAULT 1;
INSERT INTO sth_bonos_no_remunerativos (categoria_uocra_id, vigente_desde, tipo, valor, quincena)
  SELECT categoria_uocra_id, vigente_desde, tipo, valor, 2
  FROM sth_bonos_no_remunerativos WHERE quincena = 1;
ALTER TABLE sth_bonos_no_remunerativos
  DROP INDEX sth_bonos_no_remunerativos_categoria_uocra_id_vigente_desde_key,
  ADD UNIQUE KEY sth_bonos_categoria_vigente_quincena_key (categoria_uocra_id, vigente_desde, quincena);
ALTER TABLE sth_bonos_no_remunerativos ALTER COLUMN quincena DROP DEFAULT;
```

Nota: verificar ANTES el nombre real del unique viejo con `SHOW INDEX FROM sth_bonos_no_remunerativos` (vía script node de solo lectura, patrón §65 del contexto) y ajustar el `DROP INDEX` si difiere.

- [ ] **Step 3: `prisma/schema.prisma`** — agregar al final de la sección de liquidación (antes de `// TRANSACCIONALES`):

```prisma
enum ZonaLiquidacion {
  norte
  sur
}

// ADR-021: cabecera del cierre de liquidación. Snapshot versionado puro —
// NO bloquea nada. "Vigente" = MAX(version) del período, derivado.
model CierreLiquidacion {
  id             Int      @id @default(autoincrement())
  anio           Int
  mes            Int
  quincena       Int
  version        Int
  cerradoPorCuil String   @map("cerrado_por_cuil") @db.Char(13)
  nota           String?  @db.VarChar(300)
  salvedades     String?  @db.Text
  createdAt      DateTime @default(now()) @map("created_at")

  cerradoPor     Usuario                    @relation(fields: [cerradoPorCuil], references: [cuil])
  detalle        CierreLiquidacionDetalle[]
  diasTrabajados CierreDiaTrabajado[]

  @@unique([anio, mes, quincena, version])
  @@map("sth_cierres_liquidacion")
}

// ADR-021: hechos del cierre — TODO congelado (números/texto copiados al
// cerrar). `cuil` NO es FK navegable a propósito: la foto sobrevive a
// cualquier cambio en los datos vivos.
model CierreLiquidacionDetalle {
  id                 Int              @id @default(autoincrement())
  cierreId           Int              @map("cierre_id")
  cuil               String           @db.Char(13)
  apellidoNombre     String           @map("apellido_nombre") @db.VarChar(70)
  legajo             Int?
  provincia          String?          @db.VarChar(35)
  localidad          String?          @db.VarChar(35)
  zona               ZonaLiquidacion?
  regimen            String           @db.VarChar(20)
  categoria          String?          @db.VarChar(30)
  modalidadPago      String?          @map("modalidad_pago") @db.VarChar(20)
  tienePresentismo   Boolean          @map("tiene_presentismo")
  precioBruto        Decimal?         @map("precio_bruto") @db.Decimal(14, 2)
  horasTotal         Decimal?         @map("horas_total") @db.Decimal(14, 2)
  horasCct           Decimal?         @map("horas_cct") @db.Decimal(14, 2)
  horasExtra         Decimal?         @map("horas_extra") @db.Decimal(14, 2)
  totalBruto         Decimal          @map("total_bruto") @db.Decimal(14, 2)
  montoHorasExtra    Decimal          @map("monto_horas_extra") @db.Decimal(14, 2)
  montoPresentismo   Decimal          @map("monto_presentismo") @db.Decimal(14, 2)
  noRemunerativo     Decimal          @map("no_remunerativo") @db.Decimal(14, 2)
  montoGuardias      Decimal          @map("monto_guardias") @db.Decimal(14, 2)
  montoProductividad Decimal          @map("monto_productividad") @db.Decimal(14, 2)
  plusIndividual     Decimal          @map("plus_individual") @db.Decimal(14, 2)
  kmTotal            Decimal?         @map("km_total") @db.Decimal(14, 2)
  montoKmBruto       Decimal?         @map("monto_km_bruto") @db.Decimal(14, 2)
  montoA             Decimal?         @map("monto_a") @db.Decimal(14, 2)
  montoB             Decimal?         @map("monto_b") @db.Decimal(14, 2)
  novedadesTexto     String?          @map("novedades_texto") @db.VarChar(500)
  salvedad           String?          @db.VarChar(300)
  total              Decimal          @db.Decimal(14, 2)

  cierre CierreLiquidacion @relation(fields: [cierreId], references: [id])

  @@unique([cierreId, cuil])
  @@index([cuil])
  @@map("sth_cierre_liquidacion_detalle")
}

// ADR-021: días trabajados congelados del período del cierre (un día cuenta
// si el empleado tiene ≥1 registro NO desaprobado esa fecha). Alimenta la
// hoja DIAS TRABAJADOS del Excel (transitoria, para feriados).
model CierreDiaTrabajado {
  id             Int      @id @default(autoincrement())
  cierreId       Int      @map("cierre_id")
  cuil           String   @db.Char(13)
  apellidoNombre String   @map("apellido_nombre") @db.VarChar(70)
  legajo         Int?
  fecha          DateTime @db.Date

  cierre CierreLiquidacion @relation(fields: [cierreId], references: [id])

  @@unique([cierreId, cuil, fecha])
  @@map("sth_cierre_dias_trabajados")
}
```

En `BonoNoRemunerativo`: agregar `quincena Int` después de `vigenteDesde`, y cambiar `@@unique([categoriaUocraId, vigenteDesde])` por `@@unique([categoriaUocraId, vigenteDesde, quincena])`. En `Usuario`: agregar la relación inversa `cierresLiquidacion CierreLiquidacion[]`.

- [ ] **Step 4: Aplicar DDL a `testing` y regenerar el cliente**

```bash
npx prisma db execute --file docs/sql/2026-08-30-cierres-liquidacion.sql
# ver nota del Step 2 antes de correr el de bonos:
npx prisma db execute --file docs/sql/2026-08-30-bono-quincenal.sql
npx prisma generate
npm run build
```
Expected: build limpio.

- [ ] **Step 5: Commit** — `git add docs/sql prisma && git commit -m "feat(liquidacion): schema de cierres versionados + bono quincenal (ADR-021)"`

---

### Task 2: Bono quincenal — backend (service + calculo + controller)

**Files:**
- Modify: `src/liquidacion/liquidacion.service.ts:147-190` (`getBonosPeriodo`/`guardarBonosPeriodo`)
- Modify: `src/liquidacion/calculo.service.ts:92` (lookup del bono)
- Modify: `src/liquidacion/liquidacion.controller.ts:80-93` (rutas con `/:quincena`)
- Test: `src/liquidacion/liquidacion.service.spec.ts`, `src/liquidacion/calculo.service.spec.ts`

**Interfaces:**
- Produces: `getBonosPeriodo(anio, mes, quincena)`, `guardarBonosPeriodo(anio, mes, quincena, dto, usuarioCuil)`; rutas `GET/PUT /liquidacion/tarifas/bonos/:anio/:mes/:quincena`. `BonosPeriodoDto` NO cambia.

- [ ] **Step 1: Tests que fallan primero.** En `calculo.service.spec.ts`, ubicar el caso existente del bono (mock de `bonoNoRemunerativo.findMany`) y agregar:

```ts
it('el bono se busca por quincena exacta: bono de 1Q no aplica en 2Q', async () => {
  // mismo arrange que el caso de bono existente, pero:
  prisma.bonoNoRemunerativo.findMany.mockImplementation(({ where }) =>
    Promise.resolve(where.quincena === 1
      ? [{ categoriaUocraId: 1, tipo: 'monto_fijo', valor: 15000, quincena: 1 }]
      : []),
  );
  const q2 = await service.calcularQuincena(2026, 9, 2);
  expect(q2[0].noRemunerativo).toBe(0); // 2Q sin bono resuelto: no arrastra la 1Q
});
```

En `liquidacion.service.spec.ts`, ajustar los casos de `getBonosPeriodo`/`guardarBonosPeriodo` a la firma nueva (pasar `quincena` y esperar el `where` con quincena; el unique compuesto pasa a `categoriaUocraId_vigenteDesde_quincena`). Correr: fallan.

- [ ] **Step 2: Implementar.** `calculo.service.ts:92`:

```ts
this.prisma.bonoNoRemunerativo.findMany({ where: { vigenteDesde: fechaVigencia, quincena } }),
```

`liquidacion.service.ts`: las dos firmas ganan `quincena: number`; en `getBonosPeriodo` el filtro `resuelto` compara también quincena (`b.quincena === quincena`) y `ultimoAnterior` considera períodos anteriores incluyendo la otra quincena del mismo mes (ordenar por `(vigenteDesde, quincena)`); en `guardarBonosPeriodo` el `findUnique` usa `categoriaUocraId_vigenteDesde_quincena: { categoriaUocraId, vigenteDesde: fecha, quincena }` y el `create` incluye `quincena`. Controller:

```ts
@Get('tarifas/bonos/:anio/:mes/:quincena')
getBonosPeriodo(@Param('anio', ParseIntPipe) anio: number, @Param('mes', ParseIntPipe) mes: number, @Param('quincena', ParseIntPipe) quincena: number) {
  return this.service.getBonosPeriodo(anio, mes, quincena);
}
// ídem @Put con @Body() dto: BonosPeriodoDto y @Request() req
```

- [ ] **Step 3: Correr `npm test` → verde. Commit** `feat(liquidacion): bono no remunerativo por quincena (ADR-021 §6)`

---

### Task 3: Helper de zona

**Files:**
- Create: `src/common/zona.ts` — Test: `src/common/zona.spec.ts`

**Interfaces:**
- Produces: `type Zona = 'norte' | 'sur'`; `zonaDeProvincia(provincia: string | null | undefined): Zona | null`.

- [ ] **Step 1: Test que falla**

```ts
import { zonaDeProvincia } from './zona';
describe('zonaDeProvincia', () => {
  it.each([['SALTA', 'norte'], ['JUJUY', 'norte'], ['TUCUMAN', 'sur'], ['  salta ', 'norte']])('%s → %s', (p, z) => expect(zonaDeProvincia(p)).toBe(z));
  it.each([[''], ['   '], ['SGO DEL ESTERO'], [null], [undefined]])('sin zona: %s → null', (p) => expect(zonaDeProvincia(p as never)).toBeNull());
});
```

- [ ] **Step 2: Implementación**

```ts
// ADR-021 §4: NORTE = Salta + Jujuy, SUR = Tucumán (la hoja del Excel se
// llama "TUCUMAN"). Cualquier otro valor (o vacío) = sin zona — alerta,
// nunca una zona por default.
export type Zona = 'norte' | 'sur';
export function zonaDeProvincia(provincia: string | null | undefined): Zona | null {
  const p = (provincia ?? '').trim().toUpperCase();
  if (p === 'SALTA' || p === 'JUJUY') return 'norte';
  if (p === 'TUCUMAN') return 'sur';
  return null;
}
```

- [ ] **Step 3: Verde + commit** `feat(common): zonaDeProvincia (NORTE/SUR, ADR-021)`

---

### Task 4: CierresService — crear cierre (snapshot transaccional)

**Files:**
- Create: `src/liquidacion/cierres.service.ts` — Test: `src/liquidacion/cierres.service.spec.ts`
- Modify: `src/liquidacion/liquidacion.module.ts` (provider nuevo)

**Interfaces:**
- Consumes: `CalculoService.calcularQuincena` (shape de fila en `calculo.service.ts:297-321`: cuil, apellidoNombre, legajo, categoria, regimen, provincia, modalidadPago, precioBruto, montoKmBruto, horasTotal, horasCct, totalBruto, horasExtra, montoHorasExtra, tienePresentismo, montoPresentismo, plus[{nombre, monto?}...], noRemunerativo, plusIndividual, novedadesTexto, total, datoFaltante), `CalculoService.getAlertasQuincena`, `zonaDeProvincia`.
- Produces: `crearCierre(anio, mes, quincena, nota: string | undefined, usuarioCuil: string)` → cabecera creada (lanza `BadRequestException` si ya hay versión previa y falta nota).

- [ ] **Step 1: Tests que fallan** (mock de PrismaService + CalculoService, patrón de `panel.service.spec.ts`)

```ts
it('primer cierre: crea version 1 con detalle congelado y zona derivada', async () => {
  calculo.calcularQuincena.mockResolvedValue([filaJornalizadaSalta()]); // provincia 'SALTA'
  calculo.getAlertasQuincena.mockResolvedValue({ sinPerfil: [], perfilesIncompletos: [], jornalizadosSinHoras: [] });
  prisma.cierreLiquidacion.aggregate.mockResolvedValue({ _max: { version: null } });
  await service.crearCierre(2026, 9, 1, undefined, CUIL_LIQUIDADOR);
  const data = prisma.cierreLiquidacion.create.mock.calls[0][0].data;
  expect(data.version).toBe(1);
  expect(data.detalle.create[0].zona).toBe('norte');
});
it('recierre sin nota → BadRequestException', async () => {
  prisma.cierreLiquidacion.aggregate.mockResolvedValue({ _max: { version: 1 } });
  await expect(service.crearCierre(2026, 9, 1, undefined, CUIL)).rejects.toThrow(BadRequestException);
});
it('empleado sin zona queda con zona null y salvedad en cabecera', ...);
it('fila por_tantos congela km/montoKm/montoA/montoB', ...); // montoA = totalBruto + presentismo + noRemunerativo; montoB = montoHorasExtra
it('montoGuardias suma plus cuyo tipo contiene "guardia"; el resto va a montoProductividad', ...);
```

- [ ] **Step 2: Implementación** (esqueleto — el implementador completa el mapeo campo a campo respetando el shape de arriba):

```ts
@Injectable()
export class CierresService {
  constructor(private prisma: PrismaService, private calculo: CalculoService) {}

  async crearCierre(anio: number, mes: number, quincena: number, nota: string | undefined, usuarioCuil: string) {
    const { _max } = await this.prisma.cierreLiquidacion.aggregate({
      where: { anio, mes, quincena }, _max: { version: true },
    });
    const version = (_max.version ?? 0) + 1;
    if (version > 1 && !nota?.trim())
      throw new BadRequestException('Un recierre necesita una nota que explique el motivo.');

    const [filas, alertas] = await Promise.all([
      this.calculo.calcularQuincena(anio, mes, quincena),
      this.calculo.getAlertasQuincena(anio, mes, quincena),
    ]);
    // Días trabajados del rango: ≥1 registro NO desaprobado por (cuil, fecha)
    const { desde, hasta } = rangoQuincena(anio, mes, quincena);
    const dias = await this.prisma.registroHoras.groupBy({
      by: ['operarioCuil', 'fecha'],
      where: { fecha: { gte: desde, lte: hasta }, estado: { not: 'desaprobado' } },
    });
    const salvedades = this.armarSalvedades(filas, alertas); // string[]
    // detalle: por fila → zona = zonaDeProvincia(fila.provincia); localidad
    // se lee de snuempleados (findMany cuil in) y se congela junto a provincia;
    // montoGuardias/montoProductividad = partición de fila.plus por nombre
    // (incluye 'guardia' → guardias; resto → productividad);
    // por_tantos: kmTotal (de kmPorTantos del período), montoKmBruto,
    // montoA = totalBruto + montoPresentismo + noRemunerativo, montoB = montoHorasExtra.
    return this.prisma.cierreLiquidacion.create({
      data: {
        anio, mes, quincena, version, cerradoPorCuil: usuarioCuil,
        nota: nota?.trim() || null,
        salvedades: salvedades.length ? JSON.stringify(salvedades) : null,
        detalle: { create: filas.map((f) => this.aFilaCongelada(f)) },
        diasTrabajados: { create: dias.map((d) => ({ cuil: d.operarioCuil, fecha: d.fecha, apellidoNombre: ..., legajo: ... })) },
      },
    });
  }
}
```

Registrar `CierresService` en `liquidacion.module.ts` (providers).

- [ ] **Step 3: Verde + commit** `feat(liquidacion): CierresService.crearCierre — snapshot versionado (ADR-021)`

---

### Task 5: Listado, detalle y endpoints de cierres

**Files:**
- Modify: `src/liquidacion/cierres.service.ts` (+ `listar()`, `detalle(id)`)
- Modify: `src/liquidacion/liquidacion.controller.ts` (3 rutas nuevas)
- Test: `src/liquidacion/cierres.service.spec.ts`

**Interfaces:**
- Produces: `GET /liquidacion/cierres` → `[{ id, anio, mes, quincena, version, cerradoPor: { cuil, nombre }, nota, salvedades: string[], createdAt, totales: { total, norte, sur, sinZona, empleados } }]` (orden: período desc, version desc); `GET /liquidacion/cierres/:id` → cabecera + `detalle[]` completo (404 si no existe); `POST /liquidacion/cierres` body `{ anio, mes, quincena, nota? }` (DTO nuevo `CrearCierreDto` en `dto/liquidacion.dto.ts` con `@IsInt()` los tres y `@IsOptional() @IsString() @MaxLength(300)` nota).

- [ ] **Step 1: Tests que fallan** — `listar()` agrega totales sumando el detalle por zona (una sola query con `include: { detalle: { select: { zona: true, total: true } } }` + reduce en memoria); `detalle()` 404 con `NotFoundException`; `cerradoPor.nombre` resuelto con el patrón `mapaNombresPorCuil`/fallback `nombreFueraNomina` de `registros-horas.service.ts`.
- [ ] **Step 2: Implementar + rutas en el controller** (dentro del `@Controller('liquidacion')` existente, roles heredados Admin+Liquidador):

```ts
@Post('cierres')
crearCierre(@Body() dto: CrearCierreDto, @Request() req: RequestConUsuario) {
  return this.cierres.crearCierre(dto.anio, dto.mes, dto.quincena, dto.nota, req.user.cuil);
}
@Get('cierres')
listarCierres() { return this.cierres.listar(); }
@Get('cierres/:id')
detalleCierre(@Param('id', ParseIntPipe) id: number) { return this.cierres.detalle(id); }
```

- [ ] **Step 3: Verde + build + commit** `feat(liquidacion): endpoints de cierres (crear/listar/detalle)`

---

### Task 6: Export Excel (exceljs) — archivo principal + por tantos B

**Files:**
- Create: `src/liquidacion/export-cierre.service.ts` — Test: `src/liquidacion/export-cierre.service.spec.ts`
- Modify: `src/liquidacion/liquidacion.controller.ts` (2 rutas), `src/liquidacion/liquidacion.module.ts`, `package.json` (exceljs)

**Interfaces:**
- Consumes: `CierresService.detalle(id)` (Task 5).
- Produces: `generarExcelPrincipal(cierreId): Promise<{ buffer: Buffer; filename: string }>`, `generarExcelPorTantos(cierreId): Promise<{ buffer: Buffer; filename: string }>`; rutas `GET /liquidacion/cierres/:id/excel` y `GET /liquidacion/cierres/:id/excel-por-tantos` con `Content-Disposition: attachment`.

- [ ] **Step 1: `npm install exceljs`**
- [ ] **Step 2: Tests que fallan** (generan el workbook en memoria y lo re-leen con exceljs):

```ts
it('arma TOTAL/NORTE/TUCUMAN/RESUMEN/DIAS TRABAJADOS con las 18 columnas', async () => {
  const { buffer, filename } = await service.generarExcelPrincipal(1);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
  expect(wb.worksheets.map((w) => w.name)).toEqual(['TOTAL', 'NORTE', 'TUCUMAN', 'RESUMEN', 'DIAS TRABAJADOS']);
  expect(wb.getWorksheet('TOTAL').getRow(1).values).toContain('HORAS CCT');
  expect(filename).toBe('2026_09_1q_Sueldo SERTEC_v2.xlsx');
});
it('el sin-zona sale en TOTAL pero en ninguna hoja de zona', ...);
it('TIPO mapea fijo/fijo_105 → "Jornalizado/Mensualizado" y por_tantos → "Jornalizado/X Tanto"', ...);
it('por tantos B: hoja única con MONTO A/MONTO B solo de regimen por_tantos', ...);
```

- [ ] **Step 3: Implementar.** Columnas (orden y encabezados exactos del spec §5.1; encabezado de localidad = `'LOCALIDAD'` hasta que el usuario confirme lo contrario — ver spec §7.1). `TIPO`: mapa `{ jornalizado: 'Jornalizado', mensualizado: 'Mensualizado', fijo: 'Jornalizado/Mensualizado', fijo_105: 'Jornalizado/Mensualizado', por_tantos: 'Jornalizado/X Tanto' }`. `PRESENTISMO`: `tienePresentismo ? 'SI' : 'NO'`. `PRODUCTIVIDAD` = `montoProductividad + plusIndividual`; `GUARDIAS` = `montoGuardias`. RESUMEN: total por localidad + por zona + general (agregación del detalle). DIAS TRABAJADOS: primera columna Legajo/Nombre + una columna por día del rango, celda 1 si hay fila en `diasTrabajados`. Controller:

```ts
@Get('cierres/:id/excel')
async excelCierre(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
  const { buffer, filename } = await this.exportCierre.generarExcelPrincipal(id);
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"` });
  res.send(buffer);
}
```

- [ ] **Step 4: Verde + build + commit** `feat(liquidacion): export Excel del cierre + por tantos B (exceljs)`

---

### Task 7 (FRONTEND): API hooks + tipos (cierres + bono quincenal)

**Files:**
- Modify: `src/lib/api/liquidacion.ts` — Test: el de cada pantalla consumidora (Tasks 8-10)

**Interfaces:**
- Produces: tipos `CierreResumen`, `CierreDetalle` (espejo del backend Task 5); hooks `useCierres()`, `useCierre(id)`, `useCrearCierre()` (POST, invalida `['liquidacion','cierres']`), `descargarExcelCierre(id, porTantos: boolean)` (axios `responseType: 'blob'` + `URL.createObjectURL` + click de anchor con el filename del header `content-disposition`); `useBonosPeriodo(anio, mes, quincena)` y `useGuardarBonosPeriodo` apuntando a `/liquidacion/tarifas/bonos/${anio}/${mes}/${quincena}` (queryKey gana `quincena`).

- [ ] Step 1: escribir tipos + hooks siguiendo el patrón existente del archivo (líneas 205-222 para bonos). Step 2: `npx tsc --noEmit` limpio. Step 3: commit `feat(liquidacion): hooks de cierres y bono quincenal`.

---

### Task 8 (FRONTEND): Tarjeta Bono con selector de quincena

**Files:**
- Modify: `src/features/liquidacion/precios-vigentes-tab.tsx` (sección Bono)
- Test: `src/features/liquidacion/` (test del helper si el render cuelga — limitación conocida de esta máquina con `tarifas-page.test.tsx`)

**Interfaces:**
- Consumes: `useBonosPeriodo(anio, mes, quincena)` (Task 7).

- [ ] Step 1: la tarjeta Bono gana su selector de quincena propio (mismo patrón visual que la sección Plus individual de este archivo: botones/select "1ª quincena / 2ª quincena"), estado local `quincenaBono`, y `resuelto`/`sugerencia`/guardar operan sobre esa quincena. SIN dobles columnas (decisión explícita del dueño). Step 2: `tsc` + test por archivo de lo tocable. Step 3: commit `feat(tarifas): bono no remunerativo por quincena en la tarjeta de Bono`.

---

### Task 9 (FRONTEND): Botón "Cerrar quincena" + diálogo

**Files:**
- Modify: `src/app/(protected)/liquidacion/quincena/detalle/page.tsx`
- Create: `src/features/liquidacion/cerrar-quincena-dialog.tsx`
- Test: `src/features/liquidacion/cerrar-quincena-dialog.test.tsx`

**Interfaces:**
- Consumes: `useCrearCierre()` (Task 7), `useCierres()` (para saber la próxima versión), los datos ya cargados del detalle (totales y alertas visibles en la página).
- Produces: al confirmar → POST → `router.push('/liquidacion/cierres?nuevo=' + id)`.

- [ ] Step 1: tests del diálogo: muestra "cierre v1" si no hay versiones previas y "v2" + campo nota obligatorio si las hay; lista salvedades; botón confirmar deshabilitado si v>1 y nota vacía; onConfirm llama al hook con `{anio, mes, quincena, nota}`. Step 2: implementar (Dialog de shadcn, patrón `DesaprobarDialog`); botón "Cerrar quincena" en el header de la página de detalle, junto al selector de período. Step 3: verde por archivo + tsc + commit `feat(liquidacion): cerrar quincena desde el detalle (diálogo con salvedades y nota)`.

---

### Task 10 (FRONTEND): Pantalla /liquidacion/cierres

**Files:**
- Create: `src/app/(protected)/liquidacion/cierres/page.tsx`, `src/features/liquidacion/cierre-detalle-dialog.tsx`
- Modify: `src/lib/liquidacion-nav.ts` (ítem "Cierres")
- Test: `src/app/(protected)/liquidacion/cierres/cierres-page.test.tsx`

**Interfaces:**
- Consumes: `useCierres()`, `useCierre(id)`, `descargarExcelCierre` (Task 7).

- [ ] Step 1: tests: agrupa por (anio,mes,quincena) mostrando la versión MAX al frente; expandir muestra versiones anteriores con su nota; badge con count de salvedades; botones "Excel", "Por tantos B", "Ver detalle"; `?nuevo=` resalta la fila; estado vacío. Step 2: implementar — agrupado client-side sobre la lista plana del GET; "Ver detalle" abre `cierre-detalle-dialog` (tabla solo-lectura con las columnas del Excel, scroll horizontal propio). Step 3: verde por archivo + tsc + build + commit `feat(liquidacion): pantalla Cierres — versiones, descargas y detalle congelado`.

---

### Task 11: Verificación integral + contexto

- [ ] Backend: `npm test` completo + `npm run build`. Frontend: `npx tsc --noEmit` + `npm run build` + tests de los archivos tocados uno por uno.
- [ ] Smoke E2E local contra `testing` (2 servers): cargar bono de 1Q ≠ 2Q y ver el efecto en el detalle; cerrar una quincena; recerrar exigiendo nota; descargar ambos Excels y abrirlos; verificar hoja TUCUMAN/NORTE/sin-zona.
- [ ] Actualizar `.claude/Contexto/contexto-proyecto.md` (sección nueva §71) — como siempre.
- [ ] Mostrar el resultado al usuario y ESPERAR SU OK antes de abrir PRs (regla del proyecto). Deploy: DDL a `Horas_Sertec` ANTES del merge/deploy (orden: DDL → merge → deploy), `npx prisma generate` en la VPS, avisar antes de cada `pm2 restart`.

## Self-review

- Spec §2 (tablas) → Task 1. §2.4/§3.3 (bono) → Tasks 1-2 y 8. §3.1 (zona) → Tasks 3-4. §3.2 (cierre) → Tasks 4-5 y 9. §4 (API) → Tasks 2, 5, 6. §5 (Excel) → Task 6. §6 (UX) → Tasks 8-10. §7 pendientes: quedan flaggeados (nombre de columna LOCALIDAD, mapeo GUARDIAS/PRODUCTIVIDAD, alcance días trabajados) — no bloquean: el detalle congela provincia Y localidad, así el export se ajusta sin re-DDL.
- Tipos consistentes: `crearCierre(anio, mes, quincena, nota, usuarioCuil)` (Tasks 4-5-9), `generarExcelPrincipal/PorTantos` (Task 6), hooks (Tasks 7-10).
