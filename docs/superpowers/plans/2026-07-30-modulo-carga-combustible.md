# Módulo Carga de Combustible — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el Google Forms de cargas de combustible por un módulo integrado: registro por Jefe de Cuadrilla con foto de ticket obligatoria, catálogos administrables, consulta por Jefe de Contrato, y asistente de IA (visión) que pre-rellena el formulario. Ver `docs/adr/2026-07-30-adr-013-modulo-carga-de-combustible.md`.

**Architecture:** Backend NestJS 11 + Prisma 7 (BD MySQL compartida, tablas `sth_`): módulo nuevo `cargas-combustible` + 2 catálogos nuevos en `admin`/`catalogos` + servicio de storage en filesystem (abstraído tras interfaz) + servicio de extracción con la API de Anthropic. Frontend Next.js 16 (App Router): página `/combustible` (form foto-first + listado), páginas admin de catálogos, hooks react-query.

**Tech Stack:** NestJS 11, Prisma 7 (`@prisma/adapter-mariadb`), class-validator/class-transformer, multer (via `@nestjs/platform-express`), `@anthropic-ai/sdk` (modelo `claude-haiku-4-5`), Next.js 16 + React 19 + @tanstack/react-query 5 + axios, jest (backend), vitest (frontend).

## Global Constraints

- **NO ejecutar este plan sin OK explícito del dueño del producto** (pedido: "arma el plan pero NO EJECUTES NADA").
- La BD es **compartida** con otros sistemas: DDL solo con tablas prefijo `sth_`, aplicado a mano (SQL provisto), nunca `prisma migrate`/`db push` contra esa BD. Igual que ADR-012.
- Roles como **strings** (`'JefeCuadrilla'`, `'JefeContrato'`, `'Admin'`) — no hay enum de roles.
- Baja lógica siempre (`activo`/`anulada`), nunca DELETE físico.
- Auditoría inline con `prisma.auditoria.create` (no hay helper), tabla `sth_auditoria`.
- `ValidationPipe({ whitelist: true, transform: true })` global ya activo; DTOs multipart necesitan `@Type(() => Number)` / `@Transform` porque los campos llegan como string.
- UI y mensajes en español. Identificadores siguiendo el estilo del repo (español: `crear`, `anular`, `ultimoKm`).
- El usuario logueado se lee `req.user.cuil` / `req.user.rol` (no existe `@CurrentUser`).
- La IA **solo sugiere** — nunca bloquea ni autocompleta sin confirmación; sin `ANTHROPIC_API_KEY` el módulo funciona igual.
- Env nuevas: `TICKETS_DIR` (default `./storage/tickets`), `ANTHROPIC_API_KEY` (opcional). Agregar a `.env.example`.
- Backend hoy no tiene ningún `.spec.ts` — este plan introduce los primeros; jest ya está configurado (`npm test`, `testRegex .*\.spec\.ts$`, rootDir `src`).

---

### Task 1: Schema Prisma + DDL de las tablas nuevas

**Files:**
- Modify: `prisma/schema.prisma` (enums `AccionAuditoria`, modelos `Movil`, `Provincia`, `TareaCatalogo`; agregar 4 modelos y 2 enums)
- Create: `docs/sql/2026-07-30-cargas-combustible.sql`

**Interfaces:**
- Produces: modelos Prisma `EstacionServicio`, `TipoCombustible`, `CargaCombustible`, `CargaCombustibleTarea`; enums `MedioPagoCombustible { cuenta_corriente, caja }`, `EstadoCargaCombustible { activa, anulada }`; `AccionAuditoria` gana el valor `anular`. Todos los tasks siguientes dependen de estos nombres.

- [ ] **Step 1: Agregar enums y modelos al schema**

En `prisma/schema.prisma`, agregar al enum existente `AccionAuditoria` el valor `anular` (queda `crear editar aprobar desaprobar reabrir anular`) y sumar:

```prisma
enum MedioPagoCombustible {
  cuenta_corriente
  caja
}

enum EstadoCargaCombustible {
  activa
  anulada
}

model EstacionServicio {
  id        Int     @id @default(autoincrement())
  nombre    String  @unique
  localidad String?
  activo    Boolean @default(true)

  cargas CargaCombustible[]

  @@map("sth_estaciones_servicio")
}

model TipoCombustible {
  id     Int     @id @default(autoincrement())
  nombre String  @unique
  activo Boolean @default(true)

  cargas CargaCombustible[]

  @@map("sth_tipos_combustible")
}

model CargaCombustible {
  id                Int                    @id @default(autoincrement())
  fechaCarga        DateTime               @map("fecha_carga") @db.Date
  cargadoPorCuil    String                 @map("cargado_por_cuil") @db.Char(13)
  movilId           Int                    @map("movil_id")
  litros            Decimal                @db.Decimal(8, 2)
  monto             Decimal                @db.Decimal(12, 2)
  km                Int
  medioPago         MedioPagoCombustible   @map("medio_pago")
  nroComprobante    String                 @map("nro_comprobante") @db.VarChar(50)
  estacionId        Int                    @map("estacion_id")
  tipoCombustibleId Int                    @map("tipo_combustible_id")
  provinciaId       Int                    @map("provincia_id")
  observaciones     String?                @db.Text
  fotoPath          String                 @map("foto_path") @db.VarChar(255)
  estado            EstadoCargaCombustible @default(activa)
  motivoAnulacion   String?                @map("motivo_anulacion") @db.Text
  anuladaPorCuil    String?                @map("anulada_por_cuil") @db.Char(13)
  anuladaEn         DateTime?              @map("anulada_en")
  createdAt         DateTime               @default(now()) @map("created_at")
  updatedAt         DateTime               @updatedAt @map("updated_at")

  movil           Movil                   @relation(fields: [movilId], references: [id])
  estacion        EstacionServicio        @relation(fields: [estacionId], references: [id])
  tipoCombustible TipoCombustible         @relation(fields: [tipoCombustibleId], references: [id])
  provincia       Provincia               @relation(fields: [provinciaId], references: [id])
  tareas          CargaCombustibleTarea[]

  @@index([cargadoPorCuil, fechaCarga])
  @@index([movilId, fechaCarga])
  @@map("sth_cargas_combustible")
}

model CargaCombustibleTarea {
  cargaId Int @map("carga_id")
  tareaId Int @map("tarea_id")

  carga CargaCombustible @relation(fields: [cargaId], references: [id])
  tarea TareaCatalogo    @relation(fields: [tareaId], references: [id])

  @@id([cargaId, tareaId])
  @@map("sth_carga_combustible_tareas")
}
```

Y agregar las back-relations en los modelos existentes: `Movil` → `cargasCombustible CargaCombustible[]`, `Provincia` → `cargasCombustible CargaCombustible[]`, `TareaCatalogo` → `cargasCombustible CargaCombustibleTarea[]`.

- [ ] **Step 2: Validar y generar el cliente**

Run: `npx prisma validate && npx prisma generate`
Expected: `The schema ... is valid` y generación sin errores.

- [ ] **Step 3: Escribir el DDL manual**

Crear `docs/sql/2026-07-30-cargas-combustible.sql`:

```sql
-- ADR-013: módulo carga de combustible. Aplicar a mano en la BD compartida (como ADR-012).
ALTER TABLE sth_auditoria MODIFY accion ENUM('crear','editar','aprobar','desaprobar','reabrir','anular') NOT NULL;

CREATE TABLE sth_estaciones_servicio (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(191) NOT NULL UNIQUE,
  localidad VARCHAR(191) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE sth_tipos_combustible (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(191) NOT NULL UNIQUE,
  activo TINYINT(1) NOT NULL DEFAULT 1
) DEFAULT CHARSET=utf8mb4;

INSERT INTO sth_tipos_combustible (nombre) VALUES
  ('Gasoil'), ('Gasoil premium'), ('Súper'), ('Premium'), ('GNC');

CREATE TABLE sth_cargas_combustible (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fecha_carga DATE NOT NULL,
  cargado_por_cuil CHAR(13) NOT NULL,
  movil_id INT NOT NULL,
  litros DECIMAL(8,2) NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  km INT NOT NULL,
  medio_pago ENUM('cuenta_corriente','caja') NOT NULL,
  nro_comprobante VARCHAR(50) NOT NULL,
  estacion_id INT NOT NULL,
  tipo_combustible_id INT NOT NULL,
  provincia_id INT NOT NULL,
  observaciones TEXT NULL,
  foto_path VARCHAR(255) NOT NULL,
  estado ENUM('activa','anulada') NOT NULL DEFAULT 'activa',
  motivo_anulacion TEXT NULL,
  anulada_por_cuil CHAR(13) NULL,
  anulada_en DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_carga_comb_cargador (cargado_por_cuil, fecha_carga),
  INDEX idx_carga_comb_movil (movil_id, fecha_carga),
  CONSTRAINT fk_carga_comb_movil FOREIGN KEY (movil_id) REFERENCES sth_moviles(id),
  CONSTRAINT fk_carga_comb_estacion FOREIGN KEY (estacion_id) REFERENCES sth_estaciones_servicio(id),
  CONSTRAINT fk_carga_comb_tipo FOREIGN KEY (tipo_combustible_id) REFERENCES sth_tipos_combustible(id),
  CONSTRAINT fk_carga_comb_provincia FOREIGN KEY (provincia_id) REFERENCES sth_provincias(id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE sth_carga_combustible_tareas (
  carga_id INT NOT NULL,
  tarea_id INT NOT NULL,
  PRIMARY KEY (carga_id, tarea_id),
  CONSTRAINT fk_cct_carga FOREIGN KEY (carga_id) REFERENCES sth_cargas_combustible(id),
  CONSTRAINT fk_cct_tarea FOREIGN KEY (tarea_id) REFERENCES sth_tareas_catalogo(id)
) DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 4: Aplicar el DDL en la BD de desarrollo** (a mano, con el cliente MySQL habitual) y verificar con `SHOW TABLES LIKE 'sth_%combustible%';` (deben aparecer 3 tablas) y `SHOW COLUMNS FROM sth_auditoria LIKE 'accion';` (el enum incluye `anular`).

- [ ] **Step 5: Compilar y commitear**

Run: `npx tsc --noEmit`
Expected: sin errores.

```bash
git add prisma/schema.prisma docs/sql/2026-07-30-cargas-combustible.sql
git commit -m "feat(combustible): schema Prisma y DDL de cargas de combustible (ADR-013)"
```

---

### Task 2: Catálogos nuevos — Estaciones de servicio y Tipos de combustible (backend)

**Files:**
- Create: `src/admin/dto/catalogo-combustible.dto.ts`
- Modify: `src/admin/admin.service.ts`, `src/admin/admin.controller.ts`
- Modify: `src/catalogos/catalogos.service.ts`, `src/catalogos/catalogos.controller.ts`
- Test: `src/admin/admin-combustible.spec.ts`

**Interfaces:**
- Consumes: modelos `EstacionServicio`, `TipoCombustible` (Task 1).
- Produces: `GET /catalogos/estaciones-servicio` y `GET /catalogos/tipos-combustible` → `{ id: number; nombre: string }[]` (solo activos, orden alfabético; estaciones incluyen `localidad: string | null`). Admin: `GET|POST /admin/estaciones-servicio`, `PATCH /admin/estaciones-servicio/:id`, `PATCH /admin/estaciones-servicio/:id/activo` e ídem `/admin/tipos-combustible`. El frontend (Tasks 8–9) consume exactamente estas rutas.

- [ ] **Step 1: Escribir el test que falla**

`src/admin/admin-combustible.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminService — catálogos de combustible', () => {
  const prismaMock = {
    estacionServicio: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    tipoCombustible: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  } as unknown as PrismaService;
  let service: AdminService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [AdminService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(AdminService);
  });

  it('crea una estación de servicio', async () => {
    (prismaMock.estacionServicio.create as jest.Mock).mockResolvedValue({ id: 1, nombre: 'YPF Centenario', localidad: null, activo: true });
    const r = await service.crearEstacionServicio({ nombre: 'YPF Centenario' });
    expect(prismaMock.estacionServicio.create).toHaveBeenCalledWith({ data: { nombre: 'YPF Centenario', localidad: undefined } });
    expect(r.id).toBe(1);
  });

  it('togglea activo de un tipo de combustible', async () => {
    (prismaMock.tipoCombustible.update as jest.Mock).mockResolvedValue({ id: 2, nombre: 'GNC', activo: false });
    await service.toggleTipoCombustible(2, false);
    expect(prismaMock.tipoCombustible.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { activo: false } });
  });
});
```

Nota: si `AdminService` tiene otras dependencias inyectadas además de `PrismaService`, agregarlas al testing module con mocks vacíos (`{ provide: X, useValue: {} }`).

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- admin-combustible`
Expected: FAIL — `crearEstacionServicio is not a function`.

