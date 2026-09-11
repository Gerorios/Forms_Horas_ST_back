# Móviles (Admin): lista paginada y filtro por patente

Fecha: 2026-09-11 · Repos: **Frontend** (el cambio) + **Backend** (solo docs)

## 1. Qué se pide

En `/admin/moviles` del Frontend: un buscador que filtre la lista por patente
(campo `identificador`, comparado normalizado a `[A-Z0-9]`) y por `descripcion`,
y paginar la lista resultante de a 20 **en el cliente**. Backend, API y base no
se tocan. Aparte, dar de alta el término "Móvil" en el glosario `CONTEXT.md`.

## 2. Decisiones cerradas en la entrevista

| Decisión | Resuelto | Porqué |
|---|---|---|
| Dónde pagina | Cliente. El Backend no se toca | 79 móviles en base: payload chico, filtro instantáneo, un solo PR |
| "Patente" | Es el campo `identificador` que ya existe | Verificado en `sth_moviles`: `AA615NF`, `A166LHV`, `301IEG`. Cero DDL |
| Filtro | Patente normalizada (`[A-Z0-9]`) **o** descripción | `aa 615` → `AA615NF`; `hilux` / `moto` filtran por tipo |
| Página | 20, con el `Paginador` de la casa | Ya existe y lo usan `/ausencias` y `/novedades` |
| Reset | Tipear en el filtro vuelve a página 1 | Si no, filtrás y ves vacío |
| Vacío | `Ningún móvil coincide con «x»`; `Sin móviles.` se conserva para lista vacía real | Distinguir "no hay" de "no coincide" |
| Intactos | Alta individual, carga masiva, toggle activo | Fuera del pedido |

## 3. Lo que ya existe y hay que reusar (NO inventar de nuevo)

- **`Frontend/src/components/paginador.tsx`** — exporta `Paginador`
  (pie `Página X de Y · N cosas` + `Anterior`/`Siguiente`, se oculta solo si
  `totalPaginas <= 1`) y `paginar(items, pagina, porPagina)` →
  `{ enPagina, paginaSegura, totalPaginas }`. Lo usan `/ausencias` y
  `/novedades` con `const POR_PAGINA = 20` a nivel módulo.
- **`Frontend/src/components/ui/barra-filtros.tsx`** — `BarraFiltros` (agrega
  el link "Limpiar filtros" si `hayFiltros`) y `FiltroBusqueda`. Es lo que usa
  la página hermana `admin/usuarios`.
- **`Frontend/src/lib/facetado.ts`** — `contieneTexto(texto, busqueda)`:
  substring sin tildes ni mayúsculas, búsqueda vacía pasa todo. Sirve para la
  `descripcion`. **No sirve para la patente**: no saca espacios ni guiones.
- **Patrón de reset**: `novedades/page.tsx` envuelve los setters en vez de usar
  `useEffect`, para no disparar `react-hooks/set-state-in-effect`. Seguir ese.
- **Tipo**: `MovilAdmin { id; identificador: string; descripcion: string | null; activo }`
  en `lib/api/admin.ts:8`. La descripción es nullable.

## 4. Pasos

### Etapa A — Frontend (PR único, rama `feat/moviles-paginado-filtro`)

**Paso 1 — Línea de base.** Rama desde `main`; `npm test` y `npm run lint`,
anotar la cantidad de tests verdes. Verificación: todo verde antes de tocar nada.

**Paso 2 — Helper de coincidencia (TDD).** Crear `src/lib/moviles.test.ts`
primero, después `src/lib/moviles.ts`:

```ts
/** Misma regla que el Backend (extraccion-ticket.service.ts). */
export function normalizarPatente(s: string): string   // toUpperCase + replace(/[^A-Z0-9]/g,'')
/** Vacío pasa todo. Si no: patente normalizada O descripción (tolera null). */
export function coincideMovil(m: Pick<MovilAdmin,'identificador'|'descripcion'>, busqueda: string): boolean
```

Casos (ROJOS antes de crear el archivo): `aa 615` y `aa-615` → `AA615NF`;
`a166` no matchea `AA615NF`; `hilux` → por descripción; `moto` → `Moto Guardia`;
`descripcion: null` no rompe; `''` y `'   '` → true; `zzz` → false; búsqueda que
queda vacía tras normalizar (`-`) → **no** matchea por patente, sí evalúa
descripción. Verificación: `npx vitest run src/lib/moviles` rojo → verde.

