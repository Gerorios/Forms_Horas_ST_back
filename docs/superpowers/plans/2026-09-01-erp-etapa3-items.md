# ERP Etapa 3 — Maestro de ítems en NestJS/React — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El ABM del maestro de ítems (`sth_cert_items`) vive en la app de Horas como pantalla del módulo Certificaciones, solo para nivel `admin` del claim `cert`; replica el comportamiento del portal con sus bugs corregidos conscientemente.

**Architecture:** Dos modelos Prisma nuevos (`sth_cert_items`, `sth_cert_contratos`) para el CRUD tipado + `$queryRaw` para el chequeo de unicidad normalizada (punto≡coma) y el guard de uso contra la fact. Un `ItemsService` con autorización por claim en el service (patrón del módulo), 4 rutas bajo `/certificaciones/items`. En el frontend: página `/certificaciones/items` (visible solo nivel admin) con tabla, filtro por contrato, buscador con debounce y modal de alta/edición, estilo de las pantallas del módulo.

**Tech Stack:** NestJS + Prisma 7 (modelos con `@@map` + raw para lo no-sargable), class-validator; Next.js + react-query; Jest / Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-unificacion-erp-certificaciones-design.md` (§5 Etapa 3). Inventario de referencia: el ABM del portal es `app/routers/items.py` + `pages/items.html` del repo PortalCertificaciones.

## Global Constraints

- Solo **nivel `admin` del claim `cert`** usa el ABM (los 4 endpoints): sin claim o nivel carga/lectura → Forbidden. La autorización vive en el service (patrón del módulo).
- **DDL: NINGUNO.** La tabla real ya tiene `UNIQUE uq_item_contrato (item_codigo, id_contrato)` (verificado 2026-09-01 con SHOW CREATE; sin duplicados normalizados). La regla punto≡coma se aplica a nivel aplicación con `REPLACE(...,'.',',')`, también al mover de contrato (fix de un agujero del portal).
- DDL real de `sth_cert_items` (fuente de los tipos Prisma): `id_item` INT UNSIGNED AI PK; `item_codigo` VARCHAR(20) NOT NULL; `grupo` VARCHAR(100); `subgrupo` VARCHAR(200); `id_contrato` TINYINT UNSIGNED NOT NULL FK; `contrato_nombre` VARCHAR(300); `tarea` VARCHAR(500) **NOT NULL**; `frecuencia` VARCHAR(20); `contratista` VARCHAR(60); `ptos_gasnor` DECIMAL(12,4); `unidad_medida` VARCHAR(20); `tipo` VARCHAR(10).
- Shape del listado: MISMAS 12 claves y orden del portal (`id_item, item_codigo, codigo_k, grupo, subgrupo, tarea, frecuencia, contratista, ptos_gasnor, unidad_medida, tipo, contrato_nombre`); `ptos_gasnor` como number (Number() sobre Decimal); orden `ORDER BY codigo_k, item_codigo` textual (paridad).
- Fixes conscientes vs el portal (todos con test): (1) sin LIMIT 500 mentiroso — se devuelve todo (maestro ~1000 filas); (2) PATCH distingue `null` (borra el campo) de ausente (no lo toca); (3) `ptos_gasnor = 0` es guardable; (4) unicidad revalidada al mover de contrato; (5) DELETE de id inexistente → 404; (6) `%`/`_` escapados en el buscador; (7) `tarea` obligatoria en el alta (la columna es NOT NULL — el portal podía generar un error 500); (8) `tipo` validado contra OPEX/CAPEX.
- Paridad deliberada (NO cambiar): `item_codigo` inmutable por API (el desempate del parser usa `id_item`: recrear un ítem cambia a qué K se imputan cargas futuras); mensajes de error en español estilo portal; hard delete con guard de uso (`No se puede eliminar: el ítem tiene N certificaciones cargadas`); sin import masivo (spec §8: mejoras aparte); `contrato_nombre` denormalizado tal cual.
- SQL raw siempre con bind params (`Prisma.sql`). NUNCA `prisma migrate dev`/`db push` (sin baseline).
- El portal sigue escribiendo la misma tabla física vía la vista `dim_item` durante la convivencia — no introducir reglas que rompan sus INSERT.
- Deploy solo con pedido explícito; aviso antes de `pm2 restart`. TDD estricto.

---

### Task 1: Modelos Prisma + ItemsService de lectura

**Files:**
- Modify: `prisma/schema.prisma` (2 modelos nuevos al final, sección certificaciones)
- Create: `src/certificaciones/items.service.ts`
- Test: `src/certificaciones/items.service.spec.ts`
- Modify: `src/certificaciones/certificaciones.module.ts` (provider)
- Modify: `src/certificaciones/certificaciones.controller.ts` (ruta GET `items`)

**Interfaces:**
- Consumes: `PrismaService`, `CertClaim` de `./accesos.service`.
- Produces:
  - Modelos Prisma `CertItem` (map `sth_cert_items`) y `CertContratoErp` (map `sth_cert_contratos`) — los usan las Tasks 1-2.
  - `interface ItemCert { id_item: number; item_codigo: string; codigo_k: string; grupo: string | null; subgrupo: string | null; tarea: string; frecuencia: string | null; contratista: string | null; ptos_gasnor: number | null; unidad_medida: string | null; tipo: string | null; contrato_nombre: string | null }`
  - `listar(filtros: { codigoK?: string; buscar?: string }, cert: CertClaim | null): Promise<ItemCert[]>`
  - Ruta `GET /certificaciones/items?codigo_k=&buscar=` (mismo patrón de claim que las rutas existentes).
  - `exigirAdminItems(cert)` privado: Forbidden si `!cert || cert.nivel !== 'admin'`, mensaje `'El maestro de ítems es solo para nivel admin.'`

- [ ] **Step 1: Modelos Prisma** — agregar al final de `prisma/schema.prisma` (tipos calcados del DDL real):

```prisma
// ------------------------------------------------------------
// CERTIFICACIONES (tablas mudadas del portal — etapa 2/3, spec §3)
// ------------------------------------------------------------
model CertContratoErp {
  id_contrato Int        @id @db.UnsignedTinyInt
  codigo_k    String     @db.VarChar(10)
  descripcion String?    @db.VarChar(300)
  items       CertItem[]

  @@map("sth_cert_contratos")
}