- [ ] **Step 3: Implementar DTOs, service y controllers**

`src/admin/dto/catalogo-combustible.dto.ts`:

```ts
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEstacionServicioDto {
  @IsString() @IsNotEmpty() @MaxLength(191) nombre: string;
  @IsOptional() @IsString() @MaxLength(191) localidad?: string;
}
export class UpdateEstacionServicioDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) nombre?: string;
  @IsOptional() @IsString() @MaxLength(191) localidad?: string;
}
export class CreateTipoCombustibleDto {
  @IsString() @IsNotEmpty() @MaxLength(191) nombre: string;
}
export class UpdateTipoCombustibleDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) nombre?: string;
}
export class ToggleActivoCombustibleDto {
  @IsBoolean() activo: boolean;
}
```

En `src/admin/admin.service.ts` (mismo patrón que los catálogos existentes):

```ts
// --- Estaciones de servicio (ADR-013) ---
getEstacionesServicio() {
  return this.prisma.estacionServicio.findMany({ orderBy: { nombre: 'asc' } });
}
crearEstacionServicio(dto: { nombre: string; localidad?: string }) {
  return this.prisma.estacionServicio.create({ data: { nombre: dto.nombre, localidad: dto.localidad } });
}
actualizarEstacionServicio(id: number, dto: { nombre?: string; localidad?: string }) {
  return this.prisma.estacionServicio.update({ where: { id }, data: dto });
}
toggleEstacionServicio(id: number, activo: boolean) {
  return this.prisma.estacionServicio.update({ where: { id }, data: { activo } });
}
// --- Tipos de combustible (ADR-013) ---
getTiposCombustible() {
  return this.prisma.tipoCombustible.findMany({ orderBy: { nombre: 'asc' } });
}
crearTipoCombustible(dto: { nombre: string }) {
  return this.prisma.tipoCombustible.create({ data: { nombre: dto.nombre } });
}
actualizarTipoCombustible(id: number, dto: { nombre?: string }) {
  return this.prisma.tipoCombustible.update({ where: { id }, data: dto });
}
toggleTipoCombustible(id: number, activo: boolean) {
  return this.prisma.tipoCombustible.update({ where: { id }, data: { activo } });
}
```

En `src/admin/admin.controller.ts` (dentro de la clase, hereda `@Roles('Admin')` de la clase):

```ts
@Get('estaciones-servicio') getEstacionesServicio() { return this.adminService.getEstacionesServicio(); }
@Post('estaciones-servicio') crearEstacionServicio(@Body() dto: CreateEstacionServicioDto) { return this.adminService.crearEstacionServicio(dto); }
@Patch('estaciones-servicio/:id') actualizarEstacionServicio(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEstacionServicioDto) { return this.adminService.actualizarEstacionServicio(id, dto); }
@Patch('estaciones-servicio/:id/activo') toggleEstacionServicio(@Param('id', ParseIntPipe) id: number, @Body() dto: ToggleActivoCombustibleDto) { return this.adminService.toggleEstacionServicio(id, dto.activo); }

@Get('tipos-combustible') getTiposCombustible() { return this.adminService.getTiposCombustible(); }
@Post('tipos-combustible') crearTipoCombustible(@Body() dto: CreateTipoCombustibleDto) { return this.adminService.crearTipoCombustible(dto); }
@Patch('tipos-combustible/:id') actualizarTipoCombustible(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTipoCombustibleDto) { return this.adminService.actualizarTipoCombustible(id, dto); }
@Patch('tipos-combustible/:id/activo') toggleTipoCombustible(@Param('id', ParseIntPipe) id: number, @Body() dto: ToggleActivoCombustibleDto) { return this.adminService.toggleTipoCombustible(id, dto.activo); }
```

En `src/catalogos/catalogos.service.ts` y su controller (solo lectura, solo activos):

```ts
// service
getEstacionesServicio() {
  return this.prisma.estacionServicio.findMany({ where: { activo: true }, select: { id: true, nombre: true, localidad: true }, orderBy: { nombre: 'asc' } });
}
getTiposCombustible() {
  return this.prisma.tipoCombustible.findMany({ where: { activo: true }, select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } });
}
// controller
@Get('estaciones-servicio') getEstacionesServicio() { return this.catalogosService.getEstacionesServicio(); }
@Get('tipos-combustible') getTiposCombustible() { return this.catalogosService.getTiposCombustible(); }
```

- [ ] **Step 4: Correr los tests y compilar**

Run: `npm test -- admin-combustible && npx tsc --noEmit`
Expected: PASS, sin errores de tipos.

- [ ] **Step 5: Commit**

```bash
git add src/admin src/catalogos
git commit -m "feat(combustible): catálogos de estaciones de servicio y tipos de combustible"
```

---

### Task 3: Servicio de storage de tickets (filesystem, abstraído)

**Files:**
- Create: `src/cargas-combustible/storage/ticket-storage.interface.ts`
- Create: `src/cargas-combustible/storage/fs-ticket-storage.service.ts`
- Test: `src/cargas-combustible/storage/fs-ticket-storage.spec.ts`
- Modify: `.env.example` (agregar `TICKETS_DIR=./storage/tickets`)

**Interfaces:**
- Produces (Tasks 4, 5, 6 y 7 dependen de esto):

```ts
export interface TicketStorage {
  guardar(buffer: Buffer, mimetype: 'image/jpeg' | 'image/png'): Promise<string>; // → path relativo p.ej. "2026/07/<uuid>.jpg"
  leer(path: string): Promise<{ buffer: Buffer; mimetype: string }>;
  borrar(path: string): Promise<void>;
}
export const TICKET_STORAGE = 'TICKET_STORAGE';
```

- [ ] **Step 1: Escribir el test que falla**

`src/cargas-combustible/storage/fs-ticket-storage.spec.ts`:

```ts
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FsTicketStorage } from './fs-ticket-storage.service';

describe('FsTicketStorage', () => {
  let dir: string;
  let storage: FsTicketStorage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tickets-'));
    storage = new FsTicketStorage(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('guarda y lee un jpeg, devolviendo path relativo año/mes', async () => {
    const path = await storage.guardar(Buffer.from('foto-fake'), 'image/jpeg');
    expect(path).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
    const { buffer, mimetype } = await storage.leer(path);
    expect(buffer.toString()).toBe('foto-fake');
    expect(mimetype).toBe('image/jpeg');
  });

  it('rechaza paths con traversal', async () => {
    await expect(storage.leer('../../etc/passwd')).rejects.toThrow();
  });

  it('borra un archivo', async () => {
    const path = await storage.guardar(Buffer.from('x'), 'image/png');
    await storage.borrar(path);
    await expect(storage.leer(path)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- fs-ticket-storage`
Expected: FAIL — módulo `./fs-ticket-storage.service` inexistente.

- [ ] **Step 3: Implementar**

`src/cargas-combustible/storage/ticket-storage.interface.ts`: el bloque de "Interfaces" de arriba, literal.

`src/cargas-combustible/storage/fs-ticket-storage.service.ts`:

```ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { randomUUID } from 'crypto';
import { TicketStorage } from './ticket-storage.interface';

const EXT_POR_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const MIME_POR_EXT: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png' };

@Injectable()
export class FsTicketStorage implements TicketStorage {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolve(baseDir ?? process.env.TICKETS_DIR ?? './storage/tickets');
  }

  private resolverSeguro(path: string): string {
    const absoluto = resolve(this.baseDir, path);
    if (!absoluto.startsWith(this.baseDir + sep)) throw new BadRequestException('Path inválido');
    return absoluto;
  }

  async guardar(buffer: Buffer, mimetype: 'image/jpeg' | 'image/png'): Promise<string> {
    const ext = EXT_POR_MIME[mimetype];
    if (!ext) throw new BadRequestException('Formato de imagen no soportado');
    const ahora = new Date();
    const subdir = `${ahora.getFullYear()}/${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    const relativo = `${subdir}/${randomUUID()}.${ext}`;
    await mkdir(join(this.baseDir, subdir), { recursive: true });
    await writeFile(this.resolverSeguro(relativo), buffer);
    return relativo;
  }

  async leer(path: string): Promise<{ buffer: Buffer; mimetype: string }> {
    const absoluto = this.resolverSeguro(path);
    try {
      const buffer = await readFile(absoluto);
      const ext = path.split('.').pop() ?? '';
      return { buffer, mimetype: MIME_POR_EXT[ext] ?? 'application/octet-stream' };
    } catch {
      throw new NotFoundException('Ticket no encontrado');
    }
  }

  async borrar(path: string): Promise<void> {
    await unlink(this.resolverSeguro(path)).catch(() => undefined);
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- fs-ticket-storage`
Expected: PASS (3 tests).

- [ ] **Step 5: Agregar `TICKETS_DIR=./storage/tickets` a `.env.example`, `storage/` a `.gitignore`, y commit**

```bash
git add src/cargas-combustible/storage .env.example .gitignore
git commit -m "feat(combustible): storage de tickets en filesystem tras interfaz TicketStorage"
```

---

### Task 4: Módulo cargas-combustible — creación con foto y último km

**Files:**
- Create: `src/cargas-combustible/dto/create-carga-combustible.dto.ts`
- Create: `src/cargas-combustible/cargas-combustible.service.ts`
- Create: `src/cargas-combustible/cargas-combustible.controller.ts`
- Create: `src/cargas-combustible/cargas-combustible.module.ts`
- Modify: `src/app.module.ts` (import del módulo), `package.json` (dev dep `@types/multer`)
- Test: `src/cargas-combustible/cargas-combustible.service.spec.ts`

**Interfaces:**
- Consumes: `TICKET_STORAGE`/`TicketStorage` (Task 3), modelos Prisma (Task 1).
- Produces:
  - `POST /cargas-combustible` — multipart (`foto` file + campos string) — Roles `JefeCuadrilla`,`Admin` → carga creada (JSON, incluye `id`).
  - `GET /cargas-combustible/ultimo-km?movilId=N` → `{ km: number | null, fechaCarga: string | null }`.
  - `CargasCombustibleService.crear(dto: CreateCargaCombustibleDto, foto: { buffer: Buffer; mimetype: string }, cuil: string)` y `ultimoKm(movilId: number)` — usados por Tasks 5–6.

- [ ] **Step 1: Instalar tipos de multer**

Run: `npm i -D @types/multer`
(`multer` en runtime ya viene con `@nestjs/platform-express`.)

- [ ] **Step 2: Escribir el test que falla**

`src/cargas-combustible/cargas-combustible.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { CargasCombustibleService } from './cargas-combustible.service';
import { PrismaService } from '../prisma/prisma.service';
import { TICKET_STORAGE } from './storage/ticket-storage.interface';

const dtoBase = {
  fechaCarga: '2026-07-30', movilId: 1, litros: 40.5, monto: 52000, km: 123456,
  medioPago: 'caja' as const, nroComprobante: 'FC 0001-00001234',
  estacionId: 1, tipoCombustibleId: 2, provinciaId: 1, tareaIds: [10, 20],
};
const foto = { buffer: Buffer.from('img'), mimetype: 'image/jpeg' as const };

describe('CargasCombustibleService', () => {
  const prismaMock: any = {
    tareaCatalogo: { findMany: jest.fn() },
    contratoHabilitado: { findMany: jest.fn() },
    cargaCombustible: { create: jest.fn(), findFirst: jest.fn() },
    auditoria: { create: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(prismaMock)),
  };
  const storageMock = { guardar: jest.fn().mockResolvedValue('2026/07/uuid.jpg'), leer: jest.fn(), borrar: jest.fn() };
  let service: CargasCombustibleService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        CargasCombustibleService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TICKET_STORAGE, useValue: storageMock },
      ],
    }).compile();
    service = mod.get(CargasCombustibleService);
  });

  it('crea la carga con foto, tareas y auditoría', async () => {
    prismaMock.tareaCatalogo.findMany.mockResolvedValue([{ id: 10, contratoId: 5 }, { id: 20, contratoId: 7 }]);
    prismaMock.contratoHabilitado.findMany.mockResolvedValue([{ contratoId: 5 }, { contratoId: 7 }]);
    prismaMock.cargaCombustible.create.mockResolvedValue({ id: 99 });
    const r = await service.crear(dtoBase, foto, '20-11111111-1');
    expect(storageMock.guardar).toHaveBeenCalledWith(foto.buffer, 'image/jpeg');
    expect(prismaMock.cargaCombustible.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        cargadoPorCuil: '20-11111111-1', fotoPath: '2026/07/uuid.jpg',
        tareas: { createMany: { data: [{ tareaId: 10 }, { tareaId: 20 }] } },
      }),
    }));
    expect(prismaMock.auditoria.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tabla: 'sth_cargas_combustible', registroId: 99, accion: 'crear' }),
    }));
    expect(r.id).toBe(99);
  });

  it('rechaza tareas de contratos no habilitados', async () => {
    prismaMock.tareaCatalogo.findMany.mockResolvedValue([{ id: 10, contratoId: 5 }, { id: 20, contratoId: 7 }]);
    prismaMock.contratoHabilitado.findMany.mockResolvedValue([{ contratoId: 5 }]); // el 7 no está habilitado
    await expect(service.crear(dtoBase, foto, '20-11111111-1')).rejects.toThrow(ForbiddenException);
    expect(storageMock.guardar).not.toHaveBeenCalled();
  });

  it('ultimoKm devuelve el km de la última carga activa del móvil', async () => {
    prismaMock.cargaCombustible.findFirst.mockResolvedValue({ km: 120000, fechaCarga: new Date('2026-07-20') });
    const r = await service.ultimoKm(1);
    expect(prismaMock.cargaCombustible.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { movilId: 1, estado: 'activa' },
      orderBy: [{ fechaCarga: 'desc' }, { id: 'desc' }],
    }));
    expect(r.km).toBe(120000);
  });

  it('ultimoKm devuelve null si el móvil no tiene cargas', async () => {
    prismaMock.cargaCombustible.findFirst.mockResolvedValue(null);
    expect(await service.ultimoKm(1)).toEqual({ km: null, fechaCarga: null });
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npm test -- cargas-combustible.service`
Expected: FAIL — módulo inexistente.

- [ ] **Step 4: Implementar DTO, service, controller y module**

`src/cargas-combustible/dto/create-carga-combustible.dto.ts`:

```ts
import { Transform, Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';

export class CreateCargaCombustibleDto {
  @IsDateString() fechaCarga: string;
  @Type(() => Number) @IsInt() movilId: number;
  @Type(() => Number) @IsPositive() litros: number;
  @Type(() => Number) @IsPositive() monto: number;
  @Type(() => Number) @IsInt() @Min(0) km: number;
  @IsIn(['cuenta_corriente', 'caja']) medioPago: 'cuenta_corriente' | 'caja';
  @IsString() @IsNotEmpty() @MaxLength(50) nroComprobante: string;
  @Type(() => Number) @IsInt() estacionId: number;
  @Type(() => Number) @IsInt() tipoCombustibleId: number;
  @Type(() => Number) @IsInt() provinciaId: number;
  @IsOptional() @IsString() observaciones?: string;
  @Transform(({ value }) => (typeof value === 'string' ? JSON.parse(value) : value))
  @IsArray() @ArrayNotEmpty() @IsInt({ each: true }) tareaIds: number[];
}
```

`src/cargas-combustible/cargas-combustible.service.ts`:

```ts
import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TICKET_STORAGE, TicketStorage } from './storage/ticket-storage.interface';
import { CreateCargaCombustibleDto } from './dto/create-carga-combustible.dto';

@Injectable()
export class CargasCombustibleService {
  constructor(
    private prisma: PrismaService,
    @Inject(TICKET_STORAGE) private storage: TicketStorage,
  ) {}

  private async validarTareasHabilitadas(tareaIds: number[], cuil: string): Promise<void> {
    const tareas = await this.prisma.tareaCatalogo.findMany({ where: { id: { in: tareaIds } }, select: { id: true, contratoId: true } });
    if (tareas.length !== tareaIds.length) throw new BadRequestException('Alguna tarea no existe');
    const habilitados = await this.prisma.contratoHabilitado.findMany({ where: { usuarioCuil: cuil }, select: { contratoId: true } });
    const set = new Set(habilitados.map((h) => h.contratoId));
    if (tareas.some((t) => !set.has(t.contratoId))) throw new ForbiddenException('Tarea de un contrato no habilitado');
  }

  async crear(dto: CreateCargaCombustibleDto, foto: { buffer: Buffer; mimetype: string }, cuil: string) {
    await this.validarTareasHabilitadas(dto.tareaIds, cuil);
    if (foto.mimetype !== 'image/jpeg' && foto.mimetype !== 'image/png') throw new BadRequestException('La foto debe ser JPEG o PNG');
    const fotoPath = await this.storage.guardar(foto.buffer, foto.mimetype);
    return this.prisma.$transaction(async (tx) => {
      const carga = await tx.cargaCombustible.create({
        data: {
          fechaCarga: new Date(dto.fechaCarga), cargadoPorCuil: cuil, movilId: dto.movilId,
          litros: dto.litros, monto: dto.monto, km: dto.km, medioPago: dto.medioPago,
          nroComprobante: dto.nroComprobante, estacionId: dto.estacionId,
          tipoCombustibleId: dto.tipoCombustibleId, provinciaId: dto.provinciaId,
          observaciones: dto.observaciones, fotoPath,
          tareas: { createMany: { data: dto.tareaIds.map((tareaId) => ({ tareaId })) } },
        },
      });
      await tx.auditoria.create({ data: { tabla: 'sth_cargas_combustible', registroId: carga.id, usuarioCuil: cuil, accion: 'crear' } });
      return carga;
    });
  }

  async ultimoKm(movilId: number) {
    const ultima = await this.prisma.cargaCombustible.findFirst({
      where: { movilId, estado: 'activa' },
      orderBy: [{ fechaCarga: 'desc' }, { id: 'desc' }],
      select: { km: true, fechaCarga: true },
    });
    return ultima ? { km: ultima.km, fechaCarga: ultima.fechaCarga } : { km: null, fechaCarga: null };
  }
}
```

`src/cargas-combustible/cargas-combustible.controller.ts`:

```ts
import { Body, Controller, Get, ParseIntPipe, Post, Query, Request, UploadedFile, UseGuards, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CargasCombustibleService } from './cargas-combustible.service';
import { CreateCargaCombustibleDto } from './dto/create-carga-combustible.dto';

const MAX_FOTO_BYTES = 5 * 1024 * 1024;

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('cargas-combustible')
export class CargasCombustibleController {
  constructor(private readonly service: CargasCombustibleService) {}

  @Post()
  @Roles('JefeCuadrilla', 'Admin')
  @UseInterceptors(FileInterceptor('foto', { limits: { fileSize: MAX_FOTO_BYTES } }))
  crear(@UploadedFile() foto: Express.Multer.File | undefined, @Body() dto: CreateCargaCombustibleDto, @Request() req) {
    if (!foto) throw new BadRequestException('La foto del ticket es obligatoria');
    return this.service.crear(dto, { buffer: foto.buffer, mimetype: foto.mimetype }, req.user.cuil);
  }

  @Get('ultimo-km')
  @Roles('JefeCuadrilla', 'Admin')
  ultimoKm(@Query('movilId', ParseIntPipe) movilId: number) {
    return this.service.ultimoKm(movilId);
  }
}
```

`src/cargas-combustible/cargas-combustible.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CargasCombustibleController } from './cargas-combustible.controller';
import { CargasCombustibleService } from './cargas-combustible.service';
import { FsTicketStorage } from './storage/fs-ticket-storage.service';
import { TICKET_STORAGE } from './storage/ticket-storage.interface';

@Module({
  controllers: [CargasCombustibleController],
  providers: [CargasCombustibleService, { provide: TICKET_STORAGE, useClass: FsTicketStorage }],
})
export class CargasCombustibleModule {}
```

Registrar `CargasCombustibleModule` en los imports de `src/app.module.ts`.

- [ ] **Step 5: Correr tests y compilar**

Run: `npm test -- cargas-combustible.service && npx tsc --noEmit`
Expected: PASS (4 tests), sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/cargas-combustible src/app.module.ts package.json package-lock.json
git commit -m "feat(combustible): alta de carga con foto obligatoria y último km por móvil"
```

---

### Task 5: Listado con alcance por rol, detalle y foto del ticket

**Files:**
- Create: `src/cargas-combustible/dto/filtro-cargas.dto.ts`
- Modify: `src/cargas-combustible/cargas-combustible.service.ts`, `src/cargas-combustible/cargas-combustible.controller.ts`
- Test: `src/cargas-combustible/cargas-combustible.service.spec.ts` (agregar describe)

**Interfaces:**
- Consumes: service y storage de Tasks 3–4.
- Produces:
  - `GET /cargas-combustible?desde&hasta&movilId&estado` — Roles `JefeCuadrilla`,`JefeContrato`,`Admin` → lista con relaciones (`movil`, `estacion`, `tipoCombustible`, `provincia`, `tareas.tarea.contrato`).
  - `GET /cargas-combustible/:id` → detalle (misma forma).
  - `GET /cargas-combustible/:id/ticket` → la imagen (Content-Type según archivo).
  - `service.listar(filtro, usuario)`, `service.detalle(id, usuario)`, `service.ticket(id, usuario)` con `usuario = { cuil: string; rol: string }` — Task 6 reutiliza el mismo control de acceso vía `service.detalle`.
- Regla de alcance: `JefeCuadrilla` → solo `cargadoPorCuil = cuil`; `JefeContrato` → cargas con ≥1 tarea de un contrato del que es jefe (`ContratoJefe`); `Admin` → todas.

- [ ] **Step 1: Agregar tests que fallan**

En `cargas-combustible.service.spec.ts` agregar al mock: `cargaCombustible.findMany: jest.fn()`, `cargaCombustible.findUnique: jest.fn()`, `contratoJefe: { findMany: jest.fn() }`, y:

```ts
describe('listar / detalle / ticket', () => {
  it('JefeCuadrilla solo ve sus propias cargas', async () => {
    prismaMock.cargaCombustible.findMany.mockResolvedValue([]);
    await service.listar({}, { cuil: '20-1-1', rol: 'JefeCuadrilla' });
    expect(prismaMock.cargaCombustible.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ cargadoPorCuil: '20-1-1' }),
    }));
  });

  it('JefeContrato ve cargas con tareas de sus contratos', async () => {
    prismaMock.contratoJefe.findMany.mockResolvedValue([{ contratoId: 5 }]);
    prismaMock.cargaCombustible.findMany.mockResolvedValue([]);
    await service.listar({}, { cuil: '20-2-2', rol: 'JefeContrato' });
    expect(prismaMock.cargaCombustible.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tareas: { some: { tarea: { contratoId: { in: [5] } } } } }),
    }));
  });

  it('detalle niega acceso a un JefeCuadrilla ajeno', async () => {
    prismaMock.cargaCombustible.findUnique.mockResolvedValue({ id: 1, cargadoPorCuil: 'otro', tareas: [] });
    await expect(service.detalle(1, { cuil: '20-1-1', rol: 'JefeCuadrilla' })).rejects.toThrow(ForbiddenException);
  });

  it('ticket devuelve el buffer del storage', async () => {
    prismaMock.cargaCombustible.findUnique.mockResolvedValue({ id: 1, cargadoPorCuil: '20-1-1', fotoPath: '2026/07/a.jpg', tareas: [] });
    storageMock.leer.mockResolvedValue({ buffer: Buffer.from('img'), mimetype: 'image/jpeg' });
    const r = await service.ticket(1, { cuil: '20-1-1', rol: 'JefeCuadrilla' });
    expect(storageMock.leer).toHaveBeenCalledWith('2026/07/a.jpg');
    expect(r.mimetype).toBe('image/jpeg');
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- cargas-combustible.service`
Expected: FAIL — `listar is not a function`.

- [ ] **Step 3: Implementar**

`src/cargas-combustible/dto/filtro-cargas.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional } from 'class-validator';

export class FiltroCargasDto {
  @IsOptional() @IsDateString() desde?: string;
  @IsOptional() @IsDateString() hasta?: string;
  @IsOptional() @Type(() => Number) @IsInt() movilId?: number;
  @IsOptional() @IsIn(['activa', 'anulada']) estado?: 'activa' | 'anulada';
}
```

En el service:

```ts
private readonly includeDetalle = {
  movil: { select: { id: true, identificador: true } },
  estacion: { select: { id: true, nombre: true } },
  tipoCombustible: { select: { id: true, nombre: true } },
  provincia: { select: { id: true, nombre: true } },
  tareas: { include: { tarea: { select: { id: true, nombre: true, contrato: { select: { id: true, codigo: true } } } } } },
} as const;

private async whereAlcance(usuario: { cuil: string; rol: string }) {
  if (usuario.rol === 'Admin') return {};
  if (usuario.rol === 'JefeContrato') {
    const contratos = await this.prisma.contratoJefe.findMany({ where: { usuarioCuil: usuario.cuil }, select: { contratoId: true } });
    return { tareas: { some: { tarea: { contratoId: { in: contratos.map((c) => c.contratoId) } } } } };
  }
  return { cargadoPorCuil: usuario.cuil };
}

async listar(filtro: FiltroCargasDto, usuario: { cuil: string; rol: string }) {
  const alcance = await this.whereAlcance(usuario);
  return this.prisma.cargaCombustible.findMany({
    where: {
      ...alcance,
      ...(filtro.desde || filtro.hasta ? { fechaCarga: { ...(filtro.desde && { gte: new Date(filtro.desde) }), ...(filtro.hasta && { lte: new Date(filtro.hasta) }) } } : {}),
      ...(filtro.movilId && { movilId: filtro.movilId }),
      ...(filtro.estado && { estado: filtro.estado }),
    },
    include: this.includeDetalle,
    orderBy: [{ fechaCarga: 'desc' }, { id: 'desc' }],
  });
}

private async puedeVer(carga: { cargadoPorCuil: string; tareas: { tarea?: { contratoId?: number } | null; tareaId?: number }[] }, usuario: { cuil: string; rol: string }) {
  if (usuario.rol === 'Admin') return true;
  if (usuario.rol === 'JefeContrato') {
    const contratos = await this.prisma.contratoJefe.findMany({ where: { usuarioCuil: usuario.cuil }, select: { contratoId: true } });
    const set = new Set(contratos.map((c) => c.contratoId));
    const tareaIds = carga.tareas.map((t) => t.tareaId).filter((x): x is number => x !== undefined);
    const tareas = await this.prisma.tareaCatalogo.findMany({ where: { id: { in: tareaIds } }, select: { contratoId: true } });
    return tareas.some((t) => set.has(t.contratoId));
  }
  return carga.cargadoPorCuil === usuario.cuil;
}

async detalle(id: number, usuario: { cuil: string; rol: string }) {
  const carga = await this.prisma.cargaCombustible.findUnique({ where: { id }, include: this.includeDetalle });
  if (!carga) throw new NotFoundException('Carga de combustible no encontrada');
  if (!(await this.puedeVer(carga as any, usuario))) throw new ForbiddenException();
  return carga;
}

async ticket(id: number, usuario: { cuil: string; rol: string }) {
  const carga = await this.detalle(id, usuario);
  return this.storage.leer(carga.fotoPath);
}
```

(Importar `NotFoundException`. Nota: `detalle` con `includeDetalle` trae `tareas[].tareaId`, con eso trabaja `puedeVer`.)

En el controller (el orden importa: `ultimo-km` y otras rutas literales van ANTES de `:id`):

```ts
@Get()
@Roles('JefeCuadrilla', 'JefeContrato', 'Admin')
listar(@Query() filtro: FiltroCargasDto, @Request() req) {
  return this.service.listar(filtro, { cuil: req.user.cuil, rol: req.user.rol });
}

@Get(':id')
@Roles('JefeCuadrilla', 'JefeContrato', 'Admin')
detalle(@Param('id', ParseIntPipe) id: number, @Request() req) {
  return this.service.detalle(id, { cuil: req.user.cuil, rol: req.user.rol });
}

@Get(':id/ticket')
@Roles('JefeCuadrilla', 'JefeContrato', 'Admin')
async ticket(@Param('id', ParseIntPipe) id: number, @Request() req, @Res() res: Response) {
  const { buffer, mimetype } = await this.service.ticket(id, { cuil: req.user.cuil, rol: req.user.rol });
  res.setHeader('Content-Type', mimetype);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(buffer);
}
```

(`import { Res } from '@nestjs/common'` y `import type { Response } from 'express'`.)

- [ ] **Step 4: Correr tests y compilar**

Run: `npm test -- cargas-combustible.service && npx tsc --noEmit`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cargas-combustible
git commit -m "feat(combustible): listado por rol, detalle y descarga autenticada del ticket"
```

---

### Task 6: Edición y anulación con auditoría

**Files:**
- Create: `src/cargas-combustible/dto/update-carga-combustible.dto.ts`, `src/cargas-combustible/dto/anular-carga.dto.ts`
- Modify: `src/cargas-combustible/cargas-combustible.service.ts`, `src/cargas-combustible/cargas-combustible.controller.ts`
- Test: `src/cargas-combustible/cargas-combustible.service.spec.ts` (agregar describe)

**Interfaces:**
- Consumes: `service.detalle` (control de acceso, Task 5), storage (si se reemplaza foto).
- Produces:
  - `PATCH /cargas-combustible/:id` — multipart opcionalmente con `foto` nueva — Roles `JefeCuadrilla`,`Admin`. Solo el dueño (`cargadoPorCuil`) o Admin; solo cargas `activa`.
  - `PATCH /cargas-combustible/:id/anular` — body `{ motivo: string }` — mismas reglas de permiso.
- Reglas: editar audita `accion: 'editar'` con `valorAnterior`/`valorNuevo` (JSON de los campos cambiados); anular setea `estado: 'anulada'`, `motivoAnulacion`, `anuladaPorCuil`, `anuladaEn` y audita `accion: 'anular'`. La foto vieja NO se borra al reemplazar (respaldo: se conserva en disco; solo cambia `fotoPath`).

- [ ] **Step 1: Agregar tests que fallan**

```ts
describe('editar / anular', () => {
  const usuario = { cuil: '20-1-1', rol: 'JefeCuadrilla' };
  const cargaExistente = {
    id: 1, cargadoPorCuil: '20-1-1', estado: 'activa', litros: 40, monto: 50000, km: 100,
    fotoPath: '2026/07/a.jpg', tareas: [{ tareaId: 10 }],
  };

  beforeEach(() => {
    prismaMock.cargaCombustible.findUnique.mockResolvedValue(cargaExistente);
    prismaMock.cargaCombustible.update = jest.fn().mockResolvedValue({ ...cargaExistente, litros: 45 });
  });

  it('edita campos y audita el diff', async () => {
    await service.editar(1, { litros: 45 }, undefined, usuario);
    expect(prismaMock.cargaCombustible.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 }, data: expect.objectContaining({ litros: 45 }),
    }));
    expect(prismaMock.auditoria.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ accion: 'editar', registroId: 1 }),
    }));
  });

  it('rechaza editar una carga anulada', async () => {
    prismaMock.cargaCombustible.findUnique.mockResolvedValue({ ...cargaExistente, estado: 'anulada' });
    await expect(service.editar(1, { litros: 45 }, undefined, usuario)).rejects.toThrow(BadRequestException);
  });

  it('rechaza editar una carga ajena (no Admin)', async () => {
    prismaMock.cargaCombustible.findUnique.mockResolvedValue({ ...cargaExistente, cargadoPorCuil: 'otro' });
    await expect(service.editar(1, { litros: 45 }, undefined, usuario)).rejects.toThrow(ForbiddenException);
  });

  it('anula con motivo y audita', async () => {
    await service.anular(1, 'Carga duplicada', usuario);
    expect(prismaMock.cargaCombustible.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 },
      data: expect.objectContaining({ estado: 'anulada', motivoAnulacion: 'Carga duplicada', anuladaPorCuil: '20-1-1' }),
    }));
    expect(prismaMock.auditoria.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ accion: 'anular' }),
    }));
  });
});
```

(Importar `BadRequestException` en el spec.)

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- cargas-combustible.service`
Expected: FAIL — `editar is not a function`.

