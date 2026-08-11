# Combustible: alias de tipos + CUIT de estaciones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la extracción IA del ticket complete el tipo de combustible vía alias comerciales ("INFINIA DIESEL" → Gasoil premium) y la estación de servicio vía CUIT exacto, con administración de ambos desde las pantallas de Admin existentes.

**Architecture:** Tabla nueva `sth_tipo_combustible_alias` (N alias únicos por tipo) + columna `cuit` única y opcional en `sth_estaciones_servicio`. El matcheo de `ExtraccionTicketService` prueba nombre → alias para el tipo, y CUIT → nombre para la estación; cuando no matchea, expone el texto/CUIT leído para que el form muestre hints (mismo patrón que la patente). Admin: campo CUIT en la fila de estación, campo de alias (coma-separados) en la fila de tipo.

**Tech Stack:** NestJS 11 + Prisma (Backend), Next.js 16 + React 19 + Vitest (Frontend). Sin dependencias nuevas.

## Global Constraints

- Decisiones del grilling 2026-08-11 (ya en glosario al cierre): alias por tipo (opción a); CUIT-primero con caída a nombre; CUIT desconocido = **solo hint, sin auto-alta** (mismo criterio que la patente); carga inicial de estaciones diferida (el usuario pasa la lista después).
- **DDL SOLO en `testing`** — NADA de tocar `Horas_Sertec` ni la VPS. PROHIBIDO deployar: el usuario prueba en local contra `testing` primero.
- Repos y ramas: `feature/combustible-alias-cuit` en ambos repos, desde `main` actualizado.
- Backend: Jest con `prismaMock` (patrón de los specs existentes); verificación `npx jest <archivo>` + `npx nest build`. Si `nest build` falla por `sueldoMensualizado`, correr `npx prisma generate` primero (cliente local desactualizado, ya pasó).
- Frontend: vitest POR ARCHIVO (nunca la suite completa, máquina de 2 núcleos) + `npx tsc --noEmit`.
- CUIT: se guarda y compara **solo dígitos** (11). El input admite guiones pero se normaliza antes de enviar.
- Commits en español estilo repo + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Contrato de datos entre tareas

```ts
// Prisma (Backend):
// EstacionServicio += cuit: String? @unique @db.Char(11)
// model TipoCombustibleAlias { id, tipoCombustibleId, alias (unique) } — relación TipoCombustible.aliases

// ExtraccionTicket.sugerencias — CAMPOS NUEVOS:
//   tipoCombustibleLeido: string | null  // texto tal como vino impreso, para el hint
//   cuitEstacionLeido: string | null     // solo dígitos, para el hint

// Admin API:
// GET  /admin/tipos-combustible            → ahora cada tipo incluye aliases: string[]
// PUT  /admin/tipos-combustible/:id/alias  → body { alias: string[] } (reemplaza el set completo)
// GET/POST/PATCH /admin/estaciones-servicio → cuit?: string | null (solo dígitos, 11)
// GET  /catalogos/estaciones-servicio      → incluye cuit (para mostrarlo si hace falta)
```

---

# Parte A — Backend

### Task B0: Rama + schema + DDL (aplicado SOLO a testing)

**Files:**
- Modify: `prisma/schema.prisma` (modelos `EstacionServicio` línea ~485 y `TipoCombustible` línea ~496)
- Create: `docs/sql/2026-08-11-alias-combustible-cuit-estacion.sql`

- [ ] **Step 1: Rama** — `git checkout main; git pull; git checkout -b feature/combustible-alias-cuit`
- [ ] **Step 2: Schema** — en `prisma/schema.prisma`:

```prisma
model EstacionServicio {
  id        Int     @id @default(autoincrement())
  nombre    String  @unique
  localidad String?
  // CUIT del emisor, solo dígitos (11) — identifica la estación en la
  // extracción de tickets con prioridad sobre el nombre. Opcional: las
  // estaciones cargadas antes de esta feature no lo tienen todavía.
  cuit      String? @unique @db.Char(11)
  activo    Boolean @default(true)

  cargas CargaCombustible[]

  @@map("sth_estaciones_servicio")
}

model TipoCombustible {
  id     Int     @id @default(autoincrement())
  nombre String  @unique
  activo Boolean @default(true)

  cargas  CargaCombustible[]
  aliases TipoCombustibleAlias[]

  @@map("sth_tipos_combustible")
}

// Nombres comerciales tal como vienen impresos en los tickets
// ("INFINIA DIESEL" → Gasoil premium). Los usa la extracción IA para
// matchear cuando el nombre del catálogo no coincide con el impreso.
model TipoCombustibleAlias {
  id                Int    @id @default(autoincrement())
  tipoCombustibleId Int    @map("tipo_combustible_id")
  alias             String @unique

  tipoCombustible TipoCombustible @relation(fields: [tipoCombustibleId], references: [id])

  @@map("sth_tipo_combustible_alias")
}
```