model CertItem {
  id_item         Int     @id @default(autoincrement()) @db.UnsignedInt
  item_codigo     String  @db.VarChar(20)
  grupo           String? @db.VarChar(100)
  subgrupo        String? @db.VarChar(200)
  id_contrato     Int     @db.UnsignedTinyInt
  contrato_nombre String? @db.VarChar(300)
  tarea           String  @db.VarChar(500)
  frecuencia      String? @db.VarChar(20)
  contratista     String? @db.VarChar(60)
  ptos_gasnor     Decimal? @db.Decimal(12, 4)
  unidad_medida   String? @db.VarChar(20)
  tipo            String? @db.VarChar(10)
  contrato        CertContratoErp @relation(fields: [id_contrato], references: [id_contrato])

  @@unique([item_codigo, id_contrato], map: "uq_item_contrato")
  @@map("sth_cert_items")
}
```

Nota: verificar contra la BD el nombre real de la columna descriptiva de `sth_cert_contratos` (el spec dice `descripcion`; si `SHOW COLUMNS FROM sth_cert_contratos` — vía un script one-off con el driver mariadb como en docs/sql — muestra otro nombre o columnas extra, calcar la realidad). Correr `npx prisma generate` y `npx tsc --noEmit` para validar.

- [ ] **Step 2: Tests de lectura que fallan**

```ts
import { ForbiddenException } from '@nestjs/common';
import { ItemsService } from './items.service';

const admin = { nivel: 'admin', ks: [], inc: true };

describe('ItemsService.listar', () => {
  const prisma = { $queryRaw: jest.fn() } as any;
  const service = new ItemsService(prisma);
  beforeEach(() => prisma.$queryRaw.mockReset());

  it('sin claim o nivel no-admin tira Forbidden', async () => {
    await expect(service.listar({}, null)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listar({}, { nivel: 'lectura', ks: [], inc: true })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listar({}, { nivel: 'carga', ks: ['K6'], inc: false })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('devuelve el shape del portal con ptos_gasnor como number', async () => {
    prisma.$queryRaw.mockResolvedValue([{
      id_item: 1, item_codigo: '384,1', codigo_k: 'K6', grupo: null, subgrupo: null,
      tarea: 'Reparacion', frecuencia: null, contratista: null,
      ptos_gasnor: '28.0000', unidad_medida: 'un', tipo: 'OPEX', contrato_nombre: null,
    }]);
    const r = await service.listar({}, admin);
    expect(r[0].ptos_gasnor).toBe(28);
    expect(r[0].id_item).toBe(1);
  });

  it('ptos_gasnor null queda null (no 0)', async () => {
    prisma.$queryRaw.mockResolvedValue([{
      id_item: 2, item_codigo: '1', codigo_k: 'K2', grupo: null, subgrupo: null,
      tarea: 'x', frecuencia: null, contratista: null,
      ptos_gasnor: null, unidad_medida: null, tipo: null, contrato_nombre: null,
    }]);
    expect((await service.listar({}, admin))[0].ptos_gasnor).toBeNull();
  });

  it('codigo_k se normaliza a mayúsculas y buscar escapa % y _', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await service.listar({ codigoK: 'k6', buscar: '38%_1' }, admin);
    const sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.values).toContain('K6');
    expect(sql.values.some((v: unknown) => String(v).includes('38\\%\\_1'))).toBe(true);
  });
});
```

- [ ] **Step 3: Verificar RED** — `npx jest src/certificaciones/items.service.spec.ts` → FAIL (módulo inexistente)

- [ ] **Step 4: Implementación**

```ts
import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CertClaim } from './accesos.service';

