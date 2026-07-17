# Aprobación por carga + mejoras UX (mis registros, móviles, envío) — Diseño

**Fecha:** 2026-07-16
**Repos afectados:** `Forms_Horas_ST_back` (backend NestJS), `Forms_Horas_ST_Frontend` (frontend Next.js).
**ADR relacionado:** `docs/adr/2026-07-16-adr-004-aprobacion-por-carga.md` (Feature 1).
**Glosario actualizado:** `docs/glosario.md` — término **Carga (`loteId`)**.

Cuatro cambios pedidos por el usuario, agrupados en un solo documento porque comparten sesión de
grilling, pero son **independientes entre sí** (tocan páginas distintas) — el plan de
implementación los trata como bloques de tareas separados.

## 1. Aprobación por carga, no por fila individual

### 1.1 Problema

Hoy `/aprobaciones` agrupa visualmente por (operarioCuil, fecha), pero cada fila se
aprueba/desaprueba con su propio clic. Si un Jefe de Cuadrilla carga 5 operarios en 3 contratos en
un solo envío, un Jefe de Contrato con autoridad sobre 1 de esos contratos tiene que aprobar sus 5
filas una por una. El usuario pidió una sola acción por envío ("carga").

No existe hoy ningún dato que identifique "qué filas vinieron del mismo envío" — ver
ADR-004 para el detalle y las alternativas descartadas.

### 1.2 Backend

**Schema (`prisma/schema.prisma`):** nueva columna en `RegistroHoras`:

```prisma
model RegistroHoras {
  id      Int      @id @default(autoincrement())
  loteId  String   @map("lote_id") @db.Char(36)
  // ...resto sin cambios
  @@index([loteId])
}
```

**DDL manual (BD compartida — nunca `prisma db push`/`migrate`):**

```sql
ALTER TABLE sth_registros_horas ADD COLUMN lote_id CHAR(36) NULL AFTER id;
-- Backfill: cada fila pendiente existente (datos de prueba) recibe su propio lote_id (lote de 1)
UPDATE sth_registros_horas SET lote_id = UUID() WHERE lote_id IS NULL;
ALTER TABLE sth_registros_horas MODIFY COLUMN lote_id CHAR(36) NOT NULL;
CREATE INDEX idx_registros_horas_lote_id ON sth_registros_horas (lote_id);
```

**`RegistrosHorasService`:**
- `create()`: genera `loteId = crypto.randomUUID()` y lo setea en la fila creada (una carga
  individual es un lote de una sola fila).
- `createBatch()`: genera **un solo** `loteId` antes del `$transaction` y lo setea en las N×M
  filas que crea (mismo valor para todas las filas de ese envío).
- `porAprobar(usuario)`: reescrito para agrupar por `loteId` en vez de por (operarioCuil, fecha).
  Sigue devolviendo `filas: RegistroPorAprobar[]` (flat, sin agrupar server-side — el agrupado es
  responsabilidad del frontend, igual que hoy) pero cada fila ahora expone `loteId`. La query:
  1. Contratos del jefe (`{ jefeContratoCuil: usuario.cuil }`, o todos si Admin).
  2. `loteId`s distintos que tienen ≥1 fila `pendiente` en esos contratos.
  3. Todas las filas `pendiente` de esos `loteId`s (incluye filas de otros contratos como
     contexto, igual que hoy — mismo campo `accionable` calculado igual: `contratoId` está en los
     contratos del jefe).
