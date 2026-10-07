# Plan: rediseño ERP de Central SER&TEC

Fecha: 2026-10-07. Carril completo. **El brief manda**: `Backend/docs/superpowers/plans/2026-10-07-rediseno-erp-brief.md`. Este plan no reabre nada de lo que el brief da por decidido.

Raíz: `C:\Users\Administrador\Desktop\SE Gero\Aplicaciones Web\Formulario_Horas\`. Las rutas `Frontend/...` y `Backend/...` son relativas a esa raíz. Una ruta `src/...` sin prefijo es del Frontend.

Worktrees (misma convención que el rediseño del 2026-09-21): `Frontend/.claude/worktrees/<rama>` y `Backend/.claude/worktrees/<rama>`. Se crean al ejecutar cada etapa. En este plan, **FE** es el worktree del Frontend de la etapa y **BE** el del Backend.

> **Actualización 2026-10-07 (usuario):** la rama de integración es **`dev`** (ya creada en los dos repos desde `main`), no `dev`. Flujo general en `Backend/docs/flujo-de-ramas.md`. Donde este plan dice `dev`, leé `dev`; el release final es el PR `dev` → `main`. Los dos arreglos urgentes (pastilla "Activo" y bandeja de HyS) salieron del plan como **hotfix** a `main` (P8 = sí) y se traen a `dev`. Decisiones: P9 = Cargar primero en Facturación; P14 = congelar features de Frontend en `main` (solo hotfixes); P16 confirmado: Accidente no afecta presentismo y no se pregunta al justificar. El resto de las preguntas sigue abierto.

---

## 1. Qué se pide

Rehacer la organización y la estética de todo el Frontend como un ERP. Son seis módulos (Operación, Personal, Liquidación, Facturación, Flota, Administración) con un menú lateral de dos niveles y sin pestañas arriba. El Inicio pasa a ser "Mi trabajo", con la línea de la quincena. Personal se arma por un campo nuevo, **Grupo**, en el catálogo de tipos de novedad (DDL). Las estructuras de cada pantalla ya están elegidas en el brief, y entran todos los arreglos de la revisión del 2026-10-05.

El Backend solo se toca para tres cosas: el campo Grupo, los datos del Inicio y el estado de Tarifas por mes. No cambian permisos, cálculo ni cierres. Todo se entrega por etapas sobre la rama de integración `dev`. Nada llega a `main` ni a producción hasta que el usuario apruebe el producto en local.

---

## 2. Qué encontré en el código

### 2.1 Premisas que hay que corregir (leer primero)

1. **`bajasSinConfirmar` no está en el tipo del Front.** El backend lo devuelve (`Backend/src/liquidacion/calculo.service.ts:543-550`), pero `AlertasQuincena` en `src/lib/api/liquidacion.ts:130-145` solo declara `sinPerfil`, `perfilIncompleto` y `sinHorasAprobadas`. Hay que agregarlo (Etapa 4b).
2. **Los modales hechos a mano son 18, no 17**, sin contar el drawer del shell:
   - `features/reporte/cargando-modal.tsx:3`
   - `features/novedades/nueva-novedad-form.tsx:202` (confirmar baja)
   - `editar-novedad-dialog.tsx:65`, `detalle-novedad-dialog.tsx:73`, `anular-novedad-dialog.tsx:22`
   - `app/(protected)/ausencias/page.tsx:101`
   - `features/liquidacion/precios-vigentes-tab.tsx:103` y `:276`
   - `certificaciones/items/page.tsx:141` y `:298`, `certificaciones/historial/page.tsx:49`, `certificaciones/carga/page.tsx:1590`
   - `features/aprobaciones/desaprobar-dialog.tsx:14`, `corregir-horas-dialog.tsx:22`
   - `features/combustible/detalle-carga.tsx:120`, `:330` y `:401`
   - `features/admin/resetear-password-dialog.tsx:15`

   Además está el drawer móvil de `components/layout/app-shell.tsx:285`. Hay dos diálogos que ya usan `ui/dialog` y son la referencia de estilo: `features/liquidacion/cerrar-quincena-dialog.tsx` y `features/admin/crear-movil-dialog.tsx`.
3. **Accidente en "Ausencias" tiene dos trampas**:
   - El diálogo de hoy pide presentismo para cualquier tipo que no sea baja (`ausencias/page.tsx:98`). El backend solo lo guarda para `'Ausencia'` (`novedades.service.ts:438-442`), así que justificar un Accidente **no** tiene que preguntar presentismo.
   - HyS puede resolver cualquier tipo, porque `resolverHys` no restringe. Pero solo puede **editar o anular** Ausencia y Baja (`novedades.service.ts:273-279`). Un Accidente se le muestra sin Editar ni Anular a HyS.
4. **`agrupar.ts:53` no cuenta `posteriorABaja` como alerta.** Para el grupo "Con alertas" hay que sumarlo (ADR-026 dice que esos registros "se marcan").
5. **El bug de Análisis es más amplio que `:106`.**
   - `analisis/page.tsx:106` cubre `empleados === 0`, pero no un total en 0 con empleados (el caso real: 105 filas en −100 %).
   - `DeltaSub` (`:43-54`) y `claseDelta` (`features/liquidacion/analisis/colores.ts:39-43`) no siguen la regla "Costo que Sube" de `DESIGN.md`: hoy la baja sale en pizarra (debería ser verde) y la suba chica en ámbar (debería ser rojo).
   - `fmtHoras` usa 2 decimales (`colores.ts:25`).
6. **Los rótulos de grupo del menú miden 10,5 px** (`app-shell.tsx:89`). `DESIGN.md` dice a la vez "10.5 px" y "nada por debajo de 11 px". Gana la regla de 11 px y `DESIGN.md` se corrige.
7. **La "línea de dato vivo" no puede ir arriba del título.** `craft-floor.md` prohíbe sin excepción el rótulo sobre el título, y `DESIGN.md` permite "junto o debajo". Va **debajo**.
8. **Las páginas de decisión de impeccable no quedaron guardadas.** `Frontend/.impeccable/questions/` solo tiene IDs. La única descripción de cada estructura es el texto del brief §3 y de `estado.md`. Si algo visible no está descrito, el ejecutor frena y pregunta: no inventa.
9. **`PRODUCT.md` y `DESIGN.md` del Frontend no están commiteados** (`estado.md`). No van a existir en los worktrees. La Etapa 0 los sube a `dev`, así que llegan a `main` recién al final, que es lo que pide "van al final". La skill impeccable, `.impeccable/` y la revisión están fuera de git: se leen siempre desde el checkout principal.
10. **El orden de Facturación choca con una decisión anterior.** El brief lista "Resumen · Cargar · Historial · Ítems · Tablero". `features/certificaciones/certificaciones-nav.ts:15-18` dice que el 2026-09-03 el usuario pidió **Cargar primero**. Ver pregunta P9.
11. **`createdAt` ya llega en la API.** `RegistroPorAprobar` no lo tipa (`src/types/domain.ts:87-123`), pero `porAprobar` usa `include` y Prisma devuelve todos los escalares (`registros-horas.service.ts:748-756, 806-814`). "Cuándo cargó" no necesita backend: alcanza con tiparlo.
12. **El Liquidador no puede abrir Aprobaciones.** `GET /registros-horas/por-aprobar` es solo JefeContrato y Admin (`registros-horas.controller.ts:48-49`), y el menú tampoco se la muestra al Admin (`nav.test.ts:53-57`). La línea "6 registros sin aprobar →" del tablero de Quincenas solo puede llevar a Aprobaciones a quien la ve. Ver P11.
13. **"Liquidado" choca con el glosario.** `CONTEXT.md` evita "liquidar" como sinónimo de cierre (eso lo hace el liquidador de sueldos). El brief decide la etiqueta "Liquidado". Se conserva y se define en `CONTEXT.md` como "preliquidación sin pendientes ni alertas: lista para cerrar".
14. **Prisma comparte el cliente generado si `node_modules` es un enlace.** El cliente sale en `node_modules/.prisma` (el `generator client` de `schema.prisma:1-3` no tiene `output`). Si el BE de la Etapa 2 enlaza `node_modules` como pide el flujo, `prisma generate` pisa el cliente del checkout principal. Ver riesgo R4.
15. **El Bono y el Plus individual son por quincena** (`liquidacion.service.ts:173-217`, `schema.prisma:435-451`). "Un solo período para todo" en Tarifas significa un solo mes, con 1ª y 2ª quincena dentro de esos dos pasos.
16. **El Plus individual no tiene "resuelto"** (`CONTEXT.md`, "Plus individual"). En el "N de 6" de Tarifas no puede faltar nunca; ver la decisión D3.
17. **Los nombres reales de los tipos hay que verificarlos en la base.** El brief dice "Viático"; el código y los tests usan **"Viáticos"** (`cierres.service.spec.ts:197`, `docs/glosario.md:32`). El backfill del DDL va por nombre exacto confirmado con un `SELECT` en cada base.
18. **Alta masiva usa el CUIL como contraseña.** `admin.service.ts:294` pone `password = e.cuil`, y el reseteo hace lo mismo (`:249-253`). Confirma B3 (`alta-masiva.tsx:46` dice "contraseña aleatoria").

### 2.2 Lo que ya existe y sirve

- **Visibilidad**:
  - `navForRole` en `components/layout/nav.ts:57-77` tiene las reglas: el claim `cert` en `:63`, JefeCuadrilla con tipos habilitados en `:67-69`, el permiso de km en `:72-74`, y Combustible solo Admin en `:41-42`.
  - `canAccess` está en `lib/auth/guards.ts:4-8`.
  - Los guards de layout están en `admin/layout.tsx`, `liquidacion/layout.tsx` y `novedades/layout.tsx`.
  - El filtro por nivel de cert está en `certificaciones/layout.tsx:16-24`.
  - Todo eso se porta tal cual. `nav.test.ts` fija las reglas por rol y se reescribe sobre módulos sin perder ningún caso.
- **Backend reutilizable**:
  - `GET /liquidacion/quincenas` (`panel.service.ts:78-143`: estado, pendientes, alertas).
  - `GET /liquidacion/cierres` (`CierreResumen`: versión, `createdAt`, `cerradoPor`, `totales`).
  - `GET /liquidacion/quincena/alertas`.
  - `GET /registros-horas?cargadoPorCuil&desde&hasta`, scopeado al mismo usuario (`registros-horas.service.ts:255-264`), para los frecuentes.
  - `GET /novedades` con `estadoHys`, `estado` y período (`novedades.service.ts:226-265`).
  - `PATCH /registros-horas/:id/reabrir` (`:525-557`).
  - `resolverLote` devuelve los `ids` (`:388`).
  - Tarifas por período con su `sugerencia` (`liquidacion.service.ts:119-290, 455-503`).
- **Frontend reutilizable**:
  - `ui/dialog.tsx` (base-ui), `ui/popover.tsx`, `Paginador`/`paginar` (`components/paginador.tsx`), los skeletons (`components/skeleton.tsx`), `StatusBadge` (`components/status-badge.tsx`, ya es un `span`), `redondearHoras` (`lib/horas.ts`), `nombreQuincena` (`features/liquidacion/formato.ts:21-24`).
  - `CertificadosNovedad`, `QuincenaCampos` y `descargarExcelCierre`.
  - `lucide-react` ya está instalado (`package.json:22`).
- **Patrones a copiar**:
  - Guard de layout con test: `novedades/layout.tsx` y su test.
  - Script de DDL: `Backend/docs/sql/2026-10-05-baja-de-operario.sql` y `2026-09-11-perfiles-horas-extra-pactadas.sql` (modo estricto, precondición, ensayo, verificación, rollback).
  - Spec de servicio con Prisma mockeado: `Backend/src/admin/admin-combustible.spec.ts`.
  - DTOs con `@IsIn([...])`: `liquidacion/dto/liquidacion.dto.ts:29`.
  - Constante de dominio en `src/common/`: `src/common/baja.ts`.

### 2.3 Lo que hay que crear

- **Backend**:
  - Columna `grupo` y enum `GrupoNovedad`, con DDL y backfill.
  - Filtro `?grupo=` en `GET /novedades`.
  - `grupo` en el catálogo, en el perfil y en los DTOs de Admin.
  - `GET /liquidacion/tarifas/estado`.
  - `GET /inicio/linea-quincena`.
  - Nombres en lugar de CUIL en combustible y en "anulada por".
- **Frontend, componentes**:
  - Menú de dos niveles (`nav.ts` por módulos y `app-shell.tsx`).
  - `PageHeader` con `dato` y `volver`.
  - `Dialogo` y `ConfirmDialog`, `ListaDetalle`, `EstadoVacio`/`EstadoError`.
  - `lib/formato.ts` y `lib/rutas.ts` (el contrato de los enlaces profundos).
  - Patrón de catálogo, `PantallaPersonal`, la línea de la quincena, el tablero de quincenas y Tarifas por pasos.

### 2.4 Convenciones que el cambio respeta

- Marca siempre desde `src/lib/marca.ts`.
- Horas con `redondearHoras` solo al mostrar. El render es "número + ` hs`", con punto y sin coma es-AR (`lib/horas.ts:7-9`). No se pasan a `toLocaleString`.
- Tablas sin scroll horizontal, gráficos con Recharts, letra mínima de 11 px, sin modo oscuro.
- `Button` propio (`components/button.tsx`) para la app. El de shadcn queda para los componentes base.
- DDL en `Backend/docs/sql/AAAA-MM-DD-<tema>.sql`. El enum de la base va en minúscula (`zona_override ENUM('norte','sur')`).
- Reglas de negocio por nombre de tipo (`TIPO_BAJA`, 'Ausencia', 'Suspensión'): **no se tocan**. El Grupo es solo presentación.
- Next.js 16: leer `Frontend/node_modules/next/dist/docs/` antes de usar `useSearchParams`, `redirect`, `params` dinámicos o `--webpack`. Turbopack es el default; en el worktree se usa `next dev --webpack` y `next build --webpack`.

---

## 3. Pasos

### 3.0 Reglas comunes (valen para todas las etapas)

**Ramas y PRs.**
- Cada etapa tiene su rama propia, creada desde `dev`, y su PR va **contra `dev`**.
- Merge con `gh pr merge N --merge --admin`.
- Sin deploy.
- Ramas, commits, PRs, merge y DDL los hace el orquestador con OK del usuario. El ejecutor no.

**Sincronizar con `main` al arrancar cada etapa (bloque S).**
- `git fetch`. Si `origin/main` avanzó, merge de `origin/main` en `dev` en los dos repos, resolución de conflictos y suite completa del repo afectado.
- Si `main` trajo un DDL, anotar el orden en `docs/sql`.

**Worktree y `.env`.**
- Frontend: enlazar `node_modules` (`mklink /J`) y levantar con `--webpack`.
- Backend: desde la Etapa 2-B, **`npm ci` propio en el BE** (no enlazar; ver R4).
- `.env` de tests con valores ficticios a partir de `.env.example`. Para levantar la app, solo las variables de `testing`. Nunca las de `Horas_Sertec`.
- Antes de levantar 3000/3001, mirar `netstat`.

**Pares (test rojo → implementación).**
- Cada par trae las dos salidas.
- Componente nuevo: primero un stub que compile (devuelve `null` o `[]`), para que el rojo sea de aserción y no de import.
- Bug de la revisión (A1, B1, B2, B3, B6, C1, `posteriorABaja`): el rojo se muestra **contra el código actual**, antes de reemplazarlo.

**Verificación estándar.**

| Repo | Al cerrar cada par | Al cerrar la etapa, una vez |
|---|---|---|
| Frontend | `npx vitest run <archivos del área>` | `npx vitest run` (suite completa), `npx tsc --noEmit`, `npm run lint`, `npx next build --webpack` |
| Backend | `npx jest <ruta>` | `npx jest`, `npm run build`, y si cambió el esquema `npx prisma validate` + `npx prisma generate` |

En el Frontend, los ~10 timeouts por carga conocidos se corren aislados: si pasan solos, son flaky y se anotan.

**Bloque I (impeccable), obligatorio en todo paso visual.** El briefing del ejecutor lleva:
1. La estructura elegida, citando el texto del brief §3 que aplica.
2. Que lea **antes de editar** `C:\Users\Administrador\Desktop\SE Gero\Aplicaciones Web\Formulario_Horas\Frontend\.claude\skills\impeccable\reference\craft-floor.md` y `<FE>\DESIGN.md`.
3. Que las reglas de `CLAUDE.md` (raíz) y de `Frontend/CLAUDE.local.md` mandan sobre la skill.
4. Que si algo visible no está descrito, devuelve FRENADO con la pregunta.
5. Que los hallazgos del hook de diseño siguen la misma regla. Nunca se agrega un `ignore-*` sin OK.

**Bloque C (cierre de etapa, lo hace el orquestador).**
1. Suite y build, una vez (verificación estándar).
2. `revision-codigo` sobre el diff contra `dev`, con las zonas sensibles como contexto. Rondas: las que indica cada etapa.
3. **`impeccable critique`** sobre las rutas listadas en la etapa, con la app levantada en local contra `testing` y dos subagentes (A y B). Sus hallazgos se tratan como urgent/high/minor.
4. Mostrar **antes/después sobre la pantalla real**: capturas de `main` y de la rama a 1280 px, y a 390 px en las pantallas de campo.
5. OK del usuario → PR → merge a `dev`.
6. Actualizar `estado.md` con la fase y el próximo paso.

**Rondas de revisión.** Dos rondas en las etapas que tocan permisos o visibilidad (1b, 2-F, 5-B, 7a), precios (4a, 4c) y en el cierre (8). Una en el resto.

### 3.1 Decisiones abiertas del brief (§7): propuesta

Cada una vuelve como pregunta en la sección 5.

**D1. Inicio de Admin y Supervisor** (pregunta P1).
- **Supervisor**: la línea global, más sus pendientes como quien informa:
  - "N ausencias que cargaste esperan certificado o a HyS →" (`/personal/ausencias?estado=pendiente&cargadoPor=yo`).
  - "M bajas que informaste esperan a HyS →" (`/personal/bajas?estado=pendiente&cargadoPor=yo`).
  - Los datos salen de `GET /novedades?estadoHys=pendiente`, filtrando por `cargadoPor.cuil` en el cliente.
- **Admin**: la línea global y los pendientes de Liquidación (tiene el módulo), más dos de configuración:
  - "N jefes de cuadrilla sin contratos habilitados →" (`/admin/usuarios?filtro=sin-contratos`).
  - "M contratos activos sin jefe →" (`/admin/contratos?filtro=sin-jefe`).
  - Los datos salen de `GET /admin/usuarios` y `GET /admin/contratos`. Sin backend nuevo.

**D2. De dónde salen Cargado y Aprobado** (preguntas P2 y P3). Un endpoint nuevo, `GET /inicio/linea-quincena?anio&mes&quincena`, en el módulo nuevo `Backend/src/inicio/`. No va en `registros-horas.service.ts`, que ya tiene 1313 líneas.

Alcance de los conteos según el rol:

| Rol | Qué cuenta |
|---|---|
| Operario | `operarioCuil = yo` |
| JefeCuadrilla | `cargadoPorCuil = yo` |
| JefeContrato | sus contratos (`ContratoJefe`) |
| Liquidador, Admin, HyS, Supervisor | global |

El endpoint devuelve:
- `registros {pendientes, aprobados, desaprobados}` y `horas {pendientes, aprobadas}`.
- `alertas` (conteos de `getAlertasQuincena`) **solo para Liquidador y Admin**; `null` para el resto.
- `cierre {id, version, fecha}`, o `null`, para todos.

Cómo se lee cada etapa de la línea:
- **Cargado**: los registros y las horas, con el avance "día X de N de la quincena".
- **Aprobado**: aprobados ÷ (aprobados + pendientes).
- **Liquidado**: hecho si hay 0 pendientes y 0 alertas (para Liquidador y Admin); para el resto, hecho si hay cierre.
- **Cerrado**: "Cerrada v3 · 17/09" o "Sin cerrar".
- Se muestra la quincena en curso. Si la anterior no está cerrada, también la anterior, primero, porque es la que tiene trabajo de cierre.

**D3. Estado de cada mes en Tarifas** (pregunta P4). Un endpoint nuevo, de solo lectura: `GET /liquidacion/tarifas/estado?desde=AAAA-MM&hasta=AAAA-MM` (máximo 24 meses).

Por mes, la regla de "resuelto" es la misma de `liquidacion.service.ts`: una fila con `vigenteDesde = Date.UTC(anio, mes-1, 1)`. Por paso:

| Paso | Completo cuando… | Si no hay nada que cargar |
|---|---|---|
| Precio por hora | todas las categorías activas tienen fila del mes | — |
| Bono | todas las categorías activas tienen fila en **1ª y 2ª quincena** (una fila en 0 vale: es "sin bono") | — |
| Plus de novedades | todos los tipos con `generaPlus` activos tienen fila | `no_aplica` |
| Km por tantos | hay algún rango del mes | — |
| Plus individual | siempre cuenta como hecho; muestra cuántos hay cargados en 1ª y 2ª | — |
| Sueldos mensualizados | todos los perfiles mensualizados tienen fila | `no_aplica` |

- Cada paso queda en `completo`, `parcial` o `vacio`, salvo los dos casos de la última columna.
- Respuesta por mes: `{anio, mes, pasos{...}, completos, total: 6, faltan: string[]}`. `no_aplica` cuenta como completo.
- Pantalla de entrada: desde 5 meses atrás hasta el mes siguiente. Se destaca el primer mes incompleto, o el actual si están todos completos. Hay un enlace "Ver meses anteriores".

**D4. Frecuentes del Reporte** (pregunta P5).
- Sin backend: `useCargasQueHice(yo, últimos 28 días)` más una función pura `calcularFrecuentes`.
- Cuenta lotes distintos por operario y por móvil.
- Muestra hasta 8 chips de operarios y 4 de móviles, con un mínimo de 2 apariciones.
- Excluye los ya elegidos y los móviles que no están en el catálogo activo.

**D5. Orden y corte de etapas.** Es el de abajo.
- El **Inicio pasa a la Etapa 5**, no a la 2: sus enlaces llevan a pantallas que se crean en las etapas 2 a 4 (Personal por grupo, revisar una carga puntual de Aprobaciones, Quincenas, Tarifas por mes). Hacerlo antes obliga a rehacer los enlaces o deja enlaces rotos en la rama.
- Los backends del Inicio y de Tarifas pueden avanzar en paralelo antes.

### Etapa 0 — Rama de integración, ADR-027 y glosario (S)

- **0.1 (orquestador)**: crear `dev` desde `origin/main` en los dos repos y pushearla.
- **0.2 Backend**, rama `docs/rediseno-erp-adr-027`, PR a `dev`:
  - `docs/adr/2026-10-07-adr-027-modulos-del-erp.md`. Antes, listar los ADR **en el BE** para confirmar el número 027.
  - El ADR cubre: los seis módulos y sus pantallas; menú de dos niveles sin pestañas; tableros dentro de su módulo; Personal por **Grupo** (solo presentación: las reglas siguen por nombre y por marcas); Flota como módulo propio; Inicio "Mi trabajo"; visibilidad por rol y claim sin cambios; URLs que se conservan y las nuevas (`/personal/*`, `/liquidacion/tarifas/[periodo]`).
  - Alternativas descartadas: un módulo de Análisis aparte; Personal por nombre de tipo (renombrarlo lo rompe, como avisa ADR-026); seguir con pestañas.
  - Consecuencias: ADR-025 sigue vigente en nombre e identidad, pero queda reemplazado en la agrupación por áreas.
  - `CONTEXT.md`: "Área" pasa a **Módulo**, con _Avoid_: área. Se suman **Grupo de novedad** (con su default), **Línea de la quincena** (Cargado, Aprobado, Liquidado según 2.1.13, Cerrado), **Tablero (de un módulo)** y **Mi trabajo**.
  - Se suben también este plan y el brief.
  - Verificación: sin tests. El orquestador lee el ADR contra el brief. Revisión: ninguna (solo docs).
- **0.3 Frontend**, rama `docs/rediseno-erp-docs`, PR a `dev`: agregar `PRODUCT.md` y `DESIGN.md` **tal como están hoy** en el checkout (2.1.9). No se edita su contenido.

### Etapa 1a — Componentes base, aditivos (Frontend, M)

Rama `feat/rediseno-1a-componentes`. No toca ninguna página. Bloque I aplica: la estructura sale de los "Componentes comunes" del brief §3, la interacción del §6 y los estados del §5.

| Par | Archivos | Test rojo → qué debe pasar |
|---|---|---|
| 1a.1 | `src/lib/formato.ts` + test | `fechaCorta('2026-10-07')` → `07/10`; año solo si no es el actual; `fechaHora`; `importe(1234567)` → `$ 1.234.567` (0 decimales, 2 opcional); `litros`; `nombreRol('JefeContrato')` → `Jefe de contrato`; `nombreRegimen('por_tantos')` → `Por tantos`; `nombreCorto('PAZ LUCAS')` → `PAZ L.`; `nombreQuincena` re-exportado desde `features/liquidacion/formato.ts` sin romper a quienes lo usan |
| 1a.2 | `src/components/dialogo.tsx` + test (`Dialogo` y `ConfirmDialog` sobre `ui/dialog`) | `role="dialog"` con título y descripción enlazados; Escape cierra; el foco vuelve al disparador; el botón dice el **verbo** recibido (nunca "Confirmar"); "Cancelar" es ghost; deshabilitado mientras `confirmando` o sin `puedeConfirmar`; muestra los `afectados` |
| 1a.3 | `src/components/lista-detalle.tsx` + `src/lib/use-media-query.ts` + tests | Elegir una fila muestra su detalle; la selección se refleja en `?sel=` (router mockeado); en angosto (`matchMedia` falso) el detalle abre aparte, con "‹ Volver a la lista"; la fila es un control con `aria-current`; `onSiguiente`; estados vacío, cargando y error |
| 1a.4 | `src/components/estados.tsx` + test | `EstadoVacio` con su salida (enlace o acción); `EstadoError` muestra el motivo vía `mensajeDeError` y ofrece "Reintentar" |
| 1a.5 | `components/status-badge.tsx` (`activo`/`inactivo`), `components/button.tsx` (foco), `app/globals.css` (`:focus-visible`, `::selection`) + tests | La pastilla `activo` es un `span` (no un botón); `Button` lleva un anillo dorado de foco con separación |
| 1a.6 | `src/lib/rutas.ts` + test | Constructores de los enlaces profundos (ver abajo) |

Los enlaces profundos de 1a.6:
- `aprobaciones({lote})`
- `personal(grupo, {estado, sel, cargadoPor})`
- `quincenaDetalle({anio, mes, q, filtro})`
- `perfiles({filtro})`
- `tarifasMes('AAAA-MM', {paso})`
- `tableroProductividad({filtro})`
- `misRegistros({estado, vista})`

Cierre: verificación estándar. El `impeccable critique` de estos componentes se hace al cerrar la 1b, porque recién ahí se ven en pantallas reales. Revisión: 1 ronda.

### Etapa 1b — Menú de dos niveles, encabezado y barrido (Frontend, L)

Rama `feat/rediseno-1b-shell`. Bloque I aplica: brief §3 "Arquitectura de información", más el §6 "Interacción y distribución". El menú de dos niveles no tuvo ronda de estructura porque ya estaba decidido.

**1b.1 — `components/layout/nav.ts` por módulos (par).**
- `MODULOS: { id, label, icono, pantallas }[]` en este orden:
  - **Operación**: Reporte diario, Mis registros, Aprobaciones, Km por tantos, Tablero de productividad (`/control-general`).
  - **Personal (provisorio hasta la Etapa 2)**: Novedades, Ausencias.
  - **Liquidación**: Quincenas, Cierres, Perfiles, Tarifas, Tablero de costos (`/liquidacion/analisis`).
  - **Facturación** (solo con claim `cert`): Resumen, Cargar (nivel admin o carga), Historial, Ítems (nivel admin), Tablero de certificaciones (`/certificaciones/analytics`).
  - **Flota** (Admin): Cargas de combustible, Nueva carga (`/combustible/nueva`), Móviles, Estaciones de servicio y Tipos de combustible. Los tres catálogos siguen en `/admin/...` (ver P13).
  - **Administración**: Usuarios, Accesos (`/admin/accesos-certificaciones`), Contratos, Tareas, Provincias, Tipos de novedad, Categorías UOCRA.
- Funciones nuevas:
  - `navPorModulo(perfil)` oculta los módulos que quedan vacíos.
  - `pantallaActiva(pathname)` busca la **coincidencia de prefijo más larga**.
  - `canAccess(rol, href)` conserva su semántica.
- Rojo, en `nav.test.ts` reescrito:
  - Se portan **todos** los casos actuales (`nav.test.ts:15-157`): Operario, JefeCuadrilla con y sin tipos, Supervisor, JefeContrato con y sin permiso de km, Admin sin Aprobaciones, Combustible solo Admin, `cert` sin depender del rol.
  - Facturación por nivel: lectura sin Cargar ni Ítems; carga con Cargar y sin Ítems; admin con todo.
  - `pantallaActiva`: `/combustible/nueva` → Nueva carga; `/liquidacion/quincena/detalle` → Quincenas; `/certificaciones` → Resumen; `/certificaciones/carga` → Cargar; `/admin/moviles` → Móviles en Flota.
- Se borran `features/{liquidacion,certificaciones,admin}/*-nav.ts` después de mover sus datos a `nav.ts`.

**1b.2 — `components/page-header.tsx` (par).**
- Firma nueva: `{ title, dato?, volver?: {href, label}, action? }`. Se van `area` y `eyebrow`.
- `dato` va **debajo** del `h1`, en 12-14 px, minúscula, tinta o pizarra. Sin dato no hay línea.
- Rojo en `page-header.test.tsx`: en el DOM el orden es `h1` y después el dato; no aparece ningún nombre de módulo; `volver` es un enlace con ícono lucide.

**1b.3 — `components/layout/app-shell.tsx` (par).**
- Desplegado:
  - Cada módulo es un botón con `aria-expanded`/`aria-controls` y chevron lucide.
  - El módulo de la pantalla activa arranca expandido.
  - Las pantallas miden 14 px; la activa lleva la barra dorada de 3 px y `aria-current="page"`.
  - Los rótulos miden **≥ 11 px**.
- Plegado (56 px): un ícono por módulo, con `aria-label`. Al tocarlo abre un flyout (`ui/popover.tsx`) con sus pantallas.
- Celular: drawer con el mismo árbol; Escape cierra; el foco queda atrapado y vuelve a "Abrir menú".
- Se mantienen la preferencia `sidebar-plegado`, `RUTAS_ANCHAS` y el "inicio sin contenedor".
- Los íconos de módulo salen de lucide (`components/layout/nav-icons.tsx`), con un solo trazo.
- `app/(protected)/layout.tsx`: el "Cargando…" en texto pasa a un skeleton del shell.
- Rojo en `app-shell.test.tsx`: los casos de arriba. Siguen verdes los existentes de plegado y `localStorage` (`:55-131`), los del scroll R1 (`:171-192`) y los del contenedor (`:194-230`).

**1b.4 — Barrido mecánico (paso sin par).**
- Los ~35 usos de `PageHeader` pierden `area=`; `eyebrow` pasa a `dato` (solo en `novedades/page.tsx:217`). Lo guía `tsc`.
- Los ~30 tests "muestra el área X en el encabezado" se **borran a propósito**. Ejemplos: `reporte-page.test.tsx:125-128`, `tarifas-page.test.tsx:160-169`, `usuarios-page.test.tsx:39`; para la lista completa, buscar `muestra el área`. La regla queda cubierta una sola vez en `page-header.test.tsx`.
- Se anota el conteo de tests antes y después.
- `app/(protected)/page.tsx` pasa de `navPorArea` a `navPorModulo`. Las tarjetas siguen hasta la Etapa 5, y `page.test.tsx:117-126` se adapta.

**1b.5 — Layouts sin pestañas (par).**
- `admin/layout.tsx`, `liquidacion/layout.tsx` y `certificaciones/layout.tsx` dejan de mostrar `SubNav`; los guards quedan como están.
- Se borran `components/sub-nav.tsx` y su test.
- Rojo: el layout de Liquidación ya no muestra la `nav` de secciones y el guard sigue redirigiendo a `/403`.

**1b.6 — `DESIGN.md` (docs).**
- Se suman: menú de dos niveles; línea de dato vivo **debajo** del título; `Dialogo`/`ConfirmDialog` (título con verbo y objeto, cuerpo con a quién afecta, botón con el verbo); lista y panel de detalle; pastilla solo de lectura; estados; formato humano; foco; íconos lucide; 44 px en las pantallas de campo.
- Se quita la mención de "10.5 px".
- "Costo que Sube" pasa a nombrar el Tablero de costos y el Tablero de productividad.

**1b.7 — Login y 403.** Misma forma; solo foco y botones del sistema.

Cierre:
- Recorrida con los 7 roles (más Admin con `cert` y un usuario de nivel lectura) a 1280 y 390 px.
- `impeccable critique` sobre el shell (desplegado, plegado y drawer), `/reporte`, `/liquidacion/quincena` y `/admin/usuarios`.
- **2 rondas** (visibilidad por rol).

### Etapa 2 — Personal: Grupo (Backend) + 4 pantallas (Frontend)

#### 2-B Backend (M) — rama `feat/rediseno-2-grupo-novedad`

**2B.1 — DDL (lo aplica el orquestador en `testing`, con OK).** Archivo `Backend/docs/sql/2026-10-XX-grupo-tipos-novedad.sql`, con la estructura de `2026-10-05-baja-de-operario.sql`:

```sql
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';
-- PRECONDICIÓN (anotar):
--   SELECT id, nombre, requiere_aprobacion_hys, genera_plus, activo FROM sth_tipos_novedad ORDER BY id;
--   (confirmar nombres EXACTOS: Ausencia, Accidente, Baja de Operario, Suspensión, Franco, Viáticos/Viático, Guardia Pasiva)
--   SHOW COLUMNS FROM sth_tipos_novedad LIKE 'grupo';   -- 0 filas
--   SELECT COUNT(*) FROM sth_tipos_novedad;             -- anotar
ALTER TABLE sth_tipos_novedad
  ADD COLUMN grupo ENUM('ausencias','bajas','suspensiones','operativa') NOT NULL DEFAULT 'operativa';
UPDATE sth_tipos_novedad SET grupo = 'ausencias'    WHERE nombre IN ('Ausencia','Accidente');
UPDATE sth_tipos_novedad SET grupo = 'bajas'        WHERE nombre = 'Baja de Operario';
UPDATE sth_tipos_novedad SET grupo = 'suspensiones' WHERE nombre IN ('Suspensión','Franco');
UPDATE sth_tipos_novedad SET grupo = 'operativa'    WHERE nombre IN ('Viáticos','Guardia Pasiva'); -- explícito; el default ya lo deja
-- VERIFICACIÓN:
--   SHOW COLUMNS FROM sth_tipos_novedad LIKE 'grupo';  -- enum, NOT NULL, default operativa
--   SELECT grupo, GROUP_CONCAT(nombre ORDER BY nombre SEPARATOR ', '), COUNT(*) FROM sth_tipos_novedad GROUP BY grupo;
--   -- ausencias: Accidente, Ausencia · bajas: Baja de Operario · operativa: Guardia Pasiva, Viáticos · suspensiones: Franco, Suspensión
--   -- Cualquier OTRO tipo en 'operativa' no estaba en el mapeo: anotar y decidir con el usuario.
--   SELECT COUNT(*) FROM sth_tipos_novedad;  -- igual a la precondición
-- ROLLBACK (solo con el backend de rediseno-erp APAGADO contra esta base; el código nuevo lee la columna):
--   ALTER TABLE sth_tipos_novedad DROP COLUMN grupo;
```

- **Backup**: export JSON o CSV completo de `sth_tipos_novedad` (son 7 filas), guardado fuera de git.
- **Ensayo en `testing`**: aplicar, verificar, rollback, verificar, volver a aplicar. Anotar los resultados en el script, como en `2026-09-11-...sql:50-54`.
- **Orden**: el DDL va **antes** de levantar el backend de esta rama contra `testing`. Prisma selecciona todas las columnas de `TipoNovedad` en `include`, por ejemplo en `calculo.service`, y sin la columna se cae.
- El código viejo con la columna nueva funciona, porque el default cubre los INSERT.
- **Producción**: nada hasta la Etapa 8.

**2B.2 — `prisma/schema.prisma`.**
- `enum GrupoNovedad { ausencias bajas suspensiones operativa }`.
- `TipoNovedad.grupo GrupoNovedad @default(operativa)`, con un comentario "presentación, ADR-027".
- `npx prisma validate` y `npx prisma generate`, en el BE con `node_modules` propio.

**2B.3 — Par novedades** (`src/novedades/{novedades.controller.ts, novedades.service.ts}` + `novedades.service.spec.ts`, y `src/common/grupo-novedad.ts` con `GRUPOS_NOVEDAD`).
- `findAll` acepta `grupo` y filtra `where.tipoNovedad = { grupo }`. Un valor inválido devuelve `BadRequestException`.
- `INCLUDE_BASICO.tipoNovedad.select` suma `grupo`.
- `anuladaPor: {cuil, nombre} | null` se resuelve con el mismo mapa de `conNombresCargador`.
- Rojo:
  - Con `grupo: 'ausencias'`, Prisma recibe `where.tipoNovedad.grupo`.
  - `grupo: 'otro'` → 400.
  - La respuesta trae `tipoNovedad.grupo` y `anuladaPor.nombre`.
  - Se conserva el alcance del JefeCuadrilla (`novedades.service.ts:253`): test existente.

**2B.4 — Par catálogo, perfil y Admin.**
- `catalogos.service.ts:31-37` suma `grupo` al `select`.
- `auth.service.ts:71-73` suma `tipoNovedad.grupo`.
- `admin/dto/catalogo.dto.ts:73-98`: `@IsOptional() @IsIn(GRUPOS_NOVEDAD) grupo?`.
- `admin.service.ts:121-131` lo pasa tal cual.
- Rojo:
  - Spec nueva `admin-tipos-novedad.spec.ts`: crear y editar con `grupo` lo pasa a Prisma.
  - Spec del DTO, con el patrón de `catalogo-movil.dto.spec.ts`: rechaza `'otro'`.
  - `auth.service.spec.ts`: el `select` del perfil incluye `grupo`.

Cierre: verificación del Backend. Revisión: 1 ronda, más chequear que **no** cambian `calculo`, `cierres` ni `export-cierre` (`git diff --stat`). PR a `dev` del Backend.

#### 2-F Frontend (L) — rama `feat/rediseno-2-personal`

Arranca después del merge de 2-B y del DDL en `testing`. Bloque I aplica: brief §3 "Personal (4 pantallas, misma estructura)": contadores que filtran, lista con panel al costado, botón de carga, y detalle aparte en celular.

**2F.1 — Tipos y API (par).**
- `types/domain.ts`: `TipoNovedad.grupo`, `Novedad.tipoNovedad.grupo`, `Novedad.anuladaPor`, `Perfil.tiposNovedadHabilitados[].tipoNovedad.grupo`.
- `lib/api/novedades.ts`: `useNovedades(filtros: {grupo?, estadoHys?, estado?, periodo?})`, con una función pura `paramsNovedades` y su test. Se adaptan los que llaman hoy: el Inicio en `page.tsx:82`.

**2F.2 — Navegación y rutas (par).**
- Personal queda con Ausencias, Bajas, Suspensiones y Operativa en `/personal/{ausencias,bajas,suspensiones,operativa}`.
- Roles: los de `/novedades` hoy. El JefeCuadrilla ve solo los grupos donde tiene al menos un tipo habilitado.
- Rutas nuevas: `app/(protected)/personal/layout.tsx` (guard, con el patrón de `novedades/layout.tsx`) y `personal/page.tsx` (redirige al primer grupo visible).
- `novedades/page.tsx` → redirige a `/personal`; `ausencias/page.tsx` → redirige a `/personal/ausencias`.
- Rojo en `nav.test.ts` y en el test del layout: HyS ve los 4; JefeCuadrilla solo con Viáticos ve solo Operativa; Operario va a `/403`.

**2F.3 — `features/personal/grupos.ts` (par, funciones puras).**

| Grupo | Contadores | Alcance de los contadores | Verbos de HyS | Botón de carga |
|---|---|---|---|---|
| Ausencias | Pendientes · Justificadas · Injustificadas | Pendientes de todas las quincenas; el resto, del período | Justificar / No justificar | "Nueva ausencia" |
| Bajas | Informadas · Confirmadas · Rechazadas | Todas, sin período | Confirmar baja / Rechazar baja | "Informar baja" |
| Suspensiones | En curso · Próximas · Cumplidas (por fecha) | Todas | — | "Nueva suspensión" |
| Operativa | Por tipo | Del período | — | "Nueva novedad operativa" |

Las anuladas, en todos los grupos, van aparte con el filtro "Ver anuladas". Los contadores de Suspensiones son temporales: ver P7.

**2F.4 — Bug B2, rojo primero sobre el código actual.**
- Test sobre `ausencias/page.tsx`: con una pendiente de julio y el período en octubre, hoy muestra 0 pendientes (`:182-184`, `useNovedades(periodo)`). Se ve fallar.
- Después ese mismo escenario se porta a la pantalla nueva.

**2F.5 — `PantallaPersonal` (par).**
- Archivos: `features/personal/{pantalla-personal.tsx, detalle-novedad.tsx, contadores.tsx}` y las 4 `page.tsx`. Usa `ListaDetalle`.
- La lista trae operario y legajo, el tipo en un chip neutro, fechas humanas, certificados (ícono lucide y cantidad; "Certificado nuevo") y estado. **No** tiene columna de acciones.
- Panel: datos, `CertificadosNovedad`, quién cargó y cuándo, efectos y acciones.
- Los efectos se describen solo desde reglas existentes:
  - Ausencia justificada: pierde o no pierde presentismo.
  - Baja confirmada: bloqueo de horas y $0 (texto de `ausencias/page.tsx:104-108`).
  - Suspensión: quita el presentismo.
  - `generaPlus`: "genera plus en la liquidación".
- Las acciones de HyS dependen de `tipoNovedad.requiereAprobacionHys` y del rol (HyS o Admin), no del grupo.
- Editar y anular siguen la regla del backend: Admin cualquier tipo; HyS solo Ausencia y Baja.
- Filtros: período, operario y "Cargadas por mí" (este último para los roles que cargan).
- Export CSV de Ausencias para HyS y Admin: se conserva `descargarResumenCsv`.
- Tests rojos:
  - (a) B2 portado.
  - (b) Justificar un Accidente no pide presentismo; justificar una Ausencia sí (ADR-022).
  - (c) Confirmar una baja abre un `ConfirmDialog` que nombra al operario, legajo, CUIL, último día trabajado y el efecto, con el botón "Confirmar baja".
  - (d) HyS no ve Editar ni Anular en un Accidente; Admin sí.
  - (e) Los contadores filtran la lista.
  - (f) En angosto el detalle se abre aparte.
  - (g) `?estado=pendiente&sel=ID` abre el detalle.
  - (h) `ConfirmDialog` para Reabrir (A2) y para Anular (A4: "Anular la ausencia de GOMEZ J. (07/10 → 09/10)").

**2F.6 — `NuevaNovedadForm` (par).**
- Recibe la prop `grupo` y filtra los tipos por grupo, más los habilitados del JefeCuadrilla.
- `ConfirmarBajaDialog` pasa a `ConfirmDialog`.
- Se mantiene la carga de Guardia Pasiva para varios operarios.
- Se corrige la letra de 9 px en `certificados-novedad.tsx:140`.
- Rojo en `nueva-novedad-form.test.tsx`: con `grupo='ausencias'` el selector ofrece solo Ausencia y Accidente.

**2F.7 — Administración › Tipos de novedad (par).**
- Selector "Grupo", obligatorio en el alta (sin preselección) y editable en `tipo-novedad-edit-row.tsx`.
- Rojo: el payload del alta y de la edición lleva `grupo`.

**2F.8** — Los tests de `novedades-page.test.tsx` y `ausencias-page.test.tsx` se migran a la pantalla nueva o se borran a propósito.

Cierre:
- `impeccable critique` sobre `/personal/ausencias`, `/personal/bajas`, `/personal/suspensiones` y `/personal/operativa` (1280 px, y 390 px para el JefeCuadrilla) y sobre `/admin/tipos-novedad`.
- **2 rondas** (guard y visibilidad).

### Etapa 3a — Aprobaciones (Frontend, L)

Rama `feat/rediseno-3a-aprobaciones`. Bloque I aplica: brief §3 "Aprobaciones — dos grupos con tarjetas informativas" y "Revisar abre el detalle al costado".

- **3a.1 — Par `lib/agrupar.ts`**: agrega `motivosAlerta: ('horas_dia'|'duplicado'|'posterior_baja')[]`; `alertas` incluye `posteriorABaja`; suma `cargadoEn` (el `createdAt` mínimo del lote) y `provincia`. **Rojo contra el código actual**: un lote con `posteriorABaja` devuelve hoy `alertas=false`. Además se tipa `createdAt` en `RegistroHoras`.
- **3a.2 — Par, página** `app/(protected)/aprobaciones/page.tsx` con dos componentes nuevos: `features/aprobaciones/tarjeta-lote.tsx` y `detalle-lote.tsx`.
  - La vista Pendientes muestra **todas las quincenas** en dos grupos.
  - "Con alertas": tarjeta con alerta, contrato y horas, botón principal **Revisar** y sin aprobar desde la lista.
  - "Limpias": tildadas, con "Aprobar seleccionadas (N cargas · M registros)".
  - Rojo: una tarjeta con alerta no tiene "Aprobar"; Revisar abre el panel con el día, quién y cuándo cargó, provincia y móviles.
- **3a.3 — Par Deshacer**, `features/aprobaciones/use-aprobacion-diferida.ts`:
  - La aprobación se manda 6 s después.
  - El toast de sonner lleva la acción "Deshacer".
  - Al desmontar o con `pagehide`, se envía lo pendiente.
  - Si cierran la pestaña, la carga sigue pendiente: es el fallo seguro.
  - Rojo con fake timers: no llama a `resolverLote` antes de 6 s; "Deshacer" lo cancela; desmontar lo envía.
- **3a.4 — Par, panel**:
  - Por contrato: tareas, observación y "Corregir horas" (`Dialogo`).
  - Operarios con su casilla y horas, con la alerta junto al nombre.
  - Lo de otro jefe va en gris, sin casilla.
  - Aprobar y desaprobar seleccionados. Desaprobar usa `ConfirmDialog` con motivo obligatorio y nombra "N registros de …".
  - "Siguiente carga".
  - `desaprobar-dialog.tsx` y `corregir-horas-dialog.tsx` se reescriben sobre `Dialogo`.
- **3a.5 — Par, enlaces profundos**: `?lote=` abre el panel; `?operarioCuil=` sigue filtrando (se conserva el test que existe).
- **3a.6 — Par C1**: horas con un decimal en la tarjeta, el panel y la corrección (`lote-card.tsx:109,142`, `corregir-horas-dialog.tsx:26`, `components/lote-resumen-card.tsx:78`). **Rojo contra el código actual** con `horas: '8.25'`.
- **3a.7 — Par, vista "Resueltas"**: control segmentado, no pestañas. Muestra aprobadas y rechazadas por quincena con `LoteResueltoCard`. Reabrir usa `ConfirmDialog`. Los glifos de `resumen-carga.tsx` pasan a lucide.
- `lote-card.tsx` y su test se borran o migran.

Cierre: `impeccable critique` sobre `/aprobaciones` (con alertas, limpias, panel abierto, resueltas) a 1280 y 1024 px. 1 ronda.

### Etapa 3b — Campo: Reporte diario y Mis registros (Frontend, M)

Rama `feat/rediseno-3b-campo`. Bloque I aplica: brief §3 "Reporte diario — el formulario de hoy, para celular", más "Resto, misma forma" para Mis registros.

**Reporte diario** (`reporte/page.tsx` y `features/reporte/{operarios-select,moviles-select,lineas-field,cargando-modal}.tsx`):
- Controles de 44 px (`min-h-11`) por debajo de `sm`.
- Tokens inexistentes `text-neutral`/`text-alert` → tokens reales; `×` → lucide.
- `cargando-modal` pasa a estado en la barra fija.

| Par | Test rojo → qué debe pasar |
|---|---|
| 3b.1 | Ir al primer error: tras "Reportar" con el formulario vacío, el foco queda en "Fecha" |
| 3b.2 | Borrador (`features/reporte/borrador.ts`, clave `reporte-borrador:<cuil>`, vence a los 3 días, sin GPS). Al volver a montar aparece "Tenés un reporte sin enviar del <fecha>: Seguir / Descartar". Se borra al enviar bien. Sin borrador, la fecha sigue vacía (se conserva `reporte-page.test.tsx:40-43`) |
| 3b.3 | `features/reporte/frecuentes.ts` (D4), función pura |
| 3b.4 | `frecuentes-chips.tsx`: chips arriba de la búsqueda; tocar uno lo agrega; los elegidos no aparecen; un móvil inactivo no aparece. `OperariosSelect` pasa a aceptar `Pick<EmpleadoBusqueda,'cuil'\|'apellido_nombre'>` |
| 3b.5 | `app-shell.tsx`: "Cerrar sesión" con un borrador guardado pide confirmación con `ConfirmDialog` ("queda guardado en este teléfono") |

**Mis registros** (`mis-registros/page.tsx`, `features/mis-registros/{registros-cards,cargas-agrupadas}.tsx`):
- **3b.6 (par)**: B6 con **rojo contra el código actual**. Con todo pendiente, hoy el único total es "0 hs" (`registros-cards.tsx:93-105`). Queda "Aprobadas X hs · Pendientes Y hs".
- Se va el bloque dorado gigante (C4, `:129-135`).
- C1 en `:37,59,60` y fechas humanas.

Verificación extra: a 390 px con DevTools en "Slow 3G", medir el peso de la respuesta de frecuentes. Si pasa de 150 KB, se anota y se avisa (R11).

Cierre: `impeccable critique` sobre `/reporte` y `/mis-registros` a 390 y 1280 px. 1 ronda.

### Etapa 3c — Km por tantos y Tablero de productividad (Frontend, M)

Rama `feat/rediseno-3c-km-tablero`. Misma forma, estilo nuevo y arreglos (brief §3 "Resto").

- **3c.1 (par) C1**:
  - Ocurrencias: `control-general/page.tsx` (alrededor de `:136,166,222,237`) y `features/control-general/ranking-operarios.tsx:61`.
  - Rojo: 45.25 → "45.3".
- **3c.2 (par) Filas desplegables accesibles**: el disparador es un `button` con `aria-expanded` (F). Letra de 10 px en `:143` y `:164` sube a 11 px o más.
- **3c.3 (par)**: `?filtro=sin-carga` abre la sección "Sin carga", para el Inicio.
- **3c.4**:
  - Título "Tablero de productividad".
  - Dato vivo con la quincena.
  - Glifos a lucide.
  - Estados.
  - `km-por-tantos/page.tsx`: dato "quincena · N sin km" y estados.

Cierre: `impeccable critique` sobre `/control-general` y `/km-por-tantos`. 1 ronda.

### Etapa 4a — Estado de Tarifas por mes (Backend, S-M)

Rama `feat/rediseno-4a-estado-tarifas`. Archivos:
- `src/liquidacion/estado-tarifas.service.ts` + spec.
- `liquidacion.module.ts` (provider).
- `liquidacion.controller.ts`: `@Get('tarifas/estado')`, con los roles que hereda (Admin y Liquidador).

Lógica de D3: una consulta por tabla en el rango y armado en memoria. **Solo lectura**: no llama ni toca `calculo.service`.

| Par | Test rojo → qué debe pasar |
|---|---|
| 4a.1 | Categorías completo, parcial y vacío |
| 4a.2 | El bono exige 1ª **y** 2ª quincena |
| 4a.3 | Sueldos `no_aplica` sin mensualizados |
| 4a.4 | Fechas UTC: una fila a medianoche UTC cuenta como resuelta (regresión del bug del 2026-08-24, `liquidacion.service.ts:46-55`) |
| 4a.5 | `desde > hasta` o más de 24 meses → 400 |

Verificación extra: en `testing`, comparar dos meses del endpoint contra lo que muestran hoy las secciones de Tarifas. Se anota en el PR.

Cierre: **2 rondas** (zona de precios).

### Etapa 4b — Quincenas (tablero y detalle) y Cierres (Frontend, M)

Rama `feat/rediseno-4b-quincenas-cierres`. Bloque I aplica: brief §3 "Liquidación → Quincenas — tablero por estado"; Cierres va con "Resto".

**4b.1 (par)** `features/liquidacion/tablero-quincenas.ts`, función pura `clasificarQuincenas(quincenas, cierres, alertasPorQuincena, hoy)`:
- **Cerradas**: tienen al menos un cierre; se muestra la versión máxima.
- **En curso**: la quincena que contiene hoy, si no está cerrada.
- **Con alertas**: tiene pendientes, `alertas` o alguna lista de `getAlertasQuincena` no vacía.
- **Lista para cerrar**: el resto.
- Las quincenas abiertas de más de 3 meses van colapsadas en "Anteriores sin cierre (N)" y no piden alertas (P12).

**4b.2 (par)** Líneas que son el enlace, en `tarjeta-quincena.tsx`:
- "N registros sin aprobar →": al JefeContrato le lleva a Aprobaciones; al Liquidador y al Admin, al detalle con `?filtro=pendientes` (P11).
- "N perfiles incompletos: PAZ L., … →" lleva a Perfiles con `?filtro=incompletos`.
- "N bajas sin confirmar →" lleva a `/personal/bajas?estado=pendiente`.
- `AlertasQuincena` suma `bajasSinConfirmar` (2.1.1).
- "Revisar y cerrar" va al detalle.

**4b.3 (par)** Cerradas: versión, fecha, total, "Ver cierre" y "Excel" con `descargarExcelCierre`. Los emojis `🔴🟡🟢` se van (`quincena/page.tsx:12-24`).

**4b.4 (par)** El detalle de la quincena muestra:
- Estado: "Abierta" o "Cerrada v3 · 17/09".
- Totales.
- Aviso "recerrar crea una versión nueva".
- `cerrar-quincena-dialog.tsx`: el botón "Crear cierre v{n}" (A4).

**4b.5 (par)** C1 y C2:
- `fila-empleado.tsx:46-54` (`toFixed(2)`). Es el **rojo**.
- `detalle-empleado.tsx:62`, `tabla-por-tantos.tsx:77-84`, `cierre-detalle-tabla.tsx:10-13`, `quincena/detalle/page.tsx:334`.
- Ningún `min-w-[1100px]`/`[960px]`: lo secundario pasa a fila expandible.

Además: `cierres/page.tsx` y `cierres/[id]/page.tsx`, con el dato "v3 · 17/09 · por X" y "‹ Cierres".

Cierre: `impeccable critique` sobre `/liquidacion/quincena`, el detalle (abierta y cerrada), `/liquidacion/cierres` y `/liquidacion/cierres/[id]`. 1 ronda.

### Etapa 4c — Tarifas por pasos (Frontend, L)

Rama `feat/rediseno-4c-tarifas`. Bloque I aplica: brief §3 "Liquidación → Tarifas — ronda mensual por pasos".

**Archivos**:
- `liquidacion/tarifas/page.tsx` pasa a ser la entrada con los meses (D3).
- Página nueva `liquidacion/tarifas/[periodo]/page.tsx`, con `periodo = AAAA-MM` y `?paso=`. Leer en la doc de Next 16 cómo se leen los parámetros.
- Carpeta nueva `features/liquidacion/tarifas/`: `pasos.ts` y un componente por paso. Las secciones de `precios-vigentes-tab.tsx`, `sueldos-mensualizados-tab.tsx` y `seccion-plus-individual.tsx` se separan sin cambiar payloads ni endpoints.
- `useEstadoTarifas` en `lib/api/liquidacion.ts`.

**Reglas**:
- Un solo mes para todo. Bono y Plus individual muestran 1ª y 2ª quincena adentro del paso.
- "Usar los de <mes de la `sugerencia`>": nombra el mes real y nunca guarda solo.
- "Sin bono este mes" graba 0 en las dos quincenas, para todas las categorías.
- "Siguiente paso" aparece al guardar.
- Sin selectores de período sueltos. Sin `amber-*`: se usa `warn`.

| Par | Test rojo → qué debe pasar |
|---|---|
| 4c.1 | Entrada: meses con su estado y el destacado |
| 4c.2 | "Sin bono este mes" hace PUT de la 1ª y la 2ª con valor 0 |
| 4c.3 | "Usar los de agosto 2026" llena los campos y no hace PUT |
| 4c.4 | Pisar un valor ya resuelto abre un `ConfirmDialog` que nombra las quincenas del mes y, si alguna está cerrada, "cerrada vN: el cierre no cambia; el detalle en vivo sí" (con `useCierres`) |
| 4c.5 | Eliminar un plus individual pide confirmación (A2) |
| 4c.6 | Guardar sueldos que pisan valores resueltos pide confirmación (A2) |
| 4c.7 | Un período inválido muestra el error con salida |

Los tests que fijan payloads se adaptan **sin perder esas aserciones**: `seccion-bono.test.tsx`, `sueldos-mensualizados-tab.test.tsx`, `tarifas-page.test.tsx`, `tarifas-tabs.test.tsx`.

Cierre: `impeccable critique` sobre `/liquidacion/tarifas` y `/liquidacion/tarifas/2026-10` (cada paso). **2 rondas** (escribe precios).

### Etapa 4d — Perfiles y Tablero de costos (Frontend, M)

Rama `feat/rediseno-4d-perfiles-costos`.

- **4d.1 (par) B1, con rojo contra el código actual**:
  - Escenario: `totales.total = 0` con 105 empleados y `anterior.total > 0`. Hoy aparece "−100".
  - Queda un estado "Sin calcular", sin deltas, con salida a Tarifas y a la Quincena.
  - En las filas con `total = 0`, la columna de cambio muestra "—".
- **4d.2 (par)** `claseDelta` y `DeltaSub` con la regla "Costo que Sube": baja en `text-approved`, suba en `text-danger`, sin cambio en `text-slate`.
- **4d.3 (par)** `fmtHoras` pasa a `redondearHoras`.
- **4d.4 (par)** Perfiles (`liquidacion/perfiles/page.tsx`):
  - "Quitar perfil" pide `ConfirmDialog` con el nombre de la persona.
  - "Asignar masivo" nombra a N personas y el régimen (A2).
  - Régimen con `nombreRegimen` (D).
  - `?filtro=incompletos|sin-perfil`.
- Títulos: "Tablero de costos". Skeleton en lugar de "Cargando…" (`analisis/page.tsx:104-105`).

Cierre: `impeccable critique` sobre `/liquidacion/perfiles` y `/liquidacion/analisis`. 1 ronda.

### Etapa 5 — Inicio "Mi trabajo" (Backend M y Frontend M)

**5-B, rama `feat/rediseno-5-inicio`**:
- Archivos: `Backend/src/inicio/{inicio.module.ts, inicio.controller.ts, inicio.service.ts, inicio.service.spec.ts}`, y `app.module.ts`. El módulo importa `LiquidacionModule` (`CalculoService` ya se exporta en `liquidacion.module.ts:16`).
- Pares:
  - Alcance por rol (4 casos de D2).
  - `alertas` es `null` fuera de Liquidador y Admin.
  - `cierre` es la versión máxima.
  - Parámetros inválidos → 400.
- **2 rondas** (alcance por rol).

**5-F, rama `feat/rediseno-5-inicio-front`**. Bloque I aplica: brief §3 "Inicio 'Mi trabajo' — Línea de la quincena"; sin tarjetas de módulos; versión simple en celular.
- Archivos: `app/(protected)/page.tsx` reescrito, `features/inicio/{linea-quincena.tsx, pendientes.ts, pendiente-link.tsx}` y `lib/api/inicio.ts`.
- **5F.1 (par)** `pendientes.ts`, función pura por rol: D1, D2 y lo siguiente.
  - Operario: rechazados → Mis registros.
  - JefeCuadrilla: cargas rechazadas y novedades que esperan a HyS.
  - JefeContrato: "N cargas por aprobar (M con alertas)", "K sin carga" y, con el permiso, "faltan km de N".
  - HyS: pendientes de **todas** las quincenas de Ausencias y Bajas, y "certificados nuevos".
  - Liquidador: alertas, "Faltan tarifas de <mes>: N de 6" (con 4a) y "Cerrar <quincena anterior>".
  - Con `href` armados por `lib/rutas.ts`.
- **5F.2 (par) Rojo contra el código actual**: HyS con una pendiente de julio. Hoy `page.tsx:82,108-111` cuenta solo 'Ausencia' de la quincena actual.
- **5F.3 (par)** La línea: 4 etapas con su avance; la quincena anterior primero si no está cerrada; skeleton y error; versión simple a 390 px; **ninguna** tarjeta de módulo.

Cierre: `impeccable critique` sobre `/` con cada uno de los 7 roles, a 1280 y 390 px. 1 ronda en el Frontend.

### Etapa 6a — Facturación: Resumen y Tablero de certificaciones (Frontend, M)

Rama `feat/rediseno-6a-facturacion-tableros`. Misma forma, estilo nuevo y arreglos.

- **Pares**:
  - B5: el Resumen abre en el último mes con datos (`certificaciones/page.tsx:88`).
  - C3: Top ítems sin barras de `div` (`features/certificaciones/analytics/top-items.tsx:36-43`). Pasa a Recharts o a una tabla sin barra.
  - B5: la matriz Operativo pinta en rojo solo lo vencido (`estado-operativo.tsx`).
  - C5: colores de categoría, no de estado (`analytics/colores.ts`).
- Textos D: "Analytics" pasa a "Tablero de certificaciones"; "mes 7" pasa al nombre del mes.
- Se mantiene la Incidencia de MO.

Cierre: `impeccable critique` sobre `/certificaciones` y `/certificaciones/analytics`, con los niveles admin, carga y lectura (y `inc`). 1 ronda.

### Etapa 6b — Facturación: Cargar, Historial e Ítems (Frontend, L)

Rama `feat/rediseno-6b-facturacion-carga`. Misma forma. **No se toca la lógica del parser ni la cuadratura.**

- **Cargar** (`certificaciones/carga/page.tsx`, 1725 líneas, y `fila-manual-form.tsx`):
  - Escala de letra: el 13 px × 17 pasa a 12/14, y el 10 px de `:1240` a 11 o más.
  - El modal de `:1590` pasa a `ConfirmDialog` con "Cargar certificación" y nombra K, mes, cantidad de filas y total.
  - Período propuesto: el mes vencido (P17).
- **Historial**: "Deshacer" (`historial/page.tsx:49`) pasa a `ConfirmDialog` que nombra la carga.
- **Ítems** (`items/page.tsx:141,298`): pasan a `Dialogo`/`ConfirmDialog`. Los chips de K dejan de usar el dorado como texto (C4). OPEX/CAPEX dejan los colores de estado (C5).
- Pares por ítem. Se adaptan `carga-page.test.tsx`, `historial-page.test.tsx`, `items-page.test.tsx` y `fila-manual-form.test.tsx`.

Cierre: `impeccable critique` sobre `/certificaciones/carga` (cada paso), `/certificaciones/historial` y `/certificaciones/items`. 1 ronda.

### Etapa 7a — Patrón de catálogo y Administración (Frontend, L)

Rama `feat/rediseno-7a-admin`. Bloque I aplica: brief §3 "Patrón de catálogo — tabla + fila desplegable".

**7a.1 (par)** Componente nuevo en `components/catalogo/{tabla-catalogo.tsx, fila-catalogo.tsx}`:
- Buscador. En Móviles normaliza como `lib/moviles.ts`.
- Total como dato vivo: "70 usuarios · 2 inactivos".
- `Paginador`.
- "Nuevo X" como acción del encabezado: despliega una fila de alta al tope.
- Fila desplegable accesible (`button` con `aria-expanded`/`aria-controls`).
- Pastilla de estado de solo lectura.
- "Desactivar…" adentro de la edición, con un `ConfirmDialog` que dice el efecto.
- El error muestra el motivo, y el campo no se vacía antes de que responda el servidor.

**7a.2 (par) A1, con rojo contra el código actual**: hoy un clic en "Activo" llama al toggle (`features/admin/pill-activo.tsx:13-24`). Se borra `pill-activo.tsx`.

**7a.3 (par) B3, con rojo contra el código actual**: hoy el texto dice "aleatoria" (`alta-masiva.tsx:46`). Queda "La contraseña inicial es el CUIL de la persona".

**7a.4** Se migran los 7 catálogos:
- **Usuarios**: orden y paginación; contraseñas con `type="password"` en `usuario-edit-row.tsx` y `usuario-form.tsx`; el reseteo pasa a `ConfirmDialog`: "Resetear la contraseña de X: queda su CUIL".
- **Accesos**: sin dorado como texto; "Quitar acceso" pide confirmación (A2).
- **Contratos.**
- **Tareas**: opción "Todas" y orden natural K2…K12.
- **Provincias**: sin estado, porque no hay columna, y una sola salida.
- **Tipos de novedad**: explicar las marcas de HyS y de plus; el grupo ya existe desde la 2-F.
- **Categorías UOCRA**: suma la edición del nombre con un hook `useEditarCategoriaUocra` sobre `POST /liquidacion/categorias-uocra/:id`, que ya existe (`liquidacion.controller.ts:61-65`). Desactivar pide confirmación.

Los efectos de desactivar se escriben solo con hechos del código. Si alguno no está claro, FRENADO.

Cierre: `impeccable critique` sobre los 7 de `/admin/*`. **2 rondas**: el formulario de usuario edita permisos (contratos, tipos, km, rol) y hay que comprobar que los payloads no cambian.

### Etapa 7b — Flota (Backend S y Frontend M)

**7b-B, rama `feat/rediseno-7b-flota-nombres`**: `cargas-combustible.service.ts` devuelve `cargadoPor` y `anuladaPor` como `{cuil, nombre}`, con el patrón de `conNombresCargador` de novedades. Par en `cargas-combustible.service.spec.ts`. 1 ronda.

**7b-F, rama `feat/rediseno-7b-flota`**:
- `combustible/page.tsx`:
  - C2 en celular: tarjetas por debajo de `sm`.
  - Importes con `$` y separador de miles, y litros (D).
  - Nombre en lugar de CUIL.
- `combustible/nueva/page.tsx`:
  - Letra de 10 px en `:56,68,85`.
  - `amber` → `warn`.
  - `min-w-0` en los selectores (alrededor de `:579`).
  - 44 px.
  - Revisar la foto que se sube dos veces (E).
- `features/combustible/detalle-carga.tsx`: los tres modales pasan a `Dialogo`/`ConfirmDialog`, por ejemplo "Anular la carga de <móvil> del <fecha> ($ X)".
- Los tres catálogos de Flota (`admin/moviles`, `admin/estaciones-servicio`, `admin/tipos-combustible`, y `crear-movil-dialog.tsx`) pasan a `TablaCatalogo`. El alias del ticket lleva su rótulo.

Cierre: `impeccable critique` sobre `/combustible` (1280 y 390 px), `/combustible/nueva` (390 px) y los tres catálogos. 1 ronda.

### Etapa 8 — Cierre (M)

**8.1 Barridos.** Cada búsqueda tiene que dar 0 en el Frontend:

| Búsqueda | Qué detecta |
|---|---|
| `text-\[(9\|10\|10\.5)px\]` | letra menor a 11 px |
| `fixed inset-0` fuera de `components/ui` | modales hechos a mano |
| `PillActivo`, `area=`, `navPorArea`, `SubNav` | restos de la base vieja |
| `text-neutral`, `bg-black/`, `amber-` | colores fuera de la paleta |
| emojis `🔴🟡🟢` y glifos `▾▴▲▼⚠✕×` en JSX visible | íconos sin lucide |

Además:
- Revisar la lista C1 completa de la revisión, punto por punto.
- Después de pasar todas las tablas a 1024 px, quitar `overflow-x-auto` de `components/ui/table.tsx:11`.

**8.2** `impeccable critique` global, por módulo, y el detector sobre todo `src/`.

**8.3** `revision-codigo` sobre `git diff main...dev` en los dos repos: **2 rondas**.

**8.4** Sincronización final con `main`; suite completa y build en los dos repos.

**8.5** Preparar, sin ejecutar:
- Los PRs finales `dev` → `main`, con qué, por qué, verificación, qué pasa después y rollback.
- El script del DDL para producción, con su precondición: conteos de `Horas_Sertec` y nombres exactos de los tipos.
- El borrador del documento de deploy, `Backend/docs/2026-1X-XX-rediseno-erp-deploy.md`.

**8.6** Recorrida del usuario en local con los 7 roles: los dos repos en `dev` y el backend contra `testing`.

**8.7** Con OK:
- Merge de los dos PRs finales con `--admin`.
- Backup y DDL en **`Horas_Sertec` antes de deployar el backend**, verificación.
- Deploy **solo con "deployá"**: backend y frontend juntos.
- Bitácora: sección nueva arriba de todo (§104 si sigue siendo la siguiente) y limpieza de `estado.md`.

### Resumen: tamaño, dependencias y paralelo

| Etapa | Repo | Tamaño | Depende de | Puede ir en paralelo con |
|---|---|---|---|---|
| 0 | BE+FE | S | — | — |
| 1a | FE | M | 0 | 2-B, 4a, 5-B |
| 1b | FE | L | 1a | 2-B, 4a, 5-B |
| 2-B | BE + DDL testing | M | 0 | 1a, 1b |
| 2-F | FE | L | 1b, 2-B y su DDL | 4a, 5-B |
| 3a | FE | L | 1b | 6a, 6b, 7a (otro worktree) |
| 3b | FE | M | 1b | 3c |
| 3c | FE | M | 1b | 3b |
| 4a | BE | S-M | 0 | cualquier etapa del FE |
| 4b | FE | M | 1b | 4d |
| 4c | FE | L | 1b, 4a | — |
| 4d | FE | M | 1b | 4b |
| 5-B | BE | M | 0 (4a para el pendiente de Tarifas) | cualquier etapa del FE |
| 5-F | FE | M | 5-B, 2-F, 3a, 3c, 4b, 4c | — |
| 6a / 6b | FE | M / L | 1b | 7a, 7b |
| 7a | FE | L | 1b, 2-F | 6a, 6b |
| 7b | BE+FE | M | 7a | 6a, 6b |
| 8 | ambos | M | todas | — |

Orden recomendado con un solo orquestador: 0 → 1a → 2-B → 1b → 2-F → 3a → 3b → 3c → 4a → 4b → 4c → 4d → 5-B → 5-F → 6a → 6b → 7a → 7b → 8.

Los tramos del backend (2-B, 4a, 5-B, 7b-B) pueden adelantarse mientras una etapa del Frontend espera revisión.

---

## 4. Riesgos

- **R1. Mantener `dev` al día con `main`** (alto si alguien trabaja en `main`). Casi todas las páginas cambian, así que cualquier arreglo en `main` choca.
  - Mitigación: bloque S al inicio de cada etapa; etapas cortas; congelar features del Frontend en `main` mientras dure, o hacerlas directo en `dev` (P14).
  - Un DDL que entre por `main` se ordena junto con el de Grupo en `docs/sql`.
- **R2. Tests que se rompen por el menú y el encabezado.** Son alrededor de 30 de "área en el encabezado", más `nav.test.ts`, `app-shell.test.tsx`, `page.test.tsx` y `sub-nav.test.tsx`.
  - Mitigación: se actualizan a propósito en la 1b, con el conteo antes y después.
  - Las reglas de visibilidad por rol se **portan una por una** (no se borran).
  - Los flaky se corren aislados.
- **R3. PRs grandes** (1b, 2-F, 3a, 4c, 6b, 7a).
  - Mitigación: etapas partidas; commits mecánicos aparte de los de lógica (el barrido de la 1b va en su propio commit); revisión por módulo; si algún PR pasa de unos 40 archivos de código, el orquestador lo parte.
- **R4. `prisma generate` con `node_modules` enlazado** pisa el cliente del checkout principal (2.1.14).
  - Mitigación: `npm ci` propio en el BE desde la 2-B. Si se usó el enlace, volver a correr `npx prisma generate` en el checkout principal al terminar.
  - Nunca levantar el backend local contra `Horas_Sertec`.
- **R5. DDL (esquema).** Es irreversible solo en apariencia: el `DROP COLUMN` es el rollback, pero rompe al código que lee la columna.
  - Mitigación: backup previo, ensayo completo en `testing` (aplicar, rollback, volver a aplicar), precondición con nombres exactos, y en producción **el DDL antes del deploy del backend**.
  - El código viejo convive con la columna.
  - **Hace falta un backup y un rollback escrito en las dos bases.**
- **R6. Permisos**: una regla de visibilidad mal portada muestra u oculta pantallas.
  - Mitigación: la matriz rol × pantalla queda en `nav.test.ts`; 2 rondas en 1b y 2-F; los guards de layout no se tocan, salvo el nuevo de `/personal`; los permisos reales siguen en el backend.
- **R7. Zonas sensibles.** Tarifas por pasos reescribe la UI que graba precios.
  - Mitigación: los mismos endpoints y payloads, con tests de payload conservados; 2 rondas; el endpoint de estado es solo lectura.
  - `git diff --stat` en cada etapa: **0** cambios en `calculo.service.ts`, `cierres.service.ts` y `export-cierre.service.ts`.
- **R8. Los P0 siguen en producción hasta el final**: A1 (la pastilla desactiva con un clic), B2 (HyS no ve pendientes viejas), B1 y B3. Ver P8.
- **R9. Deshacer diferido**: si cierran la pestaña dentro de los 6 s, la aprobación no se manda. Es un fallo seguro (sigue pendiente), pero hay que contarlo. La alternativa es reabrir en lote (endpoint nuevo).
- **R10. Borrador del Reporte**: un teléfono compartido o un borrador viejo con fecha vieja.
  - Mitigación: clave por CUIL, vencimiento a los 3 días, y nunca se restaura sin el aviso "Seguir / Descartar" con la fecha a la vista. Se respeta la decisión del 2026-08-12 de no proponer la fecha de hoy.
- **R11. Peso de los frecuentes** en teléfonos de gama baja. Mitigación: se piden después de pintar el formulario, se cachean, y se mide en "Slow 3G". Si pasa de 150 KB, se propone un endpoint liviano.
- **R12. Costo de las consultas**:
  - El tablero de Quincenas pide alertas por quincena: se limita a las abiertas de los últimos 3 meses.
  - El Inicio de Liquidador y Admin corre `getAlertasQuincena`: `staleTime` de 60 s.
  - Personal trae las pendientes de todas las quincenas, pero filtradas en el servidor por grupo y estado.
- **R13. Estructuras sin página de decisión** (2.1.8): riesgo de interpretar de más. Mitigación: FRENADO ante cualquier hueco, y critique más antes/después en cada etapa.
- **R14. Enlaces viejos** (`/novedades`, `/ausencias`) y nombres nuevos (Control general pasa a ser Tablero de productividad, Análisis a Tablero de costos). Mitigación: redirecciones y una nota para los usuarios en el PR final.
- **R15. El hook de diseño en el worktree**: confirmar en la 1a que el detector corre sobre `Frontend/.claude/worktrees/...`. Si no corre, el cierre de cada etapa ejecuta el detector a mano.
- **R16. El sidecar `Frontend/.impeccable/design.json`** puede quedar desactualizado después de la 1b. No se repara como efecto colateral: lo decide el orquestador con el usuario.

---

## 5. Preguntas abiertas

Cada pregunta trae lo que se asume si nadie contesta.

### Para el usuario: cambian el resultado

- **P1 (antes de la 5).** ¿Qué ve Admin y qué ve Supervisor en el Inicio? *Default: D1.*
- **P2 (antes de la 5).** ¿La línea muestra solo la quincena en curso, o también la anterior mientras no esté cerrada? *Default: las dos, la anterior primero.*
- **P3 (antes de la 5-B).** Los números de la línea:
  - Operario: solo lo suyo.
  - JefeCuadrilla: lo que cargó.
  - JefeContrato: sus contratos.
  - HyS y Supervisor: conteos globales, sin nombres.
  - Alertas: solo Liquidador y Admin.
  - El estado de cierre lo ven todos.

  ¿Va así? *Default: sí. "Liquidado" = sin pendientes ni alertas (lista para cerrar).*
- **P4 (antes de la 4a).** Tarifas:
  - Se listan los meses desde 5 atrás hasta el siguiente, con el primero incompleto destacado.
  - El Plus individual cuenta siempre como hecho (no tiene "resuelto").
  - El Bono está completo con 1ª y 2ª quincena.

  *Default: así.*
- **P5 (antes de la 3b).** Frecuentes: últimos 28 días, 8 operarios y 4 móviles, con un mínimo de 2 cargas. *Default: así.*
- **P6 (antes de la 2-B).** Un tipo nuevo sin grupo cae en **Operativa** (default de la base), y el alta en Administración obliga a elegir. *Default: así.*
- **P7 (antes de la 2-F).** Contadores de Suspensiones por fecha: En curso, Próximas y Cumplidas. *Default: así.*
- **P8 (ahora).** ¿Hotfix directo a `main` de A1 (la pastilla que da de baja) y B2 (HyS sin pendientes viejas) antes del final? La "Tanda 1" quedó en espera, pero son daños reales en datos. *Default: no; quedan en las etapas 7a y 2-F.*
- **P9 (antes de la 1b).** Facturación: ¿Resumen primero, como el brief, o Cargar primero, como pidió el usuario el 2026-09-03? *Default: el orden del brief.*
- **P10 (antes de la 3a).** ¿El historial de cargas aprobadas y rechazadas queda en Aprobaciones como vista secundaria "Resueltas"? *Default: sí.*
- **P11 (antes de la 4b).** "N registros sin aprobar →": el Liquidador no puede abrir Aprobaciones (403). *Default: lo lleva al detalle de la quincena. Abrirle Aprobaciones sería un cambio de permisos: fuera de alcance.*
- **P12 (antes de la 4b).** Quincenas abiertas de hace más de 3 meses (probablemente anteriores a que existieran los cierres): colapsadas, sin detalle. *Default: así.*
- **P14 (ahora).** ¿Se congelan las features de Frontend en `main` mientras dure el rediseño? *Default: sí; lo urgente se hace en `main` y se trae con el bloque S.*

### Menores: se sigue con el default

- **P13.** Los catálogos de Flota conservan sus URLs `/admin/...` (sin mudanza ni redirecciones).
- **P15.** El DDL de Grupo sigue la convención manual de `docs/sql`, no Prisma Migrate. "A futuro" dice "empezando por el próximo cambio de esquema", pero arrancar Migrate en dos bases compartidas es un trabajo aparte.
- **P16.** HyS no edita ni anula Accidentes (el backend no lo deja; cambiarlo es un permiso).
- **P17.** Cargar certificación propone el mes vencido.
- **P18.** No se agrega un ítem "Mi trabajo" al menú; al Inicio se vuelve por el logo.
- **P19.** La recorrida visual de los tableros con Liquidador y Admin (pendiente del usuario), si se hace antes de 4d y 6a, entra como insumo de esas etapas.
- El "Nueva X" de Personal abre el formulario en el panel, y en celular a pantalla completa.

---

## 6. Fuera de alcance

- **Permisos y roles**:
  - Liquidador en Aprobaciones; HyS editando Accidentes.
  - Combustible para JefeCuadrilla (sigue "TEMPORAL" solo Admin, `nav.ts:41-42`).
  - Guards nuevos, salvo el de `/personal`, que replica el de `/novedades`.
- **Lógica de negocio**: `calculo.service.ts`, `cierres.service.ts`, `export-cierre.service.ts`; la lógica de precios (solo se agrega el estado, de solo lectura); las reglas por nombre de tipo (`TIPO_BAJA`, 'Ausencia', 'Suspensión').
- **Identidad visual**: logo, dorados, tipografías; modo oscuro.
- **Datos y esquema**:
  - Prisma Migrate.
  - `DROP COLUMN modalidad_pago`.
  - Estado de Provincias (requiere DDL).
  - Paginación del lado del servidor.
  - Que el CSV de `resumen-ausencias` incluya Accidente.
- **Seguridad y operación**: backups automáticos; credenciales (CUIL como contraseña), login, sesión, CORS y permisos del `.env`; el portal de certificaciones apagado.
- **Backend sin cambios**: separar los paneles de `registros-horas.service.ts`.
- **Deuda de Baja de Operario**: los 9 minor de #105/#88. Solo se resuelve de rebote el de bajas mezcladas con Justificadas/Injustificadas, porque Bajas pasa a tener su pantalla.
- **Login**: rediseño visual (solo foco y botones).
- **Codex** como tercer revisor.
- **Deploy y producción**: cualquier deploy o DDL en `Horas_Sertec` antes de la Etapa 8 y sin "deployá" explícito.

---

### Rutas absolutas clave

- Brief: `C:\Users\Administrador\Desktop\SE Gero\Aplicaciones Web\Formulario_Horas\Backend\docs\superpowers\plans\2026-10-07-rediseno-erp-brief.md`
- Plan (el orquestador lo guarda en): `C:\Users\Administrador\Desktop\SE Gero\Aplicaciones Web\Formulario_Horas\Backend\docs\superpowers\plans\2026-10-07-rediseno-erp.md`
- Craft floor: `C:\Users\Administrador\Desktop\SE Gero\Aplicaciones Web\Formulario_Horas\Frontend\.claude\skills\impeccable\reference\craft-floor.md`
- Critique: `C:\Users\Administrador\Desktop\SE Gero\Aplicaciones Web\Formulario_Horas\Frontend\.claude\skills\impeccable\reference\critique.md`
- Revisión del 2026-10-05: `C:\Users\Administrador\Desktop\SE Gero\Aplicaciones Web\Formulario_Horas\Frontend\.impeccable\critique\2026-10-05-revision-completa.md`
- `DESIGN.md` y `PRODUCT.md` (hasta la Etapa 0): `C:\Users\Administrador\Desktop\SE Gero\Aplicaciones Web\Formulario_Horas\Frontend\DESIGN.md` y `...\Frontend\PRODUCT.md`
- Modelo de DDL: `C:\Users\Administrador\Desktop\SE Gero\Aplicaciones Web\Formulario_Horas\Backend\docs\sql\2026-10-05-baja-de-operario.sql`
- Menú actual: `C:\Users\Administrador\Desktop\SE Gero\Aplicaciones Web\Formulario_Horas\Frontend\src\components\layout\nav.ts` y su test
- Esquema: `C:\Users\Administrador\Desktop\SE Gero\Aplicaciones Web\Formulario_Horas\Backend\prisma\schema.prisma` (`TipoNovedad` en `:217-229`)