export interface ItemCert {
  id_item: number;
  item_codigo: string;
  codigo_k: string;
  grupo: string | null;
  subgrupo: string | null;
  tarea: string;
  frecuencia: string | null;
  contratista: string | null;
  ptos_gasnor: number | null;
  unidad_medida: string | null;
  tipo: string | null;
  contrato_nombre: string | null;
}

const escaparLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

/**
 * ABM del maestro de ítems (portado de app/routers/items.py del portal).
 * Solo nivel admin del claim cert. Fixes conscientes vs el portal: sin
 * LIMIT 500, LIKE escapado, tarea obligatoria (la columna es NOT NULL).
 */
@Injectable()
export class ItemsService {
  constructor(private readonly prisma: PrismaService) {}

  private exigirAdminItems(cert: CertClaim | null): void {
    if (!cert || cert.nivel !== 'admin') {
      throw new ForbiddenException('El maestro de ítems es solo para nivel admin.');
    }
  }

  async listar(f: { codigoK?: string; buscar?: string }, cert: CertClaim | null): Promise<ItemCert[]> {
    this.exigirAdminItems(cert);
    const conds: Prisma.Sql[] = [];
    if (f.codigoK) conds.push(Prisma.sql`dc.codigo_k = ${f.codigoK.toUpperCase()}`);
    if (f.buscar) {
      const patron = `%${escaparLike(f.buscar)}%`;
      conds.push(Prisma.sql`(di.item_codigo LIKE ${patron} OR di.tarea LIKE ${patron})`);
    }
    const where = conds.length ? Prisma.sql` AND ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT di.id_item, di.item_codigo, dc.codigo_k,
             di.grupo, di.subgrupo, di.tarea, di.frecuencia, di.contratista,
             di.ptos_gasnor, di.unidad_medida, di.tipo, di.contrato_nombre
      FROM sth_cert_items di
      JOIN sth_cert_contratos dc ON di.id_contrato = dc.id_contrato
      WHERE 1=1 ${where}
      ORDER BY dc.codigo_k, di.item_codigo
    `);
    return rows.map((r) => ({
      ...r,
      id_item: Number(r.id_item),
      ptos_gasnor: r.ptos_gasnor == null ? null : Number(r.ptos_gasnor),
    }));
  }
}
```

Provider en el módulo y ruta en el controller (mismo patrón de claim que las rutas existentes):

```ts
@Get('items')
listarItems(@Query() q: Record<string, unknown> /* + claim como en las demás */) {
  return this.items.listar(
    { codigoK: q.codigo_k ? String(q.codigo_k) : undefined, buscar: q.buscar ? String(q.buscar) : undefined },
    cert,
  );
}
```

- [ ] **Step 5: Verificar GREEN** — `npx jest src/certificaciones` → PASS; `npx prisma generate` OK; `npx tsc --noEmit` limpio.
- [ ] **Step 6: Commit** — `git commit -m "feat(certificaciones): modelos sth_cert_* y listado del maestro de items"`

---

### Task 2: ItemsService de escritura (crear / actualizar / eliminar)

**Files:**
- Create: `src/certificaciones/dto/item.dto.ts`
- Modify: `src/certificaciones/items.service.ts`
- Modify: `src/certificaciones/items.service.spec.ts` (tests nuevos)
- Modify: `src/certificaciones/certificaciones.controller.ts` (POST/PATCH/DELETE)

**Interfaces:**
- Consumes: modelos/servicio de Task 1.
- Produces:
  - `crear(dto: CrearItemDto, cert): Promise<{ mensaje: string }>` — POST `/certificaciones/items`.
  - `actualizar(idItem: number, dto: ActualizarItemDto, cert): Promise<{ mensaje: string }>` — PATCH `/certificaciones/items/:id`.
  - `eliminar(idItem: number, cert): Promise<{ mensaje: string }>` — DELETE `/certificaciones/items/:id`.
  - DTOs (class-validator; el ValidationPipe global con whitelist ya rige):

```ts
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class CrearItemDto {
  @IsString() @IsNotEmpty() @MaxLength(20) item_codigo: string;
  @IsString() @IsNotEmpty() codigo_k: string;
  @IsString() @IsNotEmpty() @MaxLength(500) tarea: string; // NOT NULL en la BD (fix #7)
  @IsOptional() @IsString() @MaxLength(100) grupo?: string | null;
  @IsOptional() @IsString() @MaxLength(200) subgrupo?: string | null;
  @IsOptional() @IsString() @MaxLength(20) frecuencia?: string | null;
  @IsOptional() @IsString() @MaxLength(60) contratista?: string | null;
  @IsOptional() @IsNumber() ptos_gasnor?: number | null;
  @IsOptional() @IsString() @MaxLength(20) unidad_medida?: string | null;
  @IsOptional() @IsIn(['OPEX', 'CAPEX']) tipo?: string | null;
  @IsOptional() @IsString() @MaxLength(300) contrato_nombre?: string | null;
}