- **Nuevo método `resolverLote(loteId, dto, usuario)`:**
  - `dto: { estado: 'aprobado' | 'desaprobado', ids?: number[], motivoDesaprobacion?: string }`.
  - Busca las filas `pendiente` de ese `loteId` cuyo `contrato.jefeContratoCuil === usuario.cuil`
    (o todas si Admin) — este es el conjunto **accionable** del llamador, calculado server-side,
    **nunca confiando en `ids` del cliente para decidir autorización**.
  - Si `dto.ids` viene: intersecta con el conjunto accionable (los ids que no sean accionables o
    no pertenezcan a ese lote se ignoran silenciosamente — no error, simplemente no se tocan).
  - Si `dto.ids` no viene: resuelve todo el conjunto accionable.
  - Si el conjunto resultante es vacío → `BadRequestException` ("nada para resolver").
  - `estado === 'desaprobado'` sigue requiriendo `motivoDesaprobacion` (mismo check que
    `resolver()` individual).
  - Aplica el `update` a cada fila (mismo shape que `resolver()` hoy: `estado`,
    `aprobadoPorCuil`, `aprobadoEn`, `motivoDesaprobacion`) + una fila de `Auditoria` por registro
    resuelto (mismo patrón que hoy, no se audita "el lote" como entidad — no existe como tabla).
  - Devuelve `{ resueltos: number, ids: number[] }`.
- `resolver()` (individual, por id) **se mantiene sin cambios** — sigue disponible para
  correcciones puntuales fuera del flujo de carga (ej. reabrir y resolver de nuevo un registro
  aislado).

**`RegistrosHorasController`:** nuevo endpoint

```ts
@Patch('lote/:loteId/resolver')
@Roles('JefeContrato', 'Admin')
resolverLote(@Param('loteId') loteId: string, @Body() dto: ResolverLoteDto, @Request() req) {
  return this.service.resolverLote(loteId, dto, { cuil: req.user.cuil, rol: req.user.rol });
}
```

Nuevo DTO `ResolverLoteDto` (`dto/resolver-lote.dto.ts`): igual a `ResolverRegistroDto` +
`ids?: number[]` opcional (`@IsOptional() @IsArray() @IsInt({ each: true })`).

**Tipos existentes que ganan el campo `loteId`:** `INCLUDE_BASICO`/`select` de `porAprobar` no
necesitan tocarse (es una columna escalar de `RegistroHoras`, no una relación) — ya viene incluida
por default en cualquier `findMany` sin `select` explícito. Verificar que `porAprobar` no use
`select` restrictivo que la excluya.

### 1.3 Frontend

**Tipos (`types/domain.ts`):** `RegistroHoras.loteId: string` (nuevo campo).

**`lib/agrupar.ts`:** se reemplaza `agruparPorOperarioFecha` por `agruparPorLote`:

```ts
export type GrupoLote = {
  loteId: string;
  fecha: string;
  filas: RegistroPorAprobar[];       // todas (incluye contexto de otros contratos)
  accionables: RegistroPorAprobar[]; // solo las de mi contrato
};

export function agruparPorLote(filas: RegistroPorAprobar[]): GrupoLote[]
```
(agrupa por `loteId`; `fecha` = la de la primera fila del grupo, todas comparten fecha porque
vienen del mismo envío).

**`lib/api/aprobaciones.ts`:** nuevo hook `useResolverLote`:

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
(`useResolverRegistro` individual se mantiene — no se usa más en esta página, pero no se borra:
es infraestructura genérica de "resolver una fila", reutilizable a futuro).

**Nuevo componente `features/aprobaciones/lote-card.tsx`:**
- Colapsado: fecha, resumen de operarios/contratos accionables (ej. "3 operarios · 8 hs c/u"),
  botones grandes **"Aprobar todo"** / **"Desaprobar todo"** + botón "Ver detalle ▾".
- Desaprobar todo abre `DesaprobarDialog` (mismo componente existente, sin cambios) — al confirmar
  motivo, llama `useResolverLote` con `estado: 'desaprobado'`, sin `ids` (resuelve todo lo
  accionable).
- Expandido ("Ver detalle"): lista de filas accionables con checkbox (todas tildadas por
  default) + filas de otro contrato en gris sin checkbox (mismo estilo `bg-sand/60 text-slate` que
  hoy). Footer cambia a **"Aprobar seleccionados (N)"** / **"Desaprobar seleccionados (N)"**,
  llamando `useResolverLote` con `ids` = los tildados. Si `N === 0`, ambos botones deshabilitados.