**Paso 3 — Tests de página (ROJOS).** En `moviles-page.test.tsx`: pasar el mock
de `useMovilesAdmin` a `vi.fn()` + `mockReturnValue` en `beforeEach` con el
MISMO móvil de hoy (`INT-101 / Camioneta`) para que los 5 tests existentes no
cambien. Agregar:

- búsqueda: `aa-615` → solo `AA615NF`; `moto` → solo `A166LHV`; `zzz` →
  `Ningún móvil coincide con «zzz»`; `data: []` sin tipear → `Sin móviles.`
- paginación con 25 móviles (`{ timeout: 15000 }`): ve `AA000ZZ`..`AA019ZZ` y no
  `AA020ZZ`; `Página 1 de 2 · 25 móviles`; `Anterior` deshabilitado; click
  `Siguiente` → página 2 y `Siguiente` deshabilitado. Con 20 móviles el pie no
  aparece.
- reset: en página 2, tipear `cam` (siguen los 25) → vuelve a `Página 1 de 2`.
  Este test queda rojo si se implementa sin el reset.

Verificación: `npx vitest run moviles-page` → nuevos en rojo, 5 viejos en verde.

**Paso 4 — Implementar `page.tsx`.** `POR_PAGINA = 20` a nivel módulo; estado
`busqueda` y `pagina`; setter envuelto `buscar(v)` que hace `setBusqueda(v)` +
`setPagina(1)`; `filtrados` con `useMemo` + `coincideMovil`; `paginar(filtrados,
pagina, POR_PAGINA)`; `BarraFiltros` + `FiltroBusqueda` entre el textarea y la
lista; la lista mapea `enPagina`; los dos estados vacíos; `Paginador` como
último hijo del contenedor `divide-y`. No tocar `movil-edit-row`, `pill-activo`,
`paginador`, `barra-filtros` ni `lib/api/admin`.

Verificación: los dos archivos de test en verde, `npm run lint` limpio,
`npm test` completo = línea de base + los nuevos.

**Paso 5 — Verificación visual y OK del usuario.** `npm run dev` contra la API
real: `Página 1 de 4 · 79 móviles`; probar `aa 615`, `hilux`, `moto`, `zzz`,
"Limpiar filtros"; alta individual, carga masiva y toggle siguen andando. A
375px: sin scroll horizontal. **Mostrar y esperar el OK antes del PR.**

**Paso 6 — PR y merge.** `gh pr merge N --merge --admin`. Sin deploy salvo
pedido explícito. Aclarar en el PR que **no tiene par en Backend** (no hay
cambio de API).

### Etapa B — Backend, solo docs (PR aparte)

**Paso 7 — Glosario.** `CONTEXT.md`: subsección `### Maestros (Admin)` con la
entrada **Móvil**: el `identificador` ES la patente (mayúsculas, sin espacios ni
guiones); `descripcion` es el tipo de vehículo y puede ser nula; las búsquedas
normalizan a `[A-Z0-9]`. `_Avoid_`: "identificador interno", "número de móvil".

**Paso 8 — Contexto de sesión.** `.claude/Contexto/contexto-proyecto.md`,
sección `## 86.` con qué se hizo, el PR del front, el reuso de
`Paginador`/`FiltroBusqueda` y el helper nuevo. Este plan va en el mismo PR.

## 5. Riesgos

- **Romper los 5 tests existentes al cambiar el mock.** Mitigación: el
  `beforeEach` devuelve exactamente el móvil de hoy; correr el archivo antes y
  después del refactor del mock, sin agregar tests todavía.
- **Falsos rojos por timeout con 25 filas** (ya pasó en ausencias, contexto §82).
  Mitigación: `{ timeout: 15000 }` y correr la suite completa.
- **Tocar `paginador.tsx`** rompería los tests de ausencias y novedades, que
  assertean el string exacto. Mitigación: no tocarlo.
- **Lint `react-hooks/set-state-in-effect`** si el reset se hace con `useEffect`.
  Mitigación: setter envuelto.
- **UX post-mutación**: al agregar un móvil con filtro activo o desde la página
  3, el nuevo puede no verse (el toast igual confirma). Aceptado, igual que
  novedades.
- **Sin DDL, sin migración, sin cambio de API**: riesgo de datos nulo.
  Rollback = revertir el PR del Frontend.

## 6. Fuera de alcance

Cualquier cambio en Backend que no sea documentación; filtro activo/inactivo;
orden configurable; números de página clickeables; `/catalogos/moviles`;
renombrar `identificador` → `patente`; deploy.