// PATCH semántico real (fix #2): ausente = no tocar; null = borrar.
// item_codigo NO está (inmutable, paridad con el portal — el desempate del
// parser usa id_item). tarea editable pero NO nullable (columna NOT NULL).
export class ActualizarItemDto {
  @IsOptional() @IsString() @IsNotEmpty() codigo_k?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) tarea?: string;
  @IsOptional() @IsString() @MaxLength(100) grupo?: string | null;
  @IsOptional() @IsString() @MaxLength(200) subgrupo?: string | null;
  @IsOptional() @IsString() @MaxLength(20) frecuencia?: string | null;
  @IsOptional() @IsString() @MaxLength(60) contratista?: string | null;
  @IsOptional() @IsNumber() ptos_gasnor?: number | null;
  @IsOptional() @IsString() @MaxLength(20) unidad_medida?: string | null;
  @IsOptional() @IsIn(['OPEX', 'CAPEX']) tipo?: string | null;
  @IsOptional() @IsString() @MaxLength(300) contrato_nombre?: string | null;
}
```

  (Nota: `@IsOptional()` de class-validator saltea la validación tanto para `undefined` como para `null` — por eso `null` pasa y el service lo interpreta como "borrar".)

- [ ] **Step 1: Tests de escritura que fallan** (agregar al spec)

```ts
describe('ItemsService.crear', () => {
  const prisma = { $queryRaw: jest.fn(), certItem: { create: jest.fn() }, certContratoErp: { findFirst: jest.fn() } } as any;
  const service = new ItemsService(prisma);
  beforeEach(() => { prisma.$queryRaw.mockReset(); prisma.certItem.create.mockReset(); prisma.certContratoErp.findFirst.mockReset(); });

  it('contrato inexistente → BadRequest con el mensaje del portal', async () => {
    prisma.certContratoErp.findFirst.mockResolvedValue(null);
    await expect(service.crear({ item_codigo: '384.1', codigo_k: 'K7', tarea: 'x' } as any, admin))
      .rejects.toThrow('Contrato K7 no encontrado');
  });

  it('duplicado normalizado punto≡coma → BadRequest', async () => {
    prisma.certContratoErp.findFirst.mockResolvedValue({ id_contrato: 3, codigo_k: 'K6' });
    prisma.$queryRaw.mockResolvedValue([{ id_item: 99 }]); // ya existe "384,1"
    await expect(service.crear({ item_codigo: '384.1', codigo_k: 'K6', tarea: 'x' } as any, admin))
      .rejects.toThrow('El ítem 384.1 ya existe en K6');
    expect(prisma.certItem.create).not.toHaveBeenCalled();
  });

  it('crea con ptos_gasnor 0 (guardable, fix del portal)', async () => {
    prisma.certContratoErp.findFirst.mockResolvedValue({ id_contrato: 3, codigo_k: 'K6' });
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.certItem.create.mockResolvedValue({});
    await service.crear({ item_codigo: '500', codigo_k: 'K6', tarea: 'x', ptos_gasnor: 0 } as any, admin);
    expect(prisma.certItem.create.mock.calls[0][0].data.ptos_gasnor).toBe(0);
  });

  it('nivel no-admin → Forbidden', async () => {
    await expect(service.crear({} as any, { nivel: 'lectura', ks: [], inc: true })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ItemsService.actualizar', () => {
  const prisma = { $queryRaw: jest.fn(), certItem: { findUnique: jest.fn(), update: jest.fn() }, certContratoErp: { findFirst: jest.fn() } } as any;
  const service = new ItemsService(prisma);
  beforeEach(() => { prisma.$queryRaw.mockReset(); prisma.certItem.findUnique.mockReset(); prisma.certItem.update.mockReset(); prisma.certContratoErp.findFirst.mockReset(); });

  it('id inexistente → NotFound', async () => {
    prisma.certItem.findUnique.mockResolvedValue(null);
    await expect(service.actualizar(999, {} as any, admin)).rejects.toThrow('Ítem no encontrado');
  });

  it('null borra el campo; ausente no lo toca (fix del portal)', async () => {
    prisma.certItem.findUnique.mockResolvedValue({ id_item: 1, item_codigo: '384,1', id_contrato: 3 });
    prisma.certItem.update.mockResolvedValue({});
    await service.actualizar(1, { grupo: null, tarea: 'Nueva tarea' } as any, admin);
    const data = prisma.certItem.update.mock.calls[0][0].data;
    expect(data.grupo).toBeNull();
    expect(data.tarea).toBe('Nueva tarea');
    expect('subgrupo' in data).toBe(false); // ausente: no se toca
  });

  it('mover de contrato revalida unicidad normalizada (fix del agujero del portal)', async () => {
    prisma.certItem.findUnique.mockResolvedValue({ id_item: 1, item_codigo: '384,1', id_contrato: 3 });
    prisma.certContratoErp.findFirst.mockResolvedValue({ id_contrato: 5, codigo_k: 'K8' });
    prisma.$queryRaw.mockResolvedValue([{ id_item: 42 }]); // K8 ya tiene "384.1"
    await expect(service.actualizar(1, { codigo_k: 'K8' } as any, admin))
      .rejects.toThrow('El ítem 384,1 ya existe en K8');
    expect(prisma.certItem.update).not.toHaveBeenCalled();
  });

  it('sin campos → {mensaje: "Sin cambios"} sin tocar la BD', async () => {
    prisma.certItem.findUnique.mockResolvedValue({ id_item: 1, item_codigo: '1', id_contrato: 3 });
    expect(await service.actualizar(1, {} as any, admin)).toEqual({ mensaje: 'Sin cambios' });
    expect(prisma.certItem.update).not.toHaveBeenCalled();
  });
});

describe('ItemsService.eliminar', () => {
  const prisma = { $queryRaw: jest.fn(), certItem: { findUnique: jest.fn(), delete: jest.fn() } } as any;
  const service = new ItemsService(prisma);
  beforeEach(() => { prisma.$queryRaw.mockReset(); prisma.certItem.findUnique.mockReset(); prisma.certItem.delete.mockReset(); });

  it('id inexistente → NotFound (el portal devolvía 200 mentiroso)', async () => {
    prisma.certItem.findUnique.mockResolvedValue(null);
    await expect(service.eliminar(999, admin)).rejects.toThrow('Ítem no encontrado');
  });

  it('con certificaciones cargadas → BadRequest con el conteo', async () => {
    prisma.certItem.findUnique.mockResolvedValue({ id_item: 1 });
    prisma.$queryRaw.mockResolvedValue([{ c: 143n }]);
    await expect(service.eliminar(1, admin))
      .rejects.toThrow('No se puede eliminar: el ítem tiene 143 certificaciones cargadas');
    expect(prisma.certItem.delete).not.toHaveBeenCalled();
  });

  it('sin uso → borra y devuelve el mensaje del portal', async () => {
    prisma.certItem.findUnique.mockResolvedValue({ id_item: 1 });
    prisma.$queryRaw.mockResolvedValue([{ c: 0n }]);
    prisma.certItem.delete.mockResolvedValue({});
    expect(await service.eliminar(1, admin)).toEqual({ mensaje: 'Ítem eliminado' });
  });
});
```

- [ ] **Step 2: Verificar RED** — los describes nuevos fallan (métodos inexistentes)

- [ ] **Step 3: Implementación** (agregar a `items.service.ts`)

```ts
private async resolverContrato(codigoK: string): Promise<{ id_contrato: number; codigo_k: string }> {
  const contrato = await this.prisma.certContratoErp.findFirst({
    where: { codigo_k: codigoK.toUpperCase() },
    select: { id_contrato: true, codigo_k: true },
  });
  if (!contrato) throw new BadRequestException(`Contrato ${codigoK} no encontrado`);
  return contrato;
}

/** Unicidad normalizada punto≡coma dentro del contrato (regla del portal),
 * excluyendo opcionalmente el propio ítem (para el caso "mover de contrato"). */
private async existeDuplicado(itemCodigo: string, idContrato: number, exceptoId = 0): Promise<boolean> {
  const filas = await this.prisma.$queryRaw<{ id_item: number }[]>(Prisma.sql`
    SELECT id_item FROM sth_cert_items
    WHERE REPLACE(item_codigo, '.', ',') = REPLACE(${itemCodigo}, '.', ',')
      AND id_contrato = ${idContrato} AND id_item != ${exceptoId}
    LIMIT 1
  `);
  return filas.length > 0;
}

async crear(dto: CrearItemDto, cert: CertClaim | null): Promise<{ mensaje: string }> {
  this.exigirAdminItems(cert);
  const contrato = await this.resolverContrato(dto.codigo_k);
  if (await this.existeDuplicado(dto.item_codigo, contrato.id_contrato)) {
    throw new BadRequestException(`El ítem ${dto.item_codigo} ya existe en ${contrato.codigo_k}`);
  }
  await this.prisma.certItem.create({
    data: {
      item_codigo: dto.item_codigo.trim(),
      id_contrato: contrato.id_contrato,
      tarea: dto.tarea,
      grupo: dto.grupo ?? null,
      subgrupo: dto.subgrupo ?? null,
      frecuencia: dto.frecuencia ?? null,
      contratista: dto.contratista ?? null,
      ptos_gasnor: dto.ptos_gasnor ?? null,
      unidad_medida: dto.unidad_medida ?? null,
      tipo: dto.tipo ?? null,
      contrato_nombre: dto.contrato_nombre ?? null,
    },
  });
  return { mensaje: `Ítem ${dto.item_codigo} creado en ${contrato.codigo_k}` };
}

async actualizar(idItem: number, dto: ActualizarItemDto, cert: CertClaim | null): Promise<{ mensaje: string }> {
  this.exigirAdminItems(cert);
  const item = await this.prisma.certItem.findUnique({ where: { id_item: idItem } });
  if (!item) throw new NotFoundException('Ítem no encontrado');

  const data: Record<string, unknown> = {};
  const CAMPOS = ['tarea', 'grupo', 'subgrupo', 'frecuencia', 'contratista', 'ptos_gasnor', 'unidad_medida', 'tipo', 'contrato_nombre'] as const;
  for (const campo of CAMPOS) {
    if (dto[campo] !== undefined) data[campo] = dto[campo]; // null = borrar; ausente = no tocar
  }
  if (dto.codigo_k !== undefined) {
    const contrato = await this.resolverContrato(dto.codigo_k);
    if (contrato.id_contrato !== item.id_contrato &&
        (await this.existeDuplicado(item.item_codigo, contrato.id_contrato, idItem))) {
      throw new BadRequestException(`El ítem ${item.item_codigo} ya existe en ${contrato.codigo_k}`);
    }
    data.id_contrato = contrato.id_contrato;
  }
  if (Object.keys(data).length === 0) return { mensaje: 'Sin cambios' };
  await this.prisma.certItem.update({ where: { id_item: idItem }, data });
  return { mensaje: 'Ítem actualizado' };
}

async eliminar(idItem: number, cert: CertClaim | null): Promise<{ mensaje: string }> {
  this.exigirAdminItems(cert);
  const item = await this.prisma.certItem.findUnique({ where: { id_item: idItem } });
  if (!item) throw new NotFoundException('Ítem no encontrado');
  const [fila] = await this.prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`
    SELECT COUNT(*) c FROM sth_cert_certificaciones WHERE id_item = ${idItem}
  `);
  const enUso = Number(fila.c);
  if (enUso > 0) {
    throw new BadRequestException(`No se puede eliminar: el ítem tiene ${enUso} certificaciones cargadas`);
  }
  await this.prisma.certItem.delete({ where: { id_item: idItem } });
  return { mensaje: 'Ítem eliminado' };
}
```

Rutas en el controller: `@Post('items')` (body `CrearItemDto`), `@Patch('items/:id')` (`ParseIntPipe`, body `ActualizarItemDto`), `@Delete('items/:id')` (`ParseIntPipe`) — claim como en las demás rutas del módulo.

- [ ] **Step 4: Verificar GREEN** — `npx jest src/certificaciones` → PASS; `npx tsc --noEmit` limpio.
- [ ] **Step 5: Commit** — `git commit -m "feat(certificaciones): crear/actualizar/eliminar del maestro de items"`

---

### Task 3: Frontend — pantalla Ítems del módulo

**Files (repo Frontend, rama propia):**
- Modify: `src/lib/api/certificaciones.ts` (interface + 4 hooks nuevos)
- Create: `src/app/(protected)/certificaciones/items/page.tsx`
- Test: `src/app/(protected)/certificaciones/items/items-page.test.tsx`
- Modify: `src/features/certificaciones/certificaciones-nav.ts` (entrada "Ítems", visible solo nivel admin — mirar cómo el layout del módulo consume ese nav y cómo gatea por `perfil.cert`)

**Interfaces:**
- Consumes: rutas de Tasks 1-2; `useContratosAnalytics()` existente (pobla el select de contratos — nivel admin ve todos); patrón de páginas del módulo (`certificaciones/page.tsx`) y de ABMs de Admin (`admin/accesos-certificaciones/page.tsx`).
- Produces (hooks en `certificaciones.ts`):

```ts
export interface ItemCert {
  id_item: number;
  item_codigo: string;
  codigo_k: string;
  grupo: string | null;
  subgrupo: string | null;
  tarea: string;
  frecuencia: string | null;
  contratista: string | null;
  ptos_gasnor: number | null;
  unidad_medida: string | null;
  tipo: string | null;
  contrato_nombre: string | null;
}

export function useItemsCert(filtros: { codigoK?: string; buscar?: string }, habilitado = true) {
  const params = new URLSearchParams();
  if (filtros.codigoK) params.append('codigo_k', filtros.codigoK);
  if (filtros.buscar) params.append('buscar', filtros.buscar);
  return useQuery({
    queryKey: ['certificaciones', 'items', filtros],
    queryFn: () => api.get<ItemCert[]>('/certificaciones/items', { params }).then((r) => r.data),
    enabled: habilitado,
    placeholderData: (prev) => prev, // evita parpadeo mientras se tipea
  });
}

export function useCrearItemCert() { /* POST /certificaciones/items, invalida ['certificaciones','items'] */ }
export function useEditarItemCert() { /* PATCH /certificaciones/items/:id, mismo invalidate; firma { idItem, ...campos } */ }
export function useEliminarItemCert() { /* DELETE /certificaciones/items/:id, mismo invalidate */ }
```

(Los tres mutation hooks siguen textualmente el patrón de `useGuardarAccesoCert`/`useEliminarAccesoCert` ya existentes en el mismo archivo.)

**La página** (`certificaciones/items/page.tsx`), siguiendo el estilo del módulo:
- Gate: si `perfil?.cert?.nivel !== 'admin'` → no renderizar el contenido (mismo mecanismo que use el layout/las páginas del módulo para gatear; mirar `certificaciones/layout.tsx`).
- Barra superior: select de contrato ("Todos los contratos" + los de `useContratosAnalytics()`), input buscador con **debounce de 300ms** (estado local `buscar` + `useEffect` con `setTimeout` que setea `buscarDebounced`, que es lo que va al hook), contador honesto (`data.length` — ya sin límite server-side), botón "Nuevo ítem".
- Tabla (columnas de la grilla del portal): Código (negrita), Contrato (chip), Tarea (truncada con `title`), Tipo (chip OPEX/CAPEX, `—` neutro si null), UM, Ptos. Gasnor (mostrar `0` como `0`, `—` solo si null), Contratista, Frecuencia, acciones Editar/Eliminar. Sin scroll horizontal (regla de la casa): tarea con `max-w` + truncate.
- Modal alta/edición (mismo para ambos, patrón del modal de accesos/ABMs): campos principales (código — deshabilitado en edición —, contrato, tarea, tipo con opción "Sin especificar", UM, ptos. Gasnor `type=number step=0.01`) + sección colapsable "Ver más campos" (contratista, frecuencia, grupo, subgrupo, nombre contrato), auto-expandida en edición si alguno tiene valor. En edición, cada campo vacío se manda como `null` (borra — comportamiento nuevo correcto) y `ptos_gasnor` `''` → null pero `'0'` → 0.
- Modal de confirmación para eliminar ("Esta acción no se puede deshacer"); los errores del backend (`El ítem X ya existe en K6`, `No se puede eliminar: ...`) se muestran vía toast de error con el mensaje del server.
- Advertencia chica (texto fijo bajo el select de contrato del modal en modo edición, solo si se cambió el contrato): "Mover el ítem de contrato cambia a qué K se imputan las cargas futuras de este código." (acoplamiento real con el parser).

**Tests de la página** (patrón `accesos-page.test.tsx`: mock de hooks + userEvent):
1. renderiza filas con código, chip de contrato y tipo; `ptos_gasnor: 0` se muestra como "0".
2. el buscador espera el debounce: tipear no dispara el hook con el texto hasta pasar 300ms (fake timers).
3. alta: completar código+contrato+tarea y guardar llama a crear con el payload correcto (`tipo: null` si "Sin especificar").
4. edición: vaciar un campo manda `null` (no lo omite).
5. eliminar: confirma y llama al hook con el id.
6. con `perfil.cert.nivel !== 'admin'` la página no muestra el contenido.

- [ ] **Step 1**: tests primero (RED con page stub) → **Step 2**: hooks + página (GREEN) → **Step 3**: entrada en el nav del módulo (gateada) → **Step 4**: `npx vitest run` del archivo + suite completa + `npx tsc --noEmit` → **Step 5**: Commit `feat(certificaciones): pantalla Items del maestro (solo nivel admin)`.

---

### Task 4: Cierre — smoke real y nota de deploy

**Files:**
- Create: `docs/2026-09-xx-erp-etapa3-deploy.md` (Backend, fecha del día)

- [ ] **Step 1: Smoke real de lectura contra `testing`**: script one-off en el scratchpad (driver mariadb, como `docs/sql` de la etapa 2) que ejecute la query de `listar` con un filtro y verifique que devuelve filas con las 12 claves. Pegar la salida en el reporte.
- [ ] **Step 2: Nota de deploy** con este contenido:

```markdown
# Deploy ERP etapa 3 — maestro de ítems

Sin DDL (el UNIQUE (item_codigo, id_contrato) ya existía; sin duplicados
normalizados verificado 2026-09-01). Deploy estándar:

1. Merge de los PRs (Backend y Frontend de Horas). Los TRES repos: el portal
   NO tiene cambios en esta etapa (verificarlo igual).
2. VPS: pull + npm install + npx prisma generate + build en ambos repos.
3. AVISO al usuario y sudo pm2 restart forms-horas-back forms-horas-front.
4. Smoke: /api/certificaciones/items 401 sin token; con admin: la pantalla
   Ítems lista, crea, edita (vaciar un campo lo borra) y bloquea el borrado
   de un ítem con certificaciones.
5. Paridad: el listado de la pantalla nueva vs items.html del portal para
   un mismo contrato (mismos ítems; el orden es el mismo, textual).
6. Aviso operativo: a partir de acá el maestro se administra desde
   misregistros; items.html del portal queda redundante (ambos escriben la
   misma tabla física — evitar ediciones simultáneas). Se apaga en etapa 5.
7. Documentar la sesión en los dos contextos.
```

- [ ] **Step 3: Commit** — `git commit -m "docs(certificaciones): nota de deploy de la etapa 3"`

---

## Self-review del plan (hecho)

- **Cobertura del spec (etapa 3):** ABM completo de `sth_cert_items` solo nivel admin (T1 lectura, T2 escritura, T3 pantalla), estilo de la casa, sin import masivo (spec §8), convivencia con el portal contemplada (sin DDL, misma tabla vía vista).
- **Placeholders:** los tres mutation hooks de T3 referencian el patrón textual de hooks existentes en el MISMO archivo que se edita (el ejecutor los tiene delante); todo lo demás lleva código completo.
- **Consistencia de tipos:** `ItemCert` idéntico en backend (T1) y frontend (T3); DTOs de T2 calcan los largos del DDL real; nombres Prisma `CertItem`/`CertContratoErp` consistentes entre T1 y T2.
- **Riesgos nombrados:** columna `descripcion` de `sth_cert_contratos` a verificar en T1 Step 1; el desempate por `id_item` del parser documentado como razón de la inmutabilidad de `item_codigo` y de la advertencia de la UI al mover de contrato.