- Sin selección parcial → colapsado sigue mostrando "todo"/"todo"; al expandir y destildar algo,
  el footer pasa a mostrar el conteo seleccionado.

**`app/(protected)/aprobaciones/page.tsx`:** reemplaza `agruparPorOperarioFecha` +
mapeo manual de filas por `agruparPorLote` + `<LoteCard>` por grupo.

## 2. Mis registros — total grande + tarjetas por registro

### 2.1 Diseño (validado con mockup, ver companion visual de la sesión de grilling)

Reemplaza `RegistrosTabla` (tabla) por un nuevo componente con:
- **Hero de total**, arriba: número grande (`text-4xl` o similar) + "Total 1ª/2ª quincena".
- **Una tarjeta por registro** (no por día — decisión explícita: evita ambigüedad de qué estado
  mostrar cuando un día tiene 2 líneas con estados distintos). Cada tarjeta: fecha, contrato +
  tareas, horas (grande), `StatusBadge` (reusa el componente existente), y si `estado ===
  'desaprobado'` y hay `motivoDesaprobacion`, se muestra visible (no oculto detrás de un tooltip
  `title=` como hoy — un operario en el celular no puede hacer hover).
- Filtro por quincena: **sin cambios** — sigue usando `QuincenaSelect` + `enQuincena()`, mismo flujo.
- `mostrarOperario` (usado por la tab "Cargas que hice" del JdC) se mantiene: si `true`, el nombre
  del operario aparece en la tarjeta.

### 2.2 Implementación

**Nuevo componente `features/mis-registros/registros-cards.tsx`** (reemplaza
`registros-tabla.tsx` — incluir migración del `.test.tsx` si existe cobertura previa; hoy no hay
test dedicado de `RegistrosTabla`, así que este componente nace con tests desde cero, TDD).

Firma igual a la actual (mismo contrato con la página, sin romper `mis-registros/page.tsx` más
allá del import):

```ts
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
})
```

`app/(protected)/mis-registros/page.tsx`: cambia el import de `RegistrosTabla` a `RegistrosCards`,
sin otro cambio (mismas props).

## 3. Selector de móviles — dropdown con checkboxes

### 3.1 Diseño

Reemplaza los botones tipo chip de `ReportePage` (líneas 151-170 de `page.tsx` actual) por un
dropdown custom (el proyecto no tiene librería de UI — todo a mano con Tailwind, mismo criterio
que el resto del formulario):
- Botón cerrado: `"Móviles (N seleccionados) ▾"` (o `"Móviles ▾"` si `N === 0`).
- Al abrir: panel con un checkbox por móvil (`m.identificador`), cierra al tocar afuera o al tocar
  el botón de nuevo. **Sin buscador de texto** (decisión explícita del usuario — no requiere
  tipear en el celular).
- Estado: mismo `movilIds: number[]` que ya existe en `ReportePage` — el componente nuevo es
  puramente de presentación, recibe `value`/`onChange` igual que `OperariosSelect`.

### 3.2 Implementación

**Nuevo componente `features/reporte/moviles-select.tsx`:**

```ts
export function MovilesSelect({
  moviles,
  value,
  onChange,
}: {
  moviles: Movil[];
  value: number[];
  onChange: (ids: number[]) => void;
})
```

Cierre al click afuera: `useRef` + `useEffect` con listener de `mousedown` en `document`, mismo
patrón que cualquier dropdown custom (no hay precedente exacto en el repo — es el primer dropdown
propio que no es un `<select>` nativo ni un buscador con lista).

`ReportePage`: reemplaza el bloque de botones (líneas 146-172) por
`<MovilesSelect moviles={moviles ?? []} value={movilIds} onChange={setMovilIds} />`, elimina
`toggleMovil` (ya no se usa, la lógica de toggle vive dentro del componente nuevo).

