# Plan: rediseño "Central Sertec" (ADR-025)

Fecha: 2026-09-21. Carril completo. Spec visual:
`docs/superpowers/specs/2026-09-21-redisenio-central-sertec-mockup.html`
(dirección B "Grafito industrial"; también en
https://claude.ai/artifact/SENhNr72nKf24tFte9RJw7).

Rutas: **FE** = worktree
`Frontend/.claude/worktrees/redisenio-central-sertec` (rama
`feat/redisenio-central-sertec`); **BE** = worktree
`Backend/.claude/worktrees/redisenio-central-sertec` (rama
`docs/redisenio-central-sertec`, solo docs).

## Decisiones cerradas

1. Nombre **Central Sertec** ("Central" en la pestaña, "CS" en la barra
   plegada). Sin correos que renombrar (no existen).
2. Áreas: **Operación** (reporte diario, mis registros, aprobaciones, control
   general, km por tantos, combustible), **Personas** (novedades, ausencias),
   **Resultados operativos** (liquidación con sus pestañas: quincena,
   análisis, cierres, **perfiles**, tarifas; y certificaciones),
   **Administración** (usuarios, catálogos). Los roles siguen decidiendo
   visibilidad; un área sin módulos no se muestra. **Corrección del usuario
   (2026-09-21): Perfiles queda dentro de Liquidación, no es módulo de
   Personas.**
3. Dirección "Grafito industrial": barra `#1b1f24`, texto claro, dorado solo
   en activo y títulos de área; contenido claro sobre `#f3f1ec`; franja
   fotográfica en el inicio; login con foto y tarjeta oscura. Tipografías,
   barra plegable (`localStorage['sidebar-plegado']`, valores `'1'/'0'`),
   `PageHeader`, pills, tablas y `StatTile`s se conservan.
4. Alcance total en etapas, un PR por etapa (3 PRs Frontend en la etapa 3).
   Cada PR deja producción coherente.
5. Fotos: marcador (gradiente grafito + luz dorada) hasta que el usuario las
   mande; encendido = copiar a `public/fotos/` y setear la ruta en
   `src/lib/fotos.ts`.

## Premisas corregidas por el planificador

- El mockup no estaba en el repo: guardado como spec (arriba).
- No hay tests que afirmen "Registro de Horas": hay que **agregar** tests
  del nombre nuevo. Textos viejos en 4 líneas: `app-shell.tsx:24-25`,
  `login/page.tsx:36`, `layout.tsx:25`.
- Contraste: dorado sobre grafito 8,6:1 (OK). Fallan: dorado como texto
  sobre claro (usar `brand-deep`), `slate` sobre grafito (usar `white/70`),
  hover `bg-accent` sobre grafito (usar `bg-white/8`), blanco sobre foto sin
  velo ≥ 55 %.
- "Perfiles" es hoy una pestaña de `/liquidacion`
  (`features/liquidacion/liquidacion-nav.ts`); ponerlo en Personas exige un
  `NavItem` propio, ícono, y "mejor coincidencia" para el ítem activo.
- `StatTile` son 5 componentes locales con APIs distintas y tests atados a
  clases (`carga-page.test.tsx:624-631`, control-general colorea solo si > 0).

## Preguntas abiertas resueltas con el default (salvo que el usuario diga otra cosa)

1. Mockup guardado como HTML en specs. **Hecho.**
2. Subtítulo de la barra: **"Sistema interno"**.
3. Barra plegada: **monograma "CS"** en vez del logo; el logo sigue en la
   barra desplegada, el login y el favicon.
4. "Perfiles de empleados" como ítem propio en Personas: **NO** (decisión del
   usuario). Sigue siendo pestaña de Liquidación; no se agrega ítem, ícono ni
   "mejor coincidencia" del activo.
5. Franja del inicio: saludo + fecha + quincena en curso; el tile de cierre
   queda como está.
6. Fotos: dos (inicio ~1920×700, login 1920×1080), ≤ 400 KB, `public/fotos/`.
7. Favicon: se conserva el logo actual.
8. Pestaña: `title: 'Central Sertec'`.
9. Fondo del contenido: `sand-deep #f3f1ec` con tarjetas blancas.
10. Descripción de la tarjeta `/certificaciones` (hoy falta): "Cargar y seguir
    las certificaciones por contrato: resumen, analytics, ítems e historial."
11. Copy del login: "Sistema interno de Sertec".
12. `SubNav` compartido (3 copias idénticas hoy): **sí**, en el PR 3a.
13. Deploy: por PR, solo con pedido explícito.
14. Orden en Operación: el del ADR (combustible al final).

## Etapa 1 — PR 1: tokens + shell + nombre

Rama `feat/redisenio-central-sertec` (el worktree actual). Verificación de
cada par: test rojo → verde, `npx tsc --noEmit`, `npm run lint`; visual con
`npx next dev --webpack`.

- **1.1 Tokens** (`src/app/globals.css` `@theme`): `--color-graphite #1b1f24`,
  `--color-graphite-2 #242931`, `--color-sand-deep #f3f1ec`. `.dark` intacto.
  Verificación: compila y las clases existen (se usan en 1.3).
- **1.2 Áreas en `nav.ts`** (par). Test rojo en `nav.test.ts`: todo ítem tiene
  `area` en `AREAS`; `AREAS` en orden operacion, personas, resultados,
  administracion con sus labels; `navPorArea(HyS)` → solo Personas
  `['/novedades','/ausencias']` (mantiene el `toEqual` existente);
  `navPorArea(Operario)` → solo Operación `['/mis-registros']`; Admin con
  cert → 4 áreas; área sin ítems no aparece. Implementación: `AreaId`,
  `Area`, `AREAS`, `NavItem.area`, `NAV_ITEMS` reordenado por área,
  `navPorArea(perfil)`. Sin ítems nuevos. `navForRole` y `canAccess` no
  cambian de firma.
- **1.3 Shell grafito** (par). Test rojo en `app-shell.test.tsx` (perfil mock
  con `puedeCargarKmPorTantos: false, cert: null`): muestra "Central Sertec" y
  no los textos viejos; desplegado muestra títulos de área; plegado muestra
  "CS" y no títulos. Los 5 tests existentes siguen verdes.
  Implementación en `app-shell.tsx`: `aside`/topbar/drawer `bg-graphite
  text-white border-white/10`; Brand "Central Sertec" + "Sistema interno"
  `text-white/60`; plegado → "CS" `font-display text-brand` sobre
  `bg-white/6`; `NavLinks` por área con título `text-[10.5px] uppercase
  tracking-[0.14em] text-brand/90` (plegado: separador `border-white/10`);
  links `text-white/70 hover:text-white hover:bg-white/8`, activo
  `border-l-[3px] border-brand bg-white/8 text-white font-medium`; el ítem
  activo se resuelve como hoy (`startsWith`); `UserFooter` avatar `bg-brand
  text-ink`, salir `text-white/70 hover:text-danger`. Fondo del contenido
  `bg-sand-deep`. `RUTAS_ANCHAS` sin cambios. Visual: 7 roles, hover, activo,
  plegado, drawer < 768 px, foco visible.
- **1.4 Nombre en login y pestaña; limpieza de `public/`** (par). Test rojo en
  `login-page.test.tsx`: heading "Central Sertec". `login/page.tsx:36`;
  `layout.tsx` metadata title "Central Sertec", description "Sistema interno
  de Sertec: horas, novedades, liquidación, certificaciones y combustible";
  borrar `public/{file,globe,next,vercel,window}.svg` (0 referencias). Al
  cierre: `grep -r "Registro de Horas" src` = 0.
- Cierre: suite completa, tsc, lint, recorrida visual por rol, mostrar al
  usuario, PR, merge; deploy solo a pedido.

## Pasos R de la etapa 1 (hallazgos de la revisión visual, 2026-09-21)

- **R1 (par).** En una ventana de 577 px de alto, la barra desplegada (4
  títulos de área + 11 ítems + pie) es más alta que la pantalla: "Admin" y el
  botón "Plegar menú" quedan tapados por el pie de usuario y la rueda del
  mouse desplaza el contenido, no la barra. Escenario: notebook chica o
  ventana no maximizada → no se puede plegar ni llegar a Administración.
  Arreglo mínimo en `app-shell.tsx`: el `aside` es `flex flex-col h-screen`
  con la lista de navegación en un contenedor `flex-1 min-h-0 overflow-y-auto`
  y el pie (usuario + toggle) fuera del scroll, fijo abajo. Mismo tratamiento
  en el drawer móvil. Test rojo: el contenedor de la navegación tiene
  `overflow-y-auto` y `min-h-0`; el pie no está dentro de él.

## Revisión de la etapa 2 (2026-09-21)

Pares 2.1-2.4 hechos. Suite 743/753 con 10 timeouts por carga que pasan
aislados (92/92). Revisión: **0 urgent, 0 high, 10 minor, 4 descartados**;
sin pasos R. Dos decisiones estéticas que el plan no cerraba quedan para el
usuario en la muestra: logo/título dentro de la tarjeta del login (mockup) o
fuera (implementado); un color por área (mockup) o todas dorado
(implementado). Deuda preexistente anotada: anillo de foco `brand/40` del
botón de login sobre grafito ~2,5:1.

## Etapa 2 — PR 2: inicio + login

Rama `feat/central-sertec-2-inicio-login` (desde main tras el PR 1).

- **2.1 `FondoFoto` + marcador** (par). `src/lib/fotos.ts` con `FOTOS = {
  inicio: null, login: null }`; `components/layout/fondo-foto.tsx`:
  contenedor `relative overflow-hidden bg-graphite`, `<Image fill priority
  sizes="100vw" alt="">` solo si hay `src`, y siempre dos velos (gradiente
  grafito → 40 % y luz dorada radial `brand/25`). Test: sin `src` no hay
  `img`; con `src` hay `img` con `alt=""`.
- **2.2 Inicio full-bleed** (par). `RUTAS_SIN_CONTENEDOR = ['/']` en
  `app-shell.tsx`: wrapper `data-contenedor="libre"` sin padding/max-w. Test
  en `app-shell.test.tsx`.
- **2.3 Inicio por áreas** (par). Test nuevo `(protected)/page.test.tsx`
  (mocks de sesión, navegación y hooks; `vi.setSystemTime(2026-09-21)`):
  saludo "Hola, {nombre}"; "2ª quincena de septiembre 2026"; Admin ve los
  títulos de área, HyS no ve "Operación"; tarjeta `/certificaciones` con
  descripción. Implementación: `<FondoFoto src={FOTOS.inicio}>` con saludo,
  fecha (`Intl.DateTimeFormat('es-AR', { weekday, day, month })`) y
  `nombreQuincena(...)`; debajo `max-w-5xl` con `FilaIndicadores` sin cambios
  y una sección por `navPorArea(perfil)` con la grilla de tarjetas actual.
  `DESCRIPCION` gana `/certificaciones`.
- **2.4 Login con foto y tarjeta oscura** (par). Tests existentes intactos +
  heading + subtítulo "Sistema interno de Sertec". `FondoFoto
  src={FOTOS.login}` a pantalla completa; tarjeta `max-w-sm rounded-2xl
  border-white/10 bg-graphite/90 backdrop-blur`; inputs `bg-white/5
  border-white/15 text-white`, foco `border-brand ring-brand/30`; botón
  `bg-brand text-ink`. Visual a 360 y 1440 px, error de credenciales, foco.
- Cierre igual que la etapa 1. `403` y "Cargando…" quedan claros.

## Etapa 3 — módulos por área (3 PRs)

Solo encabezado con área, tiles compartidos y sub-nav compartido. **Nada de
lógica.** 34 `page.tsx`:

- Operación (7): `reporte`, `mis-registros`, `aprobaciones`,
  `control-general` (+ `StatTile` local → compartido), `km-por-tantos`,
  `combustible`, `combustible/nueva`.
- Personas (2): `novedades` (conservar eyebrow condicional "Las que cargaste
  vos"), `ausencias`.
- Resultados operativos (13): `liquidacion/{page (redirect), quincena,
  quincena/detalle, cierres, cierres/[id], perfiles, tarifas (headers en
  `precios-vigentes-tab.tsx:60` y `sueldos-mensualizados-tab.tsx:79`),
  analisis (+StatTile)}`, `certificaciones/{page (+StatTile), carga
  (+StatTile con `testId`, `min-w-0`, `break-words`, tamaño por longitud,
  tone manual), analytics (+StatTile), items, historial}`.
- Administración (11): `admin/page (redirect)`, `usuarios`, `contratos`,
  `tareas`, `moviles`, `provincias`, `tipos-novedad`, `categorias-uocra` (sin
  test: agregar mínimo), `estaciones-servicio`, `tipos-combustible`,
  `accesos-certificaciones`.

- **PR 3a — base + Operación** (`feat/central-sertec-3a-operacion`).
  3a.1 `PageHeader` con `area?: AreaId` (par, test nuevo
  `page-header.test.tsx`: con área renderiza "Operación"; con área y eyebrow
  "Operación · Las que cargaste vos"; sin área igual que hoy).
  3a.2 `StatTile` compartido (`components/stat-tile.tsx` + test) con API
  unión: `label, value, sub?, tone?, colorearSoloSiPositivo?, icon?, href?,
  onClick?, testId?, animar?`; tests: valor > 12 chars → `text-lg` +
  `break-words`/`min-w-0`; `data-testid` en el valor; tone warn con 0 →
  ink; `href` → link, `onClick` → button. Reemplaza el de control-general y
  el `Indicador` del inicio. 3a.3 `SubNav` compartido (par) para los 3
  layouts. 3a.4 Páginas de Operación: test de área en cada
  `*-page.test.tsx` + el cambio de `PageHeader`.
- **PR 3b — Personas + Administración** (`-3b-personas-admin`): 12 cambios de
  una línea con su test de área.
- **PR 3c — Resultados operativos** (`-3c-resultados`): liquidación (6 pages
  incl. perfiles + 2 tabs), análisis + StatTile, certificaciones ×5 con 3
  StatTiles. **Toca
  vistas de cierres y precios → 2 rondas de review**, aunque sea solo
  encabezado.

## Docs (PR Backend `docs/redisenio-central-sertec`)

ADR-025 (hecho), spec mockup (hecho), este plan, `CONTEXT.md` (hecho),
contexto sección **91** al terminar (o una por etapa si se deployan por
separado), `docs/2026-MM-DD-central-sertec-etapaN-deploy.md` por deploy.

## Riesgos

- Contraste en la barra y sobre fotos (ver premisas). Revisar hover, activo,
  foco, disabled y `prefers-reduced-motion`.
- Orden de `NAV_ITEMS` cambia el orden de barra e inicio para todos; el test
  de HyS exige novedades → ausencias dentro de Personas.
- `RUTAS_ANCHAS` y el full-bleed de `/` (coincidencia exacta).
- Fotos pesadas en móviles: `next/image`, ≤ 400 KB, `priority` solo en el
  inicio. Resuelto en 2.1/2.4: `FondoFoto` acepta `prioridad?: boolean`
  (default `true`); el login lo pasa en `false`.
- `StatTile` unificado vs. tests de clases: componente testeado antes de
  reemplazar; uno por PR.
- Producción a medio camino tras el PR 1 (barra nueva, inicio viejo con
  nombre nuevo): aceptado; se puede deployar 1 y 2 juntas.
- Dev en worktree: `next dev --webpack`; si `next build --webpack` no existe
  en Next 16.2, el build de verificación va en el checkout tras el merge.
- Sin DDL, sin API, sin datos: nada irreversible salvo el `localStorage`, que
  no cambia.

## Fuera de alcance

Lógica de módulos; Backend salvo docs; fotos reales y su edición; identidad
gráfica nueva (logo/favicon "CS"); modo oscuro real; tipografías; rediseño
interno de tablas, formularios, diálogos y gráficos; gating de roles
(Combustible sigue solo Admin); `403` y "Cargando…"; nombres de repos y
`README`; indicadores nuevos en el inicio; correos.