- [ ] **Step 3: DDL** — `docs/sql/2026-08-11-alias-combustible-cuit-estacion.sql`:

```sql
-- Alias de tipos de combustible + CUIT de estaciones (grilling 2026-08-11).
-- Aplicar en testing AHORA; Horas_Sertec recién cuando el usuario apruebe el pase a prod.
ALTER TABLE sth_estaciones_servicio
  ADD COLUMN cuit CHAR(11) NULL,
  ADD UNIQUE INDEX ux_estaciones_servicio_cuit (cuit);

CREATE TABLE sth_tipo_combustible_alias (
  id INT NOT NULL AUTO_INCREMENT,
  tipo_combustible_id INT NOT NULL,
  alias VARCHAR(191) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY ux_tipo_combustible_alias_alias (alias),
  KEY ix_alias_tipo (tipo_combustible_id),
  CONSTRAINT fk_alias_tipo_combustible FOREIGN KEY (tipo_combustible_id) REFERENCES sth_tipos_combustible (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 4: Aplicar a testing + regenerar cliente** — `npx prisma db execute --file docs/sql/2026-08-11-alias-combustible-cuit-estacion.sql` (el `.env` local apunta a `testing` — verificar con `Select-String .env -Pattern "DATABASE_URL"` que dice `/testing` antes de ejecutar) y después `npx prisma generate`.
- [ ] **Step 5: Verificar** — `npx nest build` limpio.
- [ ] **Step 6: Commit** — `feat(combustible): schema de alias de tipos y cuit de estaciones + DDL`

### Task B1: Matcheo por alias y por CUIT en la extracción

**Files:**
- Modify: `src/cargas-combustible/extraccion-ticket.service.ts` (tipo `ExtraccionTicket` líneas 70-85, queries línea ~142, matcheo líneas 147-153 y armado de sugerencias líneas 178-194)
- Test: `src/cargas-combustible/extraccion-ticket.service.spec.ts` (existe — leerlo primero y seguir su patrón de mocks del cliente Anthropic y de prisma)

**Interfaces:**
- Produces: `sugerencias.tipoCombustibleLeido: string | null` y `sugerencias.cuitEstacionLeido: string | null` (solo dígitos). Matcheo tipo: nombre exacto → alias exacto → inclusión por nombre → inclusión por alias (todo normalizado con el `normalizar` existente). Matcheo estación: CUIT exacto (solo dígitos) → matcheo por nombre actual.

- [ ] **Step 1: Tests que fallan** — agregar al spec existente (adaptar el armado del mock al patrón real del archivo; el JSON simulado del modelo debe incluir los campos como los devuelve el prompt):

```ts
it('matchea el tipo por alias cuando el nombre impreso no coincide con el catálogo', async () => {
  // catálogo: tipo "Gasoil premium" con alias "INFINIA DIESEL"
  prismaMock.tipoCombustible.findMany.mockResolvedValue([
    { id: 5, nombre: 'Gasoil premium', aliases: [{ alias: 'INFINIA DIESEL' }] },
  ]);
  // ...mock del modelo devolviendo tipoCombustible: "Infinia  Diesel" (case/espacios distintos)
  const r = await service.extraer(fotoFake);
  expect(r.sugerencias?.tipoCombustibleId).toBe(5);
  expect(r.sugerencias?.tipoCombustibleLeido).toBe('Infinia  Diesel');
});

it('matchea la estación por CUIT exacto antes que por nombre', async () => {
  prismaMock.estacionServicio.findMany.mockResolvedValue([
    { id: 1, nombre: 'YPF Centro', cuit: '30111111118' },
    { id: 2, nombre: 'Shell Norte', cuit: '30222222229' },
  ]);
  // ...modelo devuelve estacion: "ESTACION DE SERVICIO SRL" (nombre que NO matchea) y cuitEstacion: "30-22222222-9"
  const r = await service.extraer(fotoFake);
  expect(r.sugerencias?.estacionId).toBe(2);
  expect(r.sugerencias?.cuitEstacionLeido).toBe('30222222229');
});