## 4. Envío directo con modal de carga (sin confirmación previa)

### 4.1 Diseño

En `ReportePage`:
- Se elimina el estado `confirmando` y el modal de confirmación actual (líneas 197-224).
- Se elimina la barra inferior `"Se generarán N filas"` (línea 184-186) y, con ella, ya no hace
  falta `contarFilas`/`totalFilas` en esta página (se puede dejar `lib/reporte-preview.ts` sin
  tocar — no se borra el archivo, simplemente deja de usarse acá; no hay otro consumidor que
  revisar, confirmar en el plan).
- El botón **"Reportar"** pasa a llamar `enviar()` directamente `onClick` (ya no abre un modal
  antes).
- Mientras `crear.isPending`, se muestra un modal simple: spinner + `"Cargando reporte…"` (mismo
  texto que ya usa el `toast.promise` de `enviar()`, ahora también en el modal). Sin botón de
  cancelar (la carga es rápida, no hay operación en curso que abortar de forma segura una vez que
  el POST salió).
- El resto de `enviar()` (payload, `toast.promise`, reset de `operarios`/`lineas` al éxito) **no
  cambia**.

### 4.2 Implementación

Nuevo componente simple `features/reporte/cargando-modal.tsx` (o inline en `page.tsx`, a decidir
en el plan según tamaño final) — un `<div>` fixed overlay con spinner (reusar el patrón visual del
modal de confirmación actual: `fixed inset-0 ... bg-ink/40`, sin los botones).

## 5. Fuera de alcance

- No se toca la lógica de `reabrir()` ni `update()` (corrección de un registro individual) — siguen
  operando por `id`, sin concepto de lote.
- No se agrega ninguna vista de "historial de cargas" ni de auditoría a nivel de lote — el lote es
  solo la unidad de agrupación para aprobar, no una entidad con su propia tabla ni endpoints CRUD.
- No se cambia el modelo N×M de ADR-002 (una fila por operario×contrato sigue siendo la unidad
  atómica de dato) — `loteId` es puramente aditivo.
- `RegistrosTabla` no se borra si algo más la importa (verificar en el plan); si queda huérfana, se
  elimina como parte de la Feature 2.
- La vista "Cargas que hice" del JdC (tab en `/mis-registros`) usa el mismo componente nuevo
  (`RegistrosCards`) — no tiene una vista de aprobación en bloque propia (eso es exclusivo de
  `/aprobaciones`, que ve el Jefe de Contrato).

## 6. Verificación

- **Backend:** `npm run build`. Sin suite de tests automatizada (consistente con el resto del
  módulo `registros-horas`) — verificación manual E2E documentada en el plan (no hay credenciales
  Admin/JefeContrato reales en el entorno del agente).
- **Frontend:** TDD para los componentes nuevos (`LoteCard`, `RegistrosCards`, `MovilesSelect`,
  modal de carga) + actualización de `agrupar.test.ts`, `aprobaciones-page.test.tsx`,
  `reporte-page.test.tsx`, `mis-registros-page.test.tsx` donde corresponda. `npm test`,
  `npm run lint`, `npm run build`.
- **E2E manual (usuario, antes de mergear):**
  1. Cargar una carga masiva con varios operarios en un contrato propio + otro contrato ajeno →
     confirmar en `/aprobaciones` que aparece como **una** tarjeta de lote, con "Aprobar todo"
     resolviendo todas las filas del contrato propio de un solo click, y las del otro contrato
     visibles en gris sin acción.
  2. Expandir el detalle, destildar un operario, aprobar el resto → confirmar que el destildado
     sigue `pendiente`.
  3. `/mis-registros`: confirmar el total grande arriba y una tarjeta por registro, coincide con
     el total de antes (mismo cálculo, solo cambia la presentación).
  4. `/reporte`: confirmar el selector de móviles con checkboxes, y que "Reportar" ya no pide
     confirmación — muestra el modal de carga y al terminar limpia el formulario (igual que hoy).