- [ ] **Step 3: Implementar**

`dto/update-carga-combustible.dto.ts` — igual que el Create pero todo `@IsOptional()` (repetir los mismos decoradores campo a campo, sin `tareaIds` obligatorio):

```ts
import { Transform, Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';

export class UpdateCargaCombustibleDto {
  @IsOptional() @IsDateString() fechaCarga?: string;
  @IsOptional() @Type(() => Number) @IsInt() movilId?: number;
  @IsOptional() @Type(() => Number) @IsPositive() litros?: number;
  @IsOptional() @Type(() => Number) @IsPositive() monto?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) km?: number;
  @IsOptional() @IsIn(['cuenta_corriente', 'caja']) medioPago?: 'cuenta_corriente' | 'caja';
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(50) nroComprobante?: string;
  @IsOptional() @Type(() => Number) @IsInt() estacionId?: number;
  @IsOptional() @Type(() => Number) @IsInt() tipoCombustibleId?: number;
  @IsOptional() @Type(() => Number) @IsInt() provinciaId?: number;
  @IsOptional() @IsString() observaciones?: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? JSON.parse(value) : value))
  @IsArray() @ArrayNotEmpty() @IsInt({ each: true }) tareaIds?: number[];
}
```

`dto/anular-carga.dto.ts`:

```ts
import { IsNotEmpty, IsString } from 'class-validator';
export class AnularCargaDto {
  @IsString() @IsNotEmpty() motivo: string;
}
```

En el service:

```ts
private puedeModificar(carga: { cargadoPorCuil: string; estado: string }, usuario: { cuil: string; rol: string }) {
  if (carga.estado !== 'activa') throw new BadRequestException('La carga está anulada');
  if (usuario.rol !== 'Admin' && carga.cargadoPorCuil !== usuario.cuil) throw new ForbiddenException();
}

async editar(id: number, dto: UpdateCargaCombustibleDto, foto: { buffer: Buffer; mimetype: string } | undefined, usuario: { cuil: string; rol: string }) {
  const carga = await this.prisma.cargaCombustible.findUnique({ where: { id }, include: { tareas: true } });
  if (!carga) throw new NotFoundException('Carga de combustible no encontrada');
  this.puedeModificar(carga, usuario);
  if (dto.tareaIds) await this.validarTareasHabilitadas(dto.tareaIds, usuario.rol === 'Admin' ? carga.cargadoPorCuil : usuario.cuil);

  const data: Record<string, unknown> = {};
  for (const campo of ['movilId', 'litros', 'monto', 'km', 'medioPago', 'nroComprobante', 'estacionId', 'tipoCombustibleId', 'provinciaId', 'observaciones'] as const) {
    if (dto[campo] !== undefined) data[campo] = dto[campo];
  }
  if (dto.fechaCarga !== undefined) data.fechaCarga = new Date(dto.fechaCarga);
  if (foto) {
    if (foto.mimetype !== 'image/jpeg' && foto.mimetype !== 'image/png') throw new BadRequestException('La foto debe ser JPEG o PNG');
    data.fotoPath = await this.storage.guardar(foto.buffer, foto.mimetype); // la anterior se conserva como respaldo
  }
  if (dto.tareaIds) data.tareas = { deleteMany: {}, createMany: { data: dto.tareaIds.map((tareaId) => ({ tareaId })) } };

  return this.prisma.$transaction(async (tx) => {
    const actualizada = await tx.cargaCombustible.update({ where: { id }, data });
    await tx.auditoria.create({ data: {
      tabla: 'sth_cargas_combustible', registroId: id, usuarioCuil: usuario.cuil, accion: 'editar',
      valorAnterior: JSON.stringify({ litros: carga.litros, monto: carga.monto, km: carga.km, fotoPath: carga.fotoPath, tareaIds: carga.tareas.map((t) => t.tareaId) }),
      valorNuevo: JSON.stringify({ ...data, tareas: undefined, tareaIds: dto.tareaIds }),
    }});
    return actualizada;
  });
}

async anular(id: number, motivo: string, usuario: { cuil: string; rol: string }) {
  const carga = await this.prisma.cargaCombustible.findUnique({ where: { id }, include: { tareas: true } });
  if (!carga) throw new NotFoundException('Carga de combustible no encontrada');
  this.puedeModificar(carga, usuario);
  return this.prisma.$transaction(async (tx) => {
    const anulada = await tx.cargaCombustible.update({ where: { id }, data: {
      estado: 'anulada', motivoAnulacion: motivo, anuladaPorCuil: usuario.cuil, anuladaEn: new Date(),
    }});
    await tx.auditoria.create({ data: {
      tabla: 'sth_cargas_combustible', registroId: id, usuarioCuil: usuario.cuil, accion: 'anular',
      campo: 'estado', valorAnterior: 'activa', valorNuevo: 'anulada',
    }});
    return anulada;
  });
}
```

En el controller:

```ts
@Patch(':id')
@Roles('JefeCuadrilla', 'Admin')
@UseInterceptors(FileInterceptor('foto', { limits: { fileSize: MAX_FOTO_BYTES } }))
editar(@Param('id', ParseIntPipe) id: number, @UploadedFile() foto: Express.Multer.File | undefined, @Body() dto: UpdateCargaCombustibleDto, @Request() req) {
  return this.service.editar(id, dto, foto && { buffer: foto.buffer, mimetype: foto.mimetype }, { cuil: req.user.cuil, rol: req.user.rol });
}

@Patch(':id/anular')
@Roles('JefeCuadrilla', 'Admin')
anular(@Param('id', ParseIntPipe) id: number, @Body() dto: AnularCargaDto, @Request() req) {
  return this.service.anular(id, dto.motivo, { cuil: req.user.cuil, rol: req.user.rol });
}
```

- [ ] **Step 4: Correr tests y compilar**

Run: `npm test -- cargas-combustible.service && npx tsc --noEmit`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cargas-combustible
git commit -m "feat(combustible): edición con auditoría y anulación con motivo"
```

---

### Task 7: Extracción de datos del ticket con IA (API de Anthropic)

**Files:**
- Create: `src/cargas-combustible/extraccion-ticket.service.ts`
- Modify: `src/cargas-combustible/cargas-combustible.controller.ts`, `src/cargas-combustible/cargas-combustible.module.ts`
- Modify: `package.json` (`npm i @anthropic-ai/sdk`), `.env.example` (`ANTHROPIC_API_KEY=`)
- Test: `src/cargas-combustible/extraccion-ticket.service.spec.ts`

**Interfaces:**
- Consumes: catálogos activos (`estacionServicio.findMany`, `tipoCombustible.findMany`).
- Produces: `POST /cargas-combustible/extraer-ticket` — multipart `foto` — Roles `JefeCuadrilla`,`Admin` →

```ts
type ExtraccionTicket = {
  legible: boolean;
  sugerencias: null | {
    litros: number | null; monto: number | null; fechaCarga: string | null; // 'YYYY-MM-DD'
    nroComprobante: string | null; tipoCombustibleId: number | null; estacionId: number | null;
  };
};
```

El frontend (Task 10) consume exactamente esta forma. Sin `ANTHROPIC_API_KEY` o ante cualquier error de la API: `{ legible: false, sugerencias: null }` con HTTP 200 (degradación silenciosa — la IA es opcional por ADR-013).

- [ ] **Step 1: Instalar la SDK**

Run: `npm i @anthropic-ai/sdk`

- [ ] **Step 2: Escribir el test que falla**

`src/cargas-combustible/extraccion-ticket.service.spec.ts`:

```ts
import { ExtraccionTicketService } from './extraccion-ticket.service';
import { PrismaService } from '../prisma/prisma.service';

const foto = { buffer: Buffer.from('img'), mimetype: 'image/jpeg' as const };

describe('ExtraccionTicketService', () => {
  const prismaMock: any = {
    estacionServicio: { findMany: jest.fn().mockResolvedValue([{ id: 1, nombre: 'YPF Centenario' }]) },
    tipoCombustible: { findMany: jest.fn().mockResolvedValue([{ id: 2, nombre: 'Gasoil' }]) },
  };

  it('sin API key devuelve ilegible sin llamar a la API', async () => {
    const service = new ExtraccionTicketService(prismaMock as PrismaService, undefined);
    expect(await service.extraer(foto)).toEqual({ legible: false, sugerencias: null });
  });

  it('parsea la respuesta del modelo y matchea catálogos', async () => {
    const clienteMock = { messages: { create: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"legible":true,"litros":40.5,"monto":52000,"fecha":"2026-07-30","nroComprobante":"0001-00001234","tipoCombustible":"gasoil","estacion":"YPF Centenario"}' }],
    }) } };
    const service = new ExtraccionTicketService(prismaMock as PrismaService, clienteMock as any);
    const r = await service.extraer(foto);
    expect(r.legible).toBe(true);
    expect(r.sugerencias).toEqual({
      litros: 40.5, monto: 52000, fechaCarga: '2026-07-30',
      nroComprobante: '0001-00001234', tipoCombustibleId: 2, estacionId: 1,
    });
  });

  it('si la API tira error devuelve ilegible (degradación)', async () => {
    const clienteMock = { messages: { create: jest.fn().mockRejectedValue(new Error('overloaded')) } };
    const service = new ExtraccionTicketService(prismaMock as PrismaService, clienteMock as any);
    expect(await service.extraer(foto)).toEqual({ legible: false, sugerencias: null });
  });
});
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `npm test -- extraccion-ticket`
Expected: FAIL — módulo inexistente.

- [ ] **Step 4: Implementar**

`src/cargas-combustible/extraccion-ticket.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';

const PROMPT = `Analizá esta foto de un ticket/remito/factura de una estación de servicio argentina.
Respondé SOLO un JSON (sin markdown) con esta forma exacta:
{"legible": boolean, "litros": number|null, "monto": number|null, "fecha": "YYYY-MM-DD"|null, "nroComprobante": string|null, "tipoCombustible": string|null, "estacion": string|null}
- "legible": false solo si la imagen no es un comprobante de combustible o no se puede leer casi nada.
- "monto" es el total pagado en pesos, sin separador de miles, punto decimal.
- "nroComprobante" es el número de la factura o remito tal como figura.
- "tipoCombustible" y "estacion" tal como figuran impresos; null si no aparecen.
No inventes valores: ante la duda, null.`;

export type ExtraccionTicket = {
  legible: boolean;
  sugerencias: null | {
    litros: number | null; monto: number | null; fechaCarga: string | null;
    nroComprobante: string | null; tipoCombustibleId: number | null; estacionId: number | null;
  };
};

const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

@Injectable()
export class ExtraccionTicketService {
  private readonly logger = new Logger(ExtraccionTicketService.name);
  private readonly cliente?: Anthropic;

  constructor(private prisma: PrismaService, cliente?: Anthropic) {
    this.cliente = cliente ?? (process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : undefined);
  }

  async extraer(foto: { buffer: Buffer; mimetype: 'image/jpeg' | 'image/png' }): Promise<ExtraccionTicket> {
    if (!this.cliente) return { legible: false, sugerencias: null };
    try {
      const respuesta = await this.cliente.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: foto.mimetype, data: foto.buffer.toString('base64') } },
          { type: 'text', text: PROMPT },
        ]}],
      });
      const texto = respuesta.content.find((b) => b.type === 'text');
      if (!texto || texto.type !== 'text') return { legible: false, sugerencias: null };
      const json = JSON.parse(texto.text.replace(/^```json?\s*|\s*```$/g, ''));
      if (!json.legible) return { legible: false, sugerencias: null };

      const [estaciones, tipos] = await Promise.all([
        this.prisma.estacionServicio.findMany({ where: { activo: true }, select: { id: true, nombre: true } }),
        this.prisma.tipoCombustible.findMany({ where: { activo: true }, select: { id: true, nombre: true } }),
      ]);
      const matchear = (valor: string | null, catalogo: { id: number; nombre: string }[]) => {
        if (!valor) return null;
        const v = normalizar(valor);
        const hit = catalogo.find((c) => normalizar(c.nombre) === v)
          ?? catalogo.find((c) => v.includes(normalizar(c.nombre)) || normalizar(c.nombre).includes(v));
        return hit?.id ?? null;
      };
      return { legible: true, sugerencias: {
        litros: typeof json.litros === 'number' ? json.litros : null,
        monto: typeof json.monto === 'number' ? json.monto : null,
        fechaCarga: typeof json.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(json.fecha) ? json.fecha : null,
        nroComprobante: typeof json.nroComprobante === 'string' ? json.nroComprobante : null,
        tipoCombustibleId: matchear(json.tipoCombustible ?? null, tipos),
        estacionId: matchear(json.estacion ?? null, estaciones),
      }};
    } catch (e) {
      this.logger.warn(`Extracción de ticket falló: ${e instanceof Error ? e.message : e}`);
      return { legible: false, sugerencias: null };
    }
  }
}
```

En el controller:

```ts
@Post('extraer-ticket')
@Roles('JefeCuadrilla', 'Admin')
@UseInterceptors(FileInterceptor('foto', { limits: { fileSize: MAX_FOTO_BYTES } }))
extraerTicket(@UploadedFile() foto: Express.Multer.File | undefined) {
  if (!foto || (foto.mimetype !== 'image/jpeg' && foto.mimetype !== 'image/png')) {
    throw new BadRequestException('La foto debe ser JPEG o PNG');
  }
  return this.extraccion.extraer({ buffer: foto.buffer, mimetype: foto.mimetype });
}
```

(inyectar `private readonly extraccion: ExtraccionTicketService` en el constructor; agregar `ExtraccionTicketService` a `providers` del módulo).

- [ ] **Step 5: Correr tests y compilar**

Run: `npm test -- extraccion-ticket && npx tsc --noEmit`
Expected: PASS (3 tests).

- [ ] **Step 6: Agregar `ANTHROPIC_API_KEY=` a `.env.example` y commit**

```bash
git add src/cargas-combustible package.json package-lock.json .env.example
git commit -m "feat(combustible): extracción de datos del ticket con visión (Anthropic, solo sugiere)"
```

---

### Task 8: Frontend — tipos, API hooks y navegación

**Files (repo Frontend, `.../Formulario_Horas/Frontend`):**
- Modify: `src/types/domain.ts`
- Create: `src/lib/api/combustible.ts`
- Modify: `src/components/layout/nav.ts`
- Test: `src/components/layout/nav.test.ts` (agregar casos)

**Interfaces:**
- Consumes: endpoints de Tasks 2, 4–7.
- Produces: tipos `CargaCombustible`, `ExtraccionTicket`; hooks `useEstacionesServicio`, `useTiposCombustible`, `useCargasCombustible(filtro)`, `useCargaCombustible(id)`, `useUltimoKm(movilId)`, `useCrearCargaCombustible`, `useEditarCargaCombustible`, `useAnularCargaCombustible`, `useExtraerTicket`; entrada de menú `Combustible` → `/combustible` para roles `JefeCuadrilla`, `JefeContrato`, `Admin`. Tasks 9–11 consumen esto.