it('CUIT desconocido: estación sin sugerir pero cuitEstacionLeido presente para el hint', async () => {
  prismaMock.estacionServicio.findMany.mockResolvedValue([
    { id: 1, nombre: 'YPF Centro', cuit: '30111111118' },
  ]);
  // ...modelo devuelve estacion: null y cuitEstacion: "30999999995"
  const r = await service.extraer(fotoFake);
  expect(r.sugerencias?.estacionId).toBeNull();
  expect(r.sugerencias?.cuitEstacionLeido).toBe('30999999995');
});
```

- [ ] **Step 2: FAIL** — `npx jest extraccion-ticket`
- [ ] **Step 3: Implementar** — en el service:
  - Query de tipos: `select: { id: true, nombre: true, aliases: { select: { alias: true } } }`.
  - Query de estaciones: `select: { id: true, nombre: true, cuit: true }`.
  - Helper nuevo `soloDigitos = (s: string) => s.replace(/\D/g, '')`.
  - Matcheo de tipo (reemplaza el `matchear` genérico SOLO para tipos; el de estaciones por nombre queda):

```ts
const matchearTipo = (valor: string | null) => {
  if (!valor) return null;
  const v = normalizar(valor);
  const porNombre = tipos.find((t) => normalizar(t.nombre) === v);
  if (porNombre) return porNombre.id;
  const porAlias = tipos.find((t) => t.aliases.some((a) => normalizar(a.alias) === v));
  if (porAlias) return porAlias.id;
  const porInclusion = tipos.find((t) => v.includes(normalizar(t.nombre)) || normalizar(t.nombre).includes(v))
    ?? tipos.find((t) => t.aliases.some((a) => v.includes(normalizar(a.alias)) || normalizar(a.alias).includes(v)));
  return porInclusion?.id ?? null;
};
```

  - Matcheo de estación: `const cuitLeido = typeof json.cuitEstacion === 'string' ? soloDigitos(json.cuitEstacion) : ''; const porCuit = cuitLeido.length === 11 ? estaciones.find((e) => e.cuit === cuitLeido) : undefined; const estacionId = porCuit?.id ?? matchear(json.estacion ?? null, estaciones);`
  - Sugerencias nuevas: `tipoCombustibleLeido: typeof json.tipoCombustible === 'string' ? json.tipoCombustible : null` y `cuitEstacionLeido: cuitLeido.length === 11 ? cuitLeido : null`. Agregarlas también al tipo `ExtraccionTicket`.
- [ ] **Step 4: PASS** — el spec completo del archivo (los tests viejos siguen verdes; si algún test viejo mockeaba tipos/estaciones sin `aliases`/`cuit`, actualizar esos mocks agregando `aliases: []` / `cuit: null`).
- [ ] **Step 5: Commit** — `feat(combustible): extraccion matchea tipo por alias y estacion por cuit`

### Task B2: Admin — CUIT en estaciones y ABM de alias

**Files:**
- Modify: `src/admin/dto/catalogo-combustible.dto.ts`, `src/admin/admin.controller.ts:126-158`, `src/admin/admin.service.ts` (métodos `getEstacionesServicio`, `crearEstacionServicio`, `actualizarEstacionServicio`, `getTiposCombustible`), `src/catalogos/catalogos.service.ts` (`getEstacionesServicio`)
- Test: `src/admin/admin.service.spec.ts` si existe (mirar; si no existe, la verificación es `nest build` + los tests E2E manuales del usuario)

**Interfaces:**
- Produces: DTOs con `cuit` (`@IsOptional() @Matches(/^\d{11}$/) cuit?: string` en Create; en Update además se acepta `null` para borrarlo: usar `@IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^\d{11}$/) cuit?: string | null`). `PUT /admin/tipos-combustible/:id/alias` con `class GuardarAliasDto { @IsArray() @IsString({ each: true }) alias: string[] }` — reemplaza el set completo (deleteMany + createMany, trim, descarta vacíos y duplicados normalizados). `getTiposCombustible` devuelve `aliases` como `string[]` plano (map de la relación, orden alfabético).

- [ ] **Step 1: Leer** `src/admin/admin.service.ts` (métodos de estaciones/tipos) para copiar el patrón exacto (unicidad, manejo de errores).
- [ ] **Step 2: Tests que fallan** (si el spec existe; si no, saltar a Step 3): caso "guardarAlias reemplaza el set y descarta vacíos/duplicados", caso "actualizarEstacion guarda cuit y acepta null para borrarlo".
- [ ] **Step 3: Implementar** DTOs + service + controller:

```ts
// admin.controller.ts (junto a los otros de tipos-combustible)
@Put('tipos-combustible/:id/alias')
guardarAliasTipoCombustible(@Param('id', ParseIntPipe) id: number, @Body() dto: GuardarAliasDto) {
  return this.service.guardarAliasTipoCombustible(id, dto.alias);
}
```

```ts
// admin.service.ts
async guardarAliasTipoCombustible(tipoId: number, alias: string[]) {
  const limpios = [...new Map(
    alias.map((a) => a.trim()).filter((a) => a.length > 0).map((a) => [a.toLowerCase(), a]),
  ).values()];
  await this.prisma.$transaction([
    this.prisma.tipoCombustibleAlias.deleteMany({ where: { tipoCombustibleId: tipoId } }),
    ...(limpios.length
      ? [this.prisma.tipoCombustibleAlias.createMany({ data: limpios.map((a) => ({ tipoCombustibleId: tipoId, alias: a })) })]
      : []),
  ]);
  return this.getTiposCombustible();
}
```

  `getTiposCombustible`: agregar `include`/`select` de `aliases` y mapear a `aliases: t.aliases.map((a) => a.alias).sort()`. Métodos de estación: sumar `cuit` al select/create/update (en update, `cuit: dto.cuit === undefined ? undefined : dto.cuit` para distinguir "no tocar" de "borrar"). `catalogos.service.ts` `getEstacionesServicio`: sumar `cuit` al select.
- [ ] **Step 4: Verificar** — specs del módulo si existen + `npx nest build` limpio.
- [ ] **Step 5: Commit** — `feat(admin): cuit en estaciones y alias de tipos de combustible`

---

# Parte B — Frontend

### Task F0: Rama

- [ ] `git checkout main; git pull; git checkout -b feature/combustible-alias-cuit`

### Task F1: Tipos y hooks de API

**Files:**
- Modify: `src/types/domain.ts` (`TipoCombustible`, `EstacionServicio`), `src/lib/api/admin.ts`, `src/lib/api/combustible.ts` (tipo de sugerencias de extracción)

**Interfaces:**
- Produces: `TipoCombustible.aliases: string[]`; `EstacionServicio.cuit: string | null`; hook `useGuardarAliasTipoCombustible()` (`mutationFn: ({ id, alias }: { id: number; alias: string[] }) => api.put(`/admin/tipos-combustible/${id}/alias`, { alias })`, invalida la queryKey de tipos de admin); `useActualizarEstacionServicio` acepta `cuit?: string | null`; el tipo de sugerencias de extracción en `combustible.ts` suma `tipoCombustibleLeido: string | null` y `cuitEstacionLeido: string | null`.

- [ ] **Step 1: Leer** `src/lib/api/admin.ts` (hooks de estaciones/tipos, queryKeys exactas) y `src/lib/api/combustible.ts` (tipo de la extracción) y aplicar los cambios siguiendo el patrón.
- [ ] **Step 2: Verificar** — `npx tsc --noEmit` (va a fallar en los consumidores hasta F2/F3 si los tipos son estrictos — en ese caso completar F2/F3 antes de correr tsc, o tipar `aliases`/`cuit` como opcionales transitoriamente NO: hacerlos requeridos y arreglar los mocks de tests en F2/F3).
- [ ] **Step 3: Commit** — `feat(combustible): tipos y hooks para alias y cuit`

### Task F2: Admin UI — campo CUIT y campo alias

**Files:**
- Modify: `src/features/admin/estacion-edit-row.tsx` (patrón visible arriba en `tipo-combustible-edit-row.tsx`), `src/features/admin/tipo-combustible-edit-row.tsx`
- Test: `src/app/(protected)/admin/estaciones-servicio/estaciones-page.test.tsx`, `src/app/(protected)/admin/tipos-combustible/tipos-page.test.tsx` (extender los existentes — leerlos primero, respetar sus mocks)

**Interfaces:**
- Consumes: hooks de F1.

- [ ] **Step 1: Tests que fallan** — estaciones: "muestra y edita el CUIT (acepta guiones, envía solo dígitos)" (tipear `30-12345678-9`, asertar que el mutate recibe `cuit: '30123456789'`); "CUIT vacío envía null". Tipos: "muestra los alias actuales y guarda la lista editada" (input coma-separado `INFINIA DIESEL, EURO DIESEL`, asertar mutate con `alias: ['INFINIA DIESEL', 'EURO DIESEL']`).
- [ ] **Step 2: FAIL** — vitest de cada archivo.
- [ ] **Step 3: Implementar** —
  - `estacion-edit-row.tsx`: input "CUIT" opcional debajo de localidad, `placeholder="30-12345678-9"`; al guardar: `const cuitLimpio = cuit.replace(/\D/g, ''); mutate({ ..., cuit: cuitLimpio.length === 11 ? cuitLimpio : cuitLimpio.length === 0 ? null : (toast error 'El CUIT debe tener 11 dígitos' y no enviar) })`. Mostrar el CUIT formateado (`30-12345678-9`) en la fila cerrada si existe.
  - `tipo-combustible-edit-row.tsx`: debajo del nombre, input "Alias (como vienen en el ticket, separados por coma)" precargado con `tipo.aliases.join(', ')`; botón Guardar llama ADEMÁS a `useGuardarAliasTipoCombustible` cuando los alias cambiaron (split por coma, trim, filtrar vacíos). En la fila cerrada, mostrar los alias como texto chico gris (`text-xs text-slate`).
- [ ] **Step 4: PASS** — vitest de ambos archivos + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(admin): edicion de cuit de estaciones y alias de tipos de combustible`