- [ ] **Step 1: Agregar casos al test de navegación (fallan)**

En `src/components/layout/nav.test.ts`, siguiendo el patrón existente del archivo:

```ts
it('JefeCuadrilla ve Combustible', () => {
  expect(navForRole(perfilConRol('JefeCuadrilla')).map((i) => i.href)).toContain('/combustible');
});
it('JefeContrato ve Combustible', () => {
  expect(navForRole(perfilConRol('JefeContrato')).map((i) => i.href)).toContain('/combustible');
});
it('Operario NO ve Combustible', () => {
  expect(navForRole(perfilConRol('Operario')).map((i) => i.href)).not.toContain('/combustible');
});
```

(Usar el helper de perfil que ya use ese archivo; si se llama distinto, adaptar el nombre — el patrón está en los tests existentes del mismo archivo.)

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm test -- nav`
Expected: FAIL — `/combustible` no está en `NAV_ITEMS`.

- [ ] **Step 3: Implementar tipos, hooks y nav**

En `src/types/domain.ts`:

```ts
export type MedioPagoCombustible = 'cuenta_corriente' | 'caja';
export type EstadoCargaCombustible = 'activa' | 'anulada';
export interface EstacionServicio { id: number; nombre: string; localidad: string | null; activo?: boolean }
export interface TipoCombustible { id: number; nombre: string; activo?: boolean }
export interface CargaCombustible {
  id: number; fechaCarga: string; cargadoPorCuil: string;
  movil: { id: number; identificador: string };
  litros: string; monto: string; km: number; // Decimals de Prisma llegan como string
  medioPago: MedioPagoCombustible; nroComprobante: string;
  estacion: { id: number; nombre: string };
  tipoCombustible: { id: number; nombre: string };
  provincia: { id: number; nombre: string };
  observaciones: string | null; estado: EstadoCargaCombustible;
  motivoAnulacion: string | null;
  tareas: { tarea: { id: number; nombre: string; contrato: { id: number; codigo: string } } }[];
}
export interface ExtraccionTicket {
  legible: boolean;
  sugerencias: null | {
    litros: number | null; monto: number | null; fechaCarga: string | null;
    nroComprobante: string | null; tipoCombustibleId: number | null; estacionId: number | null;
  };
}
```

`src/lib/api/combustible.ts` (mismo patrón que `src/lib/api/catalogos.ts`/`admin.ts`):

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { CargaCombustible, EstacionServicio, ExtraccionTicket, TipoCombustible } from '@/types/domain';

export interface FiltroCargas { desde?: string; hasta?: string; movilId?: number; estado?: 'activa' | 'anulada' }

export function useEstacionesServicio() {
  return useQuery({ queryKey: ['estaciones-servicio'], queryFn: async () => (await api.get<EstacionServicio[]>('/catalogos/estaciones-servicio')).data });
}
export function useTiposCombustible() {
  return useQuery({ queryKey: ['tipos-combustible'], queryFn: async () => (await api.get<TipoCombustible[]>('/catalogos/tipos-combustible')).data });
}
export function useCargasCombustible(filtro: FiltroCargas) {
  return useQuery({ queryKey: ['cargas-combustible', filtro], queryFn: async () => (await api.get<CargaCombustible[]>('/cargas-combustible', { params: filtro })).data });
}
export function useCargaCombustible(id: number | null) {
  return useQuery({ queryKey: ['cargas-combustible', 'detalle', id], enabled: id !== null,
    queryFn: async () => (await api.get<CargaCombustible>(`/cargas-combustible/${id}`)).data });
}
export function useUltimoKm(movilId: number | null) {
  return useQuery({ queryKey: ['cargas-combustible', 'ultimo-km', movilId], enabled: movilId !== null,
    queryFn: async () => (await api.get<{ km: number | null; fechaCarga: string | null }>('/cargas-combustible/ultimo-km', { params: { movilId } })).data });
}
export function useCrearCargaCombustible() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => api.post<CargaCombustible>('/cargas-combustible', form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cargas-combustible'] }),
  });
}
export function useEditarCargaCombustible() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, form }: { id: number; form: FormData }) => api.patch<CargaCombustible>(`/cargas-combustible/${id}`, form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cargas-combustible'] }),
  });
}
export function useAnularCargaCombustible() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, motivo }: { id: number; motivo: string }) => api.patch(`/cargas-combustible/${id}/anular`, { motivo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cargas-combustible'] }),
  });
}
export function useExtraerTicket() {
  return useMutation({
    mutationFn: async (foto: Blob) => {
      const form = new FormData();
      form.append('foto', foto, 'ticket.jpg');
      return (await api.post<ExtraccionTicket>('/cargas-combustible/extraer-ticket', form)).data;
    },
  });
}
export function urlTicket(id: number) { return `/cargas-combustible/${id}/ticket`; } // usar con api.get(..., { responseType: 'blob' })
```

En `src/components/layout/nav.ts`, agregar a `NAV_ITEMS` (en la posición que le corresponda visualmente, después de los ítems de horas):

```ts
{ label: 'Combustible', href: '/combustible', roles: ['JefeCuadrilla', 'JefeContrato', 'Admin'] },
```

Y en `src/lib/auth/guards.ts` verificar que `/combustible` quede cubierto por `canAccess` (si la lista de rutas es la misma `NAV_ITEMS`, no hay nada extra que hacer; si hay una lista aparte, agregar la ruta con los mismos roles).

- [ ] **Step 4: Correr tests**

Run: `npm test -- nav`
Expected: PASS.

- [ ] **Step 5: Commit (en el repo Frontend)**

```bash
git add src/types/domain.ts src/lib/api/combustible.ts src/components/layout/nav.ts src/components/layout/nav.test.ts src/lib/auth/guards.ts
git commit -m "feat(combustible): tipos, hooks de API y entrada de menú"
```

---

### Task 9: Frontend — páginas admin de los catálogos nuevos

**Files (Frontend):**
- Create: `src/app/(protected)/admin/estaciones-servicio/page.tsx`
- Create: `src/app/(protected)/admin/tipos-combustible/page.tsx`
- Modify: `src/lib/api/admin.ts` (hooks CRUD de ambos catálogos)
- Modify: la página índice de admin o el menú lateral de admin donde se listan los catálogos (mismo lugar donde aparece "Móviles")
- Test: `src/app/(protected)/admin/estaciones-servicio/estaciones-page.test.tsx`

**Interfaces:**
- Consumes: `GET|POST|PATCH /admin/estaciones-servicio*`, `/admin/tipos-combustible*` (Task 2).
- Produces: páginas espejo de `admin/moviles` (la referencia de patrón es `src/app/(protected)/admin/moviles/page.tsx` y su test `moviles-page.test.tsx`).

- [ ] **Step 1: Hooks admin.** En `src/lib/api/admin.ts`, siguiendo el patrón exacto de los hooks de móviles ya existentes:

```ts
export function useAdminEstacionesServicio() {
  return useQuery({ queryKey: ['admin', 'estaciones-servicio'], queryFn: async () => (await api.get<EstacionServicio[]>('/admin/estaciones-servicio')).data });
}
export function useCrearEstacionServicio() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (dto: { nombre: string; localidad?: string }) => api.post('/admin/estaciones-servicio', dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'estaciones-servicio'] }) });
}
export function useActualizarEstacionServicio() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...dto }: { id: number; nombre?: string; localidad?: string }) => api.patch(`/admin/estaciones-servicio/${id}`, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'estaciones-servicio'] }) });
}
export function useToggleEstacionServicio() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, activo }: { id: number; activo: boolean }) => api.patch(`/admin/estaciones-servicio/${id}/activo`, { activo }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'estaciones-servicio'] }) });
}
// Ídem exacto para tipos-combustible: useAdminTiposCombustible / useCrearTipoCombustible / useActualizarTipoCombustible / useToggleTipoCombustible
// con queryKey ['admin', 'tipos-combustible'] y rutas /admin/tipos-combustible*
```

- [ ] **Step 2: Test de página (falla).** Copiar la estructura de `moviles-page.test.tsx` (mocks de hooks, render con providers) adaptada: renderiza el listado con una estación mockeada, verifica que aparece el nombre y que el botón "Nueva estación" abre el form. 

- [ ] **Step 3: Implementar las dos páginas** clonando la estructura de `admin/moviles/page.tsx`: tabla (nombre, localidad si aplica, activo), alta con dialog, edición inline/dialog, switch de activo con `toast`. Textos: "Estaciones de servicio", "Nueva estación", "Tipos de combustible", "Nuevo tipo". Agregar ambas entradas donde el admin lista sus catálogos (mismo bloque que "Móviles").

- [ ] **Step 4: Correr tests**

Run: `npm test -- estaciones-page`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(protected\)/admin src/lib/api/admin.ts
git commit -m "feat(combustible): páginas admin de estaciones de servicio y tipos de combustible"
```

---

### Task 10: Frontend — formulario "Nueva carga" (foto primero, IA, validación blanda de km)

**Files (Frontend):**
- Create: `src/app/(protected)/combustible/nueva/page.tsx`
- Create: `src/features/combustible/comprimir-imagen.ts`
- Create: `src/features/combustible/validaciones.ts`
- Create: `src/features/combustible/foto-ticket.tsx` (input cámara/galería + preview + "sacar de nuevo")
- Test: `src/features/combustible/validaciones.test.ts`

**Interfaces:**
- Consumes: hooks de Task 8, catálogos (`useMoviles`, `useProvincias` existentes; `useEstacionesServicio`, `useTiposCombustible`), tareas por contrato habilitado (patrón del form de reporte: contratos desde `perfil.contratosHabilitados` + `GET /catalogos/tareas?contratoId=`).
- Produces: flujo completo de alta. Envío: `FormData` con `foto` (Blob comprimido) + campos string + `tareaIds` como JSON string (`form.append('tareaIds', JSON.stringify(ids))`).

- [ ] **Step 1: Test de validaciones (falla)**

`src/features/combustible/validaciones.test.ts`:

```ts
import { advertenciaKm } from './validaciones';

describe('advertenciaKm', () => {
  it('null si no hay km previo', () => expect(advertenciaKm(100, null)).toBeNull());
  it('null si el km avanza', () => expect(advertenciaKm(120001, 120000)).toBeNull());
  it('advierte si el km retrocede', () =>
    expect(advertenciaKm(119000, 120000)).toBe('El último km registrado para este móvil fue 120.000. ¿Confirmás 119.000?'));
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test -- validaciones`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `validaciones.ts`**

```ts
export function advertenciaKm(kmIngresado: number, ultimoKm: number | null): string | null {
  if (ultimoKm === null || kmIngresado >= ultimoKm) return null;
  const fmt = (n: number) => n.toLocaleString('es-AR');
  return `El último km registrado para este móvil fue ${fmt(ultimoKm)}. ¿Confirmás ${fmt(kmIngresado)}?`;
}
```

Run: `npm test -- validaciones` → PASS.

- [ ] **Step 4: Implementar `comprimir-imagen.ts`**

```ts
const MAX_LADO = 1600;
export async function comprimirImagen(archivo: File): Promise<Blob> {
  const bitmap = await createImageBitmap(archivo);
  const escala = Math.min(1, MAX_LADO / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo comprimir la imagen'))), 'image/jpeg', 0.7),
  );
}
```

- [ ] **Step 5: Implementar `foto-ticket.tsx` y la página `nueva/page.tsx`**

`foto-ticket.tsx`: `<input type="file" accept="image/*" capture="environment">` estilizado, con preview (`URL.createObjectURL`), botón "Sacar otra foto", y callback `onFoto(blob: Blob)`.

`nueva/page.tsx` (`'use client'`, patrón del form de `reporte/page.tsx`: `useState` + `useMemo` de validez + `toast.promise`):

1. Paso foto: al elegir foto → `comprimirImagen` → `setFoto(blob)` → disparar `useExtraerTicket().mutateAsync(blob)` mostrando "Leyendo el ticket…".
2. Con la respuesta: si `legible === false` → banner amarillo "No pudimos leer el ticket. Podés sacar una foto mejor o completar los datos a mano." (no bloquea). Si hay `sugerencias` → pre-cargar SOLO los campos vacíos (`litros`, `monto`, `fechaCarga`, `nroComprobante`, `tipoCombustibleId`, `estacionId`) y marcar visualmente los campos sugeridos (borde/badge "sugerido por IA") hasta que el usuario los toque.
3. Resto del form: móvil (`useMoviles`), km (con `useUltimoKm(movilId)` → si `advertenciaKm(km, ultimoKm)` devuelve texto, mostrarlo como advertencia con checkbox/confirmación inline, sin bloquear el envío), fecha (default hoy), litros, monto, medio de pago (radio: "Cuenta corriente" → label del comprobante "N° de remito" / "Caja" → "N° de factura"), estación (`useEstacionesServicio`), tipo (`useTiposCombustible`), provincia (`useProvincias`), tareas: selector agrupado por contrato habilitado (reusar el patrón de `features/reporte/lineas-field.tsx` para elegir tareas por contrato, permitiendo tareas de varios contratos), observaciones.
4. `formularioValido` (useMemo): foto presente, móvil, fecha, litros > 0, monto > 0, km ≥ 0, medio de pago, nroComprobante no vacío, estación, tipo, provincia, ≥1 tarea.
5. Envío: armar `FormData` (todos los campos como string; `tareaIds` con `JSON.stringify`), `useCrearCargaCombustible().mutateAsync(form)` con `toast.promise`, al éxito → `router.push('/combustible')`.

- [ ] **Step 6: Verificación manual + tests**

Run: `npm test && npx tsc --noEmit`
Expected: PASS todos. Probar en el navegador (backend local corriendo): alta completa con foto, con y sin `ANTHROPIC_API_KEY` configurada.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(protected\)/combustible src/features/combustible
git commit -m "feat(combustible): formulario de nueva carga con foto-first, sugerencias de IA y advertencia de km"
```

---

### Task 11: Frontend — listado, detalle con foto, edición y anulación

**Files (Frontend):**
- Create: `src/app/(protected)/combustible/page.tsx`
- Create: `src/features/combustible/detalle-carga.tsx` (dialog/panel de detalle)
- Create: `src/features/combustible/foto-ticket-view.tsx` (carga la imagen autenticada)
- Test: `src/features/combustible/foto-ticket-view.test.tsx`

**Interfaces:**
- Consumes: `useCargasCombustible`, `useCargaCombustible`, `useAnularCargaCombustible`, `useEditarCargaCombustible`, `urlTicket` (Task 8); `useSession` para el rol.
- Produces: página `/combustible` — para `JefeCuadrilla`/`Admin` botón "Nueva carga" → `/combustible/nueva`; para `JefeContrato` solo consulta.

- [ ] **Step 1: Test del visor de foto (falla)** — `foto-ticket-view.test.tsx`: mockear `api.get` para que devuelva un Blob, renderizar `<FotoTicketView cargaId={1} />`, esperar que aparezca un `<img>` con `src` blob:. (Patrón de mocks del repo: como en `client.test.ts`.)

- [ ] **Step 2: Implementar `foto-ticket-view.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { urlTicket } from '@/lib/api/combustible';

export function FotoTicketView({ cargaId }: { cargaId: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    api.get(urlTicket(cargaId), { responseType: 'blob' }).then((r) => {
      url = URL.createObjectURL(r.data);
      setSrc(url);
    });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [cargaId]);
  if (!src) return <div className="text-sm text-muted-foreground">Cargando ticket…</div>;
  return <img src={src} alt="Foto del ticket" className="max-h-[70vh] rounded-md" />;
}
```

Run: `npm test -- foto-ticket-view` → PASS.

- [ ] **Step 3: Implementar `/combustible/page.tsx`**: filtros (rango de fechas, móvil, estado — default `activa`), tabla (fecha, móvil/patente, litros, monto, estación, combustible, contratos de las tareas, quién cargó, estado con badge), fila → abre `detalle-carga.tsx`. Botón "Nueva carga" visible solo si `perfil.rol === 'JefeCuadrilla' || perfil.rol === 'Admin'`.

- [ ] **Step 4: Implementar `detalle-carga.tsx`**: todos los campos + `FotoTicketView` + tareas con su contrato. Acciones (solo dueño o Admin, y solo si `estado === 'activa'`): "Editar" (dialog con los mismos campos del form de alta, precargados; envía `FormData` parcial vía `useEditarCargaCombustible`; foto opcional para reemplazar) y "Anular" (dialog con motivo obligatorio → `useAnularCargaCombustible`, confirmación explícita). Si está anulada: banner con motivo y quién/cuándo.

- [ ] **Step 5: Verificación completa frontend**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: todo verde.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(protected\)/combustible src/features/combustible
git commit -m "feat(combustible): listado por rol, detalle con ticket, edición y anulación"
```

---

### Task 12: Cierre — verificación integral, glosario y contexto

**Files:**
- Modify (Backend): `.claude/Contexto/contexto-proyecto.md` (nueva sección con el resultado real de la implementación)
- Verify: `docs/glosario.md` y ADR-013 ya están al día (sesión 2026-07-30) — solo tocar si algo cambió respecto del plan durante la ejecución.

- [ ] **Step 1: Verificación integral backend**

Run: `npm test && npx tsc --noEmit && npm run build` (en Backend)
Expected: todos los specs PASS, build limpio.

- [ ] **Step 2: Verificación integral frontend**

Run: `npm test && npm run build` (en Frontend)
Expected: PASS + build Next sin errores.

- [ ] **Step 3: Prueba end-to-end manual local**: login como JefeCuadrilla → nueva carga con foto real de un ticket → verificar sugerencias de IA → enviar → ver en listado → login como JefeContrato de un contrato involucrado → ver la carga en solo lectura con su foto → login Admin → editar un campo → anular con motivo → verificar auditoría en `sth_auditoria` (acciones `crear`, `editar`, `anular`).

- [ ] **Step 4: Registrar el resultado en `.claude/Contexto/contexto-proyecto.md`** (nueva sección numerada: qué quedó implementado, desvíos respecto de este plan, pendientes) y commitear.

- [ ] **Step 5: Pendientes de deploy (checklist para el día del pase a producción)**:
  - Aplicar `docs/sql/2026-07-30-cargas-combustible.sql` en la BD compartida.
  - Crear la carpeta de `TICKETS_DIR` en el VPS, incluirla en el backup, y setear la env.
  - Cargar `ANTHROPIC_API_KEY` en el VPS (opcional — sin ella el módulo anda sin IA).
  - Verificar espacio en disco del VPS (pendiente: autorización de la clave SSH).
  - Seed del catálogo de estaciones de servicio reales (el Admin puede cargarlas desde la UI).

---

## Self-review (hecho al escribir el plan)

- **Cobertura vs ADR-013:** entidad y término ✔ (Task 1), solo JdC registra / JefeContrato consulta ✔ (Tasks 4–5), sin aprobación ✔ (no hay estados de aprobación), catálogo Movil reusado ✔ (FK a `sth_moviles`), tareas multi-contrato sin prorrateo ✔ (Task 1 M:N + Task 4 validación), medios de pago fijos + comprobante obligatorio ✔ (DTO), catálogos nuevos con seed ✔ (Tasks 1–2), validación blanda km ✔ (Tasks 4 y 10), anulación sin borrado + auditoría ✔ (Task 6), foto única obligatoria en filesystem tras interfaz ✔ (Tasks 3–4), IA solo sugiere con degradación ✔ (Tasks 7 y 10), PBI sin export ✔ (no se construye export).
- **Consistencia de nombres:** `TICKET_STORAGE`/`TicketStorage`, `CreateCargaCombustibleDto`, rutas `/cargas-combustible*`, hooks y tipos del frontend — revisados cruzando tasks.
- **Riesgo conocido:** el shape exacto de helpers de tests frontend (`perfilConRol`, mocks de página admin) se adapta al patrón real del archivo al ejecutar — el patrón de referencia está nombrado en cada task.