### Task F3: Hints en el formulario de nueva carga

**Files:**
- Modify: `src/app/(protected)/combustible/nueva/page.tsx` (buscar el hint existente de patente — "Patente leída: «…» — no está en el maestro" — y replicar el patrón al lado de los selects de tipo y estación)
- Test: `src/app/(protected)/combustible/nueva/page.test.tsx` (extender; leer los mocks de la extracción existentes)

**Interfaces:**
- Consumes: `tipoCombustibleLeido` / `cuitEstacionLeido` de F1.

- [ ] **Step 1: Tests que fallan** — (a) "si la extracción trae tipoCombustibleLeido sin tipoCombustibleId, muestra el hint con el texto leído" (asertar regex `/Tipo leído del ticket: .INFINIA DIESEL./` y que sugiere agregarlo como alias); (b) "si trae cuitEstacionLeido sin estacionId, muestra el hint con el CUIT formateado" (`/CUIT leído: 30-99999999-5/` y "no está en el maestro"); (c) "si el tipo/estación SÍ matchearon, no hay hint".
- [ ] **Step 2: FAIL**
- [ ] **Step 3: Implementar** — dos hints condicionales (mismo estilo visual que el de patente):
  - Tipo: visible cuando `sugerencias.tipoCombustibleLeido && !sugerencias.tipoCombustibleId` → `Tipo leído del ticket: «{texto}» — no está en el catálogo. Podés agregarlo como alias en Admin → Tipos de combustible.`
  - Estación: visible cuando `sugerencias.cuitEstacionLeido && !sugerencias.estacionId` → `CUIT leído: {formateado 30-12345678-9} — no está en el maestro de estaciones.` (formatear con helper local `const fmtCuit = (c: string) => `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}``).
- [ ] **Step 4: PASS** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(combustible): hints de tipo y cuit no matcheados en la carga`

---

## Self-review (hecho al escribir)

- Cobertura: alias (B0 schema, B1 matcheo, B2 ABM, F2 UI) ✔; CUIT (B0, B1, B2, F2) ✔; hints (B1 campos nuevos, F3) ✔; solo testing (B0 Step 4 con verificación del .env, constraint global) ✔; carga inicial diferida (fuera de alcance, anotada) ✔.
- Tipos consistentes: `tipoCombustibleLeido`/`cuitEstacionLeido` idénticos en contrato, B1 y F1/F3 ✔; `GuardarAliasDto { alias: string[] }` = hook `{ id, alias }` ✔; `aliases: string[]` plano en GET admin = `tipo.aliases.join(', ')` en F2 ✔.
- Sin placeholders: todos los pasos tienen código o instrucción de leer el archivo real y adaptar el patrón (lección de la sesión anterior: la API real del componente manda).
