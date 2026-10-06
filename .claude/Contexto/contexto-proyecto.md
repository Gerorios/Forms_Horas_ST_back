# Bitácora — Central SER&TEC

> **Todo lo hecho, la más reciente arriba.** Una sección `## NNN. Tema (fecha)` por entrega, con número
> correlativo (los docs las citan como "§NNN"). Lo vivo —en curso, próximo paso, pendientes— NO va acá: está en
> `estado.md`, en esta misma carpeta, que se carga solo en cada sesión. Un hook de arranque le pasa a cada
> sesión las 3 entradas más recientes de este archivo. Las secciones **§1 a §90** (2026-07-01 → 2026-09-21)
> están en `contexto-proyecto-historico.md`.
>
> Hasta la §101, cada sección cerraba con sus **PENDIENTES**; desde la §102, los pendientes viven solo en
> `estado.md`.

## 103. Baja de Operario: bloquea horas, $0 si es previa, ausencias en el Excel (2026-10-06)

PRs: Backend #105 (merge `5b701cc`) y Frontend #88 (merge `9c3d65b`). Los escribió Rodrigo Carrazana (ADR-026,
`docs/adr/2026-10-05-adr-026-baja-de-operario.md`). Esta sesión los revisó, los arregló, los mergeó y los deployó, a
pedido del usuario.

**Qué hace:** la novedad "Baja de Operario" (fecha = último día trabajado) la confirma HyS. Confirmada:
- rechaza horas posteriores en todos los contratos;
- marca las ya cargadas;
- liquida $0 si la baja es anterior a la quincena, o liquidación final si cae dentro;
- informa días de ausencia por estado HyS.

El cierre congela fecha, estado, ausencias y si seguía activo en sueldos. El Excel suma 4 columnas al final y la
hoja BAJAS A REGULARIZAR. En el front: formulario con confirmación, botones de HyS, colores en la preliquidación y
chips en aprobaciones. Además, la columna Plus suma el plus individual.

**Revisión** (Standards y Spec en paralelo, después el verificador): 1 urgent y 1 high, arreglados en `74809db`
con su test, que se vio fallar antes del arreglo:
- R1: el cierre congelaba la fecha de una baja **sin confirmar**, y el Excel la mostraba en FECHA BAJA.
- R2: `reabrir()` no validaba que hubiera una sola baja vigente.

Segunda ronda sobre los arreglos: limpia. Quedaron 9 minor sin tocar, listados en los comentarios de los dos PRs.
Plan: `docs/superpowers/plans/2026-10-05-revision-baja-de-operario.md`.

**Verificación:** Backend 791 tests OK, `tsc` y build. Frontend 856 de 856 y `tsc`. La primera corrida dio 5
fallas flaky por carga, porque corría a la vez que la suite del back; en la segunda pasó entera.

**Deploy (2026-10-06):** DDL en `Horas_Sertec` con precondiciones y backup
(`/var/www/backups/baja-pre-ddl-2026-10-06.json`). Quedaron las 6 columnas, el tipo pasó a requerir HyS y las 2
bajas cargadas (ids 160 y 187) pasaron a pendientes. Después, back y front. Leer un cierre viejo con el cliente
nuevo funciona. Detalle: `docs/2026-10-06-baja-de-operario-deploy.md`.

## 102. Estado vivo + bitácora con lo hecho (2026-10-04)

Se aplicó el esquema que el usuario usa en Inspecciones K11, con tres adaptaciones para este proyecto:

- **`estado.md` nuevo** en esta carpeta, solo con lo vivo (en curso, próximo paso, pendientes del usuario, a
  futuro). Lo importa el `CLAUDE.md` de la raíz con `@Backend/.claude/Contexto/estado.md`, así que entra solo en
  cada sesión. Juntó lo que estaba repartido en la §0, los PENDIENTES de cada sección y tres memorias.
- **Esta bitácora conserva su ruta y sus números** (los citan ~20 docs), pero ahora va con la más nueva arriba. La
  §0 se quitó: lo fijo del sistema (qué es, stack, roles) pasó al `CLAUDE.md` de la raíz y lo vivo a `estado.md`.
  El contenido de las §91-§101 no cambió, solo el orden.
- **Hook `SessionStart`** en `Formulario_Horas/.claude/hooks/ultimas-entregas.mjs` (fuera de git, registrado en
  el `settings.local.json` de la raíz): imprime las 3 entradas más recientes al abrir, retomar, limpiar o
  compactar la sesión.

Regla, escrita en el `CLAUDE.md` de la raíz y en `flujo-sertec`: **al avanzar** se actualiza `estado.md`; **al
entregar**, el cierre va arriba de todo acá y ese trabajo se borra de `estado.md`, en el mismo cambio.
Plan: `docs/superpowers/plans/2026-10-04-estado-y-bitacora.md`.

---

## 101. Auditoría de seguridad de la VPS: SSH sin contraseñas + fail2ban (2026-10-01)

Pedido del usuario después de un ataque de fuerza bruta en otro proyecto suyo. La
auditoría encontró lo mismo acá: del 30/08 al 01/10, 2944 contraseñas fallidas
(916 contra root) y 2023 usuarios inexistentes, desde 39 IPs, sin ningún ingreso
logrado. El SSH aceptaba contraseña y root podía entrar directo, porque
`50-cloud-init.conf` de Hostinger pisaba el `PasswordAuthentication no`. No había
fail2ban.

**Aplicado con OK explícito:** `01-endurecimiento.conf` (sin contraseñas, root solo
con clave, 3 intentos por conexión) y fail2ban con jail `sshd` (5 fallos en 10
min → 1 h, reincidentes cada vez más). Verificado con conexiones nuevas: la clave
entra, la contraseña es rechazada como coworker y como root. La contraseña de root
NO se bloqueó: la pide la consola web de Hostinger, que es el acceso de
emergencia. Antes de aplicar se comprobó que los 206 ingresos de los logs eran con
la clave de `coworker`. Detalle, verificación y rollback:
`docs/2026-10-01-endurecimiento-ssh.md`.

**Hallazgos de la misma auditoría, sin tocar:** el login de la app se alcanza
saltando Cloudflare, nginx no ve las IPs reales y no hay límite de intentos; MySQL
3306 abierto a internet en el servidor de IT; clave desconocida en `root`
(`claude-code@forms-horas-vps`); reinicio pendiente; `.env` en 644. Lo bueno: ufw
activo solo con 22/80/443, puertos 3000/3001 cerrados desde afuera, actualizaciones
automáticas encendidas.

**Reinicio de la VPS, el mismo día (11:33, a pedido: "hacelo ya"):** activó el
kernel 6.8.0-142. Corte de menos de un minuto; todo volvió solo (PM2, nginx,
fail2ban, ufw, SSH por socket) y el backend llegó a la base. Detalle en el doc.

**PENDIENTES:** los de la §0 de entonces, punto 7 (hoy en `estado.md`). Que el usuario guarde una copia de la clave
`forms_horas_vps2` y confirme si Rodrigo entra con la misma.

---

## 100. Bitácora partida en vivo + histórico, y harness reorganizado (2026-09-28)

La bitácora llegó a 260 KB y 4000 líneas. Se partió sin tocar el contenido:
§1-§90 pasaron a `contexto-proyecto-historico.md` (congelado) y este archivo
quedó con §0 "Estado actual" nuevo, §91-§99 y esta sección. Misma ruta, para que
las ~20 referencias "§NN" de los docs sigan resolviendo. Plan:
`docs/superpowers/plans/2026-09-28-partir-bitacora.md`.

En la misma sesión se reorganizó el harness de Claude Code (fuera de git):
`CLAUDE.md` en la raíz con las reglas comunes, memoria única para raíz, Backend y
Frontend, skills del proceso movidas al usuario (`code-review` pasó a llamarse
`revision-codigo`), superpowers desactivado en este proyecto y tabla del proceso
solo en `flujo`. Permisos: de 225 a 41, la misma lista en raíz, Backend y
Frontend (rigen según la carpeta de arranque), con deny para `push --force`,
`reset --hard`, `Clear-RecycleBin`, `prisma migrate reset` y `db push`, y ask
para `worktree remove`, `rm -rf`, SSH/SCP, migraciones de Prisma y `gh api`. Se
quitaron la lectura de todo el disco C y dos entradas con la contraseña de
`testing`. En la configuración de usuario se sacó el bloque `modelPicker`
sobrante y se corrigió la descripción del entorno para el clasificador (remotos
de GitHub, los dos repos, producción = VPS + `Horas_Sertec`). El clasificador de
auto mode había frenado los permisos por "automodificación"; se aplicaron fuera
de auto mode con pedido explícito del usuario.

**PENDIENTES:** los de la §0 de entonces (hoy en `estado.md`).

---

## 99. Higiene de los dos repos tras el relevamiento (2026-09-28)

Relevamiento completo del proyecto y limpieza, carril corto, solo docs y git.
Plan: `docs/superpowers/plans/2026-09-28-higiene-repos.md`.

- **Ramas locales**: borradas todas las ya mergeadas en `main` (26 en Backend, 7 en
  Frontend). Las remotas no se tocaron. Los dos checkouts quedan en `main`.
- **`.gitignore` del Backend**: se agrega `skills-lock.json` (lock de `.claude/skills/`,
  carpeta ya ignorada).
- `docs/sql/2026-08-21-detalle-diario-consulta.sql` **no se commitea** por decisión del
  usuario (no quiere esa consulta en GitHub). Queda en `.git/info/exclude`, que es local.
- **§2 y §8** actualizados: stack y hosting reales (VPS, PM2, Nginx, `Horas_Sertec` +
  `testing`) y pendientes de julio marcados como resueltos, con la sección que los cerró.
- **README del Frontend**: deja de ser la plantilla de create-next-app.

**Hallazgo sin resolver:** `docs/infraestructura-produccion.md` (gitignored, §33) **no está
en disco** en esta máquina. Ahí estaban IP, accesos, rutas de Nginx y env vars de
producción. Buscar en otra máquina o backup; hasta entonces, §33, §39 y los docs de deploy
son la única referencia de infra.

**PENDIENTES:** los de §98 salvo el del checkout del Frontend, ya resuelto.

---

## 98. /login redirige a quien ya tiene sesión (2026-09-25)

Pendiente de §97. **Frontend #86** (merge `3636ac4`, carril corto):
`src/app/login/page.tsx` toma `perfil`/`loading` de `useSession()`; con sesión
vigente hace `router.replace('/')` y no muestra el formulario; mientras la
sesión carga tampoco lo muestra (sin parpadeo); sin sesión, igual que antes.
**Desvío del plan:** se quitó el `router.push('/')` de `onSubmit` — con el
effect nuevo el login exitoso navegaba dos veces; ahora sale solo por el
`replace` (y `/login` no queda en el historial). No hay loop con
`(protected)/layout.tsx`: condiciones excluyentes y `signOut()` borra el perfil
antes de ir a `/login`. Detalle de test: el mock de `useRouter` tiene que ser
una instancia estable (como el real) o el effect se re-dispara.
2 tests nuevos vistos fallar; spec 9/9; suite 845/845 (1 timeout de tipeo por
carga, aislado pasa); tsc/eslint limpios; `next build --webpack` OK.
Revisión: 0 urgent, 0 high, 4 minor sin tocar, 2 descartados.
Plan: `docs/superpowers/plans/2026-09-25-login-con-sesion.md`.

**DEPLOYADO** (front PID 683862, rollback `55b3ded`). Deploy:
`docs/2026-09-25-login-con-sesion-deploy.md`.

**PENDIENTES:**
- Minors de #86: guard espejo de `(protected)/layout.tsx` (extraer si aparece un
  tercer uso); `return null` antes de `onSubmit` (estilo); el test del login
  exitoso simula el perfil con `rerender`; `/login` en blanco sin "Cargando…".
- Deuda previa en `session.tsx`: si el login sale bien pero falla
  `fetchPerfil`, el token nuevo queda guardado y se ve "Credenciales
  inválidas" (se limpia al recargar).
- Siguen los minors de #84 y #85 (§96/§97).
- ~~Checkout local del Frontend quedó en la rama vieja `feat/horas-extra-pactadas`
  (ya mergeada): pasarlo a `main` antes de la próxima tarea.~~ Resuelto (§99).

---

## 97. Token de sesión a prueba de localStorage bloqueado (2026-09-23)

Pendiente de §96. **Frontend #85** (merge `55b3ded`, carril corto):
`src/lib/api/token.ts` protege `getItem`/`setItem`/`removeItem` con `try/catch`.
Si `setItem` falla, el token queda **en memoria** (la sesión dura lo que la
pestaña) y se **borra el token anterior persistido**; con storage sano manda
`localStorage` como antes. Así el login ya no tira y `session.tsx` no deja la
promesa rechazada. 4 tests nuevos vistos fallar. Suite 841/841.
Revisión: **1 urgent arreglado** (con cuota llena quedaba el token viejo
persistido → tras recargar B operaba como A), 3 minor sin tocar, 2 descartados.
**DEPLOYADO** (front PID 663036, rollback `4d82676`). Deploy:
`docs/2026-09-23-token-storage-deploy.md`.

**PENDIENTES:**
- Deuda previa: `src/app/login/page.tsx` no redirige a quien ya tiene sesión
  (permite loguearse encima de un token vigente sin logout).
- Minors de #85: test de regresión de `respaldo = null` tras `setItem` exitoso;
  renombrar `respaldo` → `tokenEnMemoria`.
- Siguen los minors de #84 (§96).

---

## 96. Pendientes de §95: build local y barra lateral con localStorage bloqueado (2026-09-23)

**Build local que fallaba en `next/font`: transitorio.** El error
(`loader.js:122`, URL de fuente sin extensión) no se reproduce: las 3 fuentes
del layout bajan con URLs `.woff2` válidas y `origin/main` compila 2 veces
seguidas (2.5 min / 98 s). Causa probable: Avast interceptando HTTPS
(la variable `SSLKEYLOGFILE` apunta al proxy de Avast, `aswMonFltProxy`). Si reaparece: reintentar; si es
frecuente, excluir Node del escaneo HTTPS de Avast.

**Frontend #84** (merge `4d82676`, carril corto): `app-shell.tsx` leía/escribía
`localStorage` ('sidebar-plegado') sin protección → con almacenamiento bloqueado
o lleno la barra se caía. `leerPlegado()`/`guardarPlegado()` con `try/catch`; el
effect de montaje queda (hidratación) con `eslint-disable-next-line
react-hooks/set-state-in-effect` justificado → **eslint de la barra sin errores**.
2 tests nuevos vistos fallar (setItem: vía "Unhandled Errors" de vitest). Suite
835/838 (3 timeouts ajenos que solos pasan). Revisión 0/0/2 minor/2 descartados.
**DEPLOYADO** (front PID 661764, rollback `ecaa8e8`). Deploy:
`docs/2026-09-23-sidebar-plegado-storage-deploy.md`.

**Incidente:** al quitar el worktree de diagnóstico mandé en paralelo "quitar
el junction" y "git worktree remove"; la herramienta bloqueó el primero y el
segundo vació el `node_modules` del Frontend. Recuperado con `npm ci` (tsc y
tests OK). Regla: el junction se quita en una llamada separada y secuencial, y
el remove solo después de leer la confirmación.

**PENDIENTES:**
- `src/lib/api/token.ts` (`getToken`/`setToken`/`clearToken`) no protege
  localStorage: con almacenamiento bloqueado el login tira y `session.tsx` deja
  una promesa rechazada sin manejar.
- Minors de #84: el test de `setItem` detecta el bug vía el error no manejado,
  no por su aserción; dos comentarios se superponen.

---

## 95. Marca "Central SER&TEC" y copy "Sistema Interno" (2026-09-23)

**Carril corto.** Plan: `docs/superpowers/plans/2026-09-23-nombre-ser-tec.md`.
Deploy: `docs/2026-09-23-nombre-ser-tec-deploy.md`.

- Pedido: en el login, "Sertec" → "SER&TEC" y el copy a solo "Sistema Interno".
  Alcance elegido por el usuario: toda la app (login, barra lateral, pestaña).
  Después pidió también la mayúscula "Sistema Interno" en la barra.
- **Frontend #82** (merge `c67ec80`): `login/page.tsx`, `app-shell.tsx`,
  `app/layout.tsx` + tests de login y app-shell (vistos fallar antes).
- Suite 830/835: 5 timeouts en 4 archivos ajenos que solos pasan 59/59.
  `next build` LOCAL falla en `next/font` ("Cannot read properties of null
  (reading '1')") también en `origin/main` sin cambios → entorno local, no el
  código; el build del VPS pasa. eslint: 1 error preexistente en `app-shell.tsx:160`.
- Revisión: 0 urgent / 0 high / 3 minor / 1 descartado.
- **DEPLOYADO 2026-09-23** (solo Frontend): front `c67ec80`, PID 660582.
  Rollback front `d73eac0`. Verificado en el dominio público.

**Minors (a pedido del usuario), Frontend #83** (merge `ecaa8e8`, carril corto
por excepción: 4 archivos, uno la constante nueva): `src/lib/marca.ts` con
`MARCA = 'SER&TEC'` y `NOMBRE_APP` = "Central " + `MARCA`; login, barra y
`layout.tsx` la usan (antes 5 literales en 3 archivos). Test nuevo
`src/app/layout.test.tsx` (mock de `next/font/google`), visto fallar. Vitest
94/94, 836 tests. Revisión 0/0/2 minor/2 descartados. **DEPLOYADO** (sin cambio
visible, verificado en el dominio público): front PID 660933, rollback `c67ec80`.
Deploy: `docs/2026-09-23-constante-nombre-app-deploy.md`.

**PENDIENTES:**
- ~~`next build` local en `next/font`~~ → transitorio (ver §96).
- ~~eslint en `app-shell.tsx`~~ → resuelto en §96.
- Minors sin tocar de #83: `layout.test.tsx` podría ser `.test.ts`; la descripción
  se prueba con `toContain`.

---

## 94. Tarjeta corregida con el estado real de la corrección — caso Urueña (2026-09-23)

**Carril corto.** Plan: `docs/superpowers/plans/2026-09-23-badge-correccion.md`.
Deploy: `docs/2026-09-23-badge-correccion-deploy.md`.

**Diagnóstico.** El usuario vio a Cristian Urueña en Mis registros con el 18/09
"corregido 10.5 hs, aprobado" y total 0. Consulta de solo lectura en
`Horas_Sertec`: 2988 = 13.5 hs `desaprobado` (original); 3039 = 10.5 hs,
`lote_id_origen` = lote de la 2988, **también `desaprobado`** ("fecha mal
informada"); 4746 = 9.5 hs `pendiente` (carga nueva). El total 0 era correcto
(la tarjeta del operario suma solo `aprobado`); el bug era de la tarjeta:
`TarjetaCorregida` pintaba `<StatusBadge estado="aprobado" />` fijo. Mi primera
respuesta ("no es bug", §93) miró solo los totales y no la tarjeta.

**Frontend #81** (merge `d73eac0`), `registros-cards.tsx`:
- badge con `corregida.estado`;
- borde y línea "Corregido de X a Y" verdes solo si la corrección está aprobada;
- "Corrección rechazada: <motivo>" en `text-danger` si la corrección se rechazó
  (paso 4, agregado con OK del usuario tras la revisión).
- 3 casos nuevos en `registros-cards.test.tsx` (caso Urueña visto fallar en las
  dos etapas). Vitest 93/93 archivos, 835 tests; tsc y eslint limpios.
- Revisión: 2 ejes → verificador 0 urgent / 0 high / 3 minor (en el PR) / 3 descartados.
- Una primera corrida de la suite dio 3 timeouts y solo 87 archivos con la
  máquina cargada; solos pasaban y la segunda corrida completa dio 93/93.

**DEPLOYADO 2026-09-23** (solo Frontend, a pedido): front `d73eac0`, PID
659826; back intacto. Rollback front `2991269`.

**Observación para el usuario:** el 16/09 Urueña tiene 2 cargas pendientes del
mismo contrato (11 y 11.45 hs, 22.45 en total) — posible duplicado a revisar al
aprobar.

**PENDIENTES:**
- ~~Borrar a mano las carpetas sueltas de worktrees de §93~~ → borradas el 2026-09-23.

---

## 93. totalHorasDia redondeado (Backend) + rótulos de horas (Frontend) (2026-09-22)

**Carril corto.** Plan: `docs/superpowers/plans/2026-09-22-total-horas-dia-y-rotulos.md`.

- **Backend #91** (merge `0d97ca6`): `porAprobar` redondea `totalHorasDia` a 2
  decimales (`registros-horas.service.ts:761`), como los otros 5 totales. Test
  nuevo visto fallar (0.6000000000000001). Jest 760 passed, build OK.
- **Frontend #80** (merge `2991269`): inicio "Horas cargadas" + "Incluye
  pendientes de aprobación"; Mis registros del operario "Horas aprobadas · Nª
  quincena"; Cargas agrupadas "Total" + "Incluye pendientes de aprobación". 3
  tests nuevos, vitest 833/833, tsc OK.
- Revisión: 2 ejes (0/0/2 minor) → `verificador-review` descartó los 2 minor.
- Incidente: el reinicio de Claude Code (para habilitar Opus 5.5 en los agentes)
  borró el worktree Backend con el cambio sin commitear; se rehízo en
  `.claude/worktrees/total-horas-dia`. Lección: commitear WIP antes de reiniciar.

**DEPLOYADO 2026-09-22** a pedido del usuario: back `93729d5`, front `2991269`,
pm2 ambos online. Detalle y rollback en `docs/2026-09-22-total-horas-dia-rotulos-deploy.md`.

**(C) Cristian Urueña — diagnóstico corregido en §94** (la primera lectura
"NO es bug" era incompleta). Consulta de solo lectura en
`Horas_Sertec`: en la 2ª quincena de septiembre (16-30) tiene 0 hs aprobadas y
5 filas pendientes (53.6 hs: 16, 17, 18 y 21/09). La tarjeta del operario en
Mis registros suma solo lo aprobado → 0 hs. Las 10.5 aprobadas son del 14/09
(1ª quincena). El rótulo nuevo "Horas aprobadas · 2ª quincena" lo hace
explícito. Ojo: el 16/09 suma 22.45 hs pendientes en 2 filas — revisar al aprobar.

**Incidente 2:** `git worktree remove` del Backend siguió el junction de
`node_modules` y vació el del checkout principal; se recuperó con `npm ci` +
`prisma generate` (build y jest 760 OK). Para el Frontend se quitó primero el
junction con `cmd /c rmdir` (destino intacto, 563 entradas).

**PENDIENTES:**
- Borrar a mano dos carpetas sueltas (sin metadata de git):
  Backend `.claude/worktrees/redisenio-central-sertec` (solo un `.git`) y
  Frontend `.claude/worktrees/redisenio-central-sertec` (falló por "Filename
  too long" en `.next`).

---

## 92. Horas con un decimal en los totales sumados + deploy del rediseño completo (2026-09-22)

Pedido del usuario, antes de pasar a producción: "hay montos de tarjetas que
se ven mal, por ejemplo en cargas que hice con uno de los usuarios se ven
como hasta 8 decimales, se podría redondear ese número a un único decimal? y
revisar en todo el proyecto si ese problema también existe en otras secciones
y abordar la solución de la misma manera". Plan
`docs/superpowers/plans/2026-09-22-horas-un-decimal.md`; PR Frontend #79
(`fix/horas-un-decimal`, merge `0009141`). Sin Backend, sin API, sin DDL.

**Diagnóstico.** La base guarda todo con ≤ 2 decimales (`horas` Decimal(4,2);
litros/monto/km Decimal(8,2)/(12,2)); las colas nacen en **sumas en coma
flotante en el Frontend** sobre `Number(horas)`: `0.1 + 0.2 + 0.3 =
0.6000000000000001`. Se mostraban crudas en las tarjetas grandes de Mis
registros ("Cargas que hice", "Mis horas"), en el "hs totales" de cada lote
(`resumen-carga`, usado en Mis registros y Aprobaciones) y en el aviso "Xhs
ese día" (`totalHorasDia`, que el Backend suma en JS sin redondear en
`registros-horas.service.ts:761`). El Backend ya redondea a 2 decimales el
resto de sus totales. Inicio, control general y ranking ya redondeaban a 1
decimal inline: ese era el criterio del repo. Barrido del resto: importes de
liquidación/certificaciones pasan por `fmtMoneda`/`formatMoney`; no hay
sumas de litros/monto/km en el front.

**Decisiones (defaults del planificador, aprobados por el usuario):** helper
compartido `src/lib/horas.ts` → `redondearHoras(n): number` (1 decimal; un
entero sigue viéndose "8", punto decimal como el resto de la sección); no se
tocan los valores por fila ni `subtotalHoras` (alimenta el diálogo de
corrección); la comparación de alerta `>= 16` NO se redondea; Backend sin
tocar.

**Ejecución (carril completo):** planificador Fable/high; 5 pares por
ejecutores Opus/high (A+B en uno, C/D/E en paralelo sobre archivos disjuntos),
todos con test rojo pegado (el DOM mostraba `0.6000000000000001 hs` y
`16.000000000000004hs ese día`). Suite 828/828. Revisión (2 ejes +
verificador): **0 urgent, 1 high, 2 minor, 3 descartados**. **El high lo
introdujo el propio fix (R1):** el Par B redondeaba `totalHoras` en la capa
de datos (`agrupar.ts`) y el Par C volvía a redondear la suma → dos lotes de
8.25 daban 16.6 en vez de 16.5 (alcanzable: el `step=0.5` es solo el spinner).
Arreglo: el total del lote queda crudo y se redondea una sola vez al mostrar
(`resumen-carga.tsx`); test con dos lotes de 8.25 → `16.5 hs`. Suite final
**830/830**. **Lección: redondear en el render, nunca en la capa de datos que
después se vuelve a sumar.** El usuario probó en local ("dejame probarlo a
mí") y dio el OK.

**Deploy (pedido explícito: "mergea todo y el deploy en produccion").** Solo
Frontend, incluye el rediseño completo (#74-#78) y este fix (#79): front
`0b4babb` → `0009141`, build 33 s, `pm2 restart forms-horas-front` (PID
651809). Backend `f73b3da` → `ba62298` solo docs, sin build ni restart.
Verificado: `/`, `/login`, `/mis-registros`, `/liquidacion/analisis` 200;
fotos 200; `<title>` "Central Sertec"; dominio público
`https://misregistros.serytec.com.ar/login` 200 con el título nuevo; API sin
token 401. Documento `docs/2026-09-22-central-sertec-deploy.md`. Rollback =
front `0b4babb`.

**Trampas de la sesión:** el `main` local del Backend estaba 28 commits atrás
(todo se trabajó en worktrees) y no compilaba contra el cliente Prisma
regenerado → `git pull` + `prisma generate` antes de levantarlo; el usuario
rechazó una tanda de herramientas por error de UI y pidió seguir ("y?").

**PENDIENTES.**
- Backend: redondear `totalHorasDia` en `registros-horas.service.ts:761`
  (`Math.round(x * 100) / 100`, como el resto de sus totales). Un par chico.
- Inicio suma `estado !== 'desaprobado'` y Mis registros solo `'aprobado'`:
  dos totales distintos para la misma quincena (previo). Decidir criterio.
- Minor sin tocar: `page.test.tsx` no resetea `h.registros` en `beforeEach`;
  comentario del bug repetido en tres archivos.
- `combustible/page.tsx` muestra litros/monto sin separador de miles (otro
  pedido, si el usuario lo quiere).
- Recorrida del usuario en producción con Liquidador/Admin de los tableros
  con la tipografía unificada.
- Borrar el worktree `redisenio-central-sertec` de ambos repos cuando no haga
  falta seguir en él.

---

## 91. Rediseño "Central Sertec": la app pasa a sistema interno integral — las 3 etapas en main con fotos reales, DEPLOYADO el 2026-09-22 (2026-09-21 → 2026-09-22)

El usuario pidió un cambio visual de **toda** la aplicación para que funcione
como un ERP o sistema interno integral de la empresa, con módulos
re-fashionados, un nombre nuevo en el inicio (dejar de llamarlo "Registro de
Horas") y fotos de la empresa de fondo. Se investigaron referencias, se
presentó un **mockup con tres direcciones** (guardado como spec en
`docs/superpowers/specs/2026-09-21-redisenio-central-sertec-mockup.html`) y
el usuario decidió: dirección **B "Grafito industrial"**, nombre **"Central
Sertec"**, módulos en cuatro áreas (**Operación**: reporte, mis registros,
aprobaciones, control general, km por tantos, combustible; **Personas**:
novedades, ausencias; **Resultados operativos**: liquidación y
certificaciones; **Administración**), alcance **total**, y los perfiles de
empleados **se quedan dentro de Liquidación** (corrección explícita). Las
fotos las manda después; mientras, un marcador grafito con luz dorada.
Decisión y vocabulario en **ADR-025**
(`docs/adr/2026-09-21-adr-025-central-sertec-sistema-de-diseno.md`) y
`CONTEXT.md` ("Central Sertec", "Área"). Plan en
`docs/superpowers/plans/2026-09-21-redisenio-central-sertec.md`: 3 etapas y
5 PRs, 13 defaults aceptados, corregido por el planificador (el dorado sobre
grafito **sí** cumple contraste, 8,6:1; lo que falla es dorado como texto
sobre claro y `slate` sobre grafito).

**Etapa 1 — nombre, tokens y barra (Frontend #74, docs Backend #86, en
main).** Tokens `graphite #1b1f24`, `graphite-2`, `sand-deep #f3f1ec`;
`nav.ts` con `AREAS` y `navPorArea(perfil)` (los roles siguen decidiendo qué
se ve); barra lateral grafito con títulos de área en dorado, activo con banda
dorada, hover blanco translúcido, monograma "CS" plegada; login, pestaña y
barra dicen "Central Sertec · Sistema interno". Paso R1 salido de la prueba
visual: en pantallas bajas la barra tapaba el botón de plegar; ahora el menú
scrollea internamente y el pie queda fijo. Revisión 0/0/7 minor.

**Etapa 2 — inicio y login (Frontend #75, en main).** `FondoFoto`
(`components/layout/fondo-foto.tsx`): grafito + foto opcional con dos velos
siempre (gradiente y luz dorada), `prioridad` apagada en el login;
`src/lib/fotos.ts` con `FOTOS.inicio/login` en `null` (encender = copiar a
`public/fotos/`, ≤ 400 KB, y setear la ruta). El inicio va **sin
contenedor** (`RUTAS_SIN_CONTENEDOR = ['/']`) con franja a todo el ancho:
saludo, fecha larga y quincena en curso; debajo los indicadores por rol y
una sección por área con las tarjetas. Login con foto a pantalla completa,
tarjeta `graphite/90`, foco dorado; errores en `red-300/200` porque `danger`
sobre grafito da 3,3:1. Decisiones del usuario en la muestra: logo y título
**fuera** de la tarjeta; puntos de área **todos dorados** (único acento).
Revisión 0/0/10 minor.

**Etapa 3a — base + Operación (Frontend #76, en main el 2026-09-22).** `PageHeader` acepta `area` y muestra "Operación" o
"Operación · eyebrow" (default: los eyebrows que solo nombraban rol o módulo
se reemplazan por el área); `StatTile` compartido (`components/stat-tile.tsx`,
API unión: `tone`, `colorearSoloSiPositivo`, `icon`, `href`/`onClick`,
`testId`, `animar`) reemplaza al de control general y a los indicadores del
inicio, que pasan a verticales y colorean el valor solo si es > 0; `SubNav`
compartido reemplaza las tres copias de admin, liquidación y certificaciones
con guards intactos y `aria-current`; las 7 páginas de Operación llevan el
área. Suite 779/782 con 3 timeouts de reporte que pasan aislados; revisión
**0 urgent, 0 high, 6 minor, 4 descartados**.

**Método.** Carril completo del flujo de dos carriles: planificador
Fable/high, 12 pares test-rojo → implementación por ejecutores Opus/high (1.1
a 1.4 + R1, 2.1 a 2.4, 3a.1 a 3a.4), y por PR: suite completa una vez,
`code-review` en dos ejes y `verificador-review`. Ningún urgent/high en tres
revisiones; los minor van listados en cada PR. Servidores locales levantados
desde el worktree (`next dev --webpack`, backend desde `dist`) para la
recorrida visual con Chrome; la sesión venció antes de recorrer 3a.

**2026-09-22 — mobile, fotos reales y PR 3a (Frontend #76).** Se recorrió 3a
en local con la extensión de Chrome a 390 px (la ventana maximizada no
acepta `resize`; se usó un iframe `sandbox` de 390 px, que además evita que
la app navegue el top): sin desborde horizontal en inicio, reporte, mis
registros, control general, km por tantos, combustible y nueva carga; el
usuario acotó que **para el personal de campo alcanza con reporte, mis
registros y combustible**, el resto es administrativo. Único desborde,
**preexistente**: la fila de pestañas de `/aprobaciones` (~15 px). El usuario
mandó dos fotos (`Desktop/FotosApp`): una panorámica generada de la cuadrilla
(3064×1376) y una vertical real de trabajo en altura (1200×1600). Se le
mostró una previsualización compuesta (PIL, mismos velos) y aprobó
panorámica → inicio (1920×700, 374 KB) y vertical → login (1440×1920, 275 KB);
par F1 con `fotos.test.ts` (rojo con `null`) y luego, al verlo en la app,
pidió "la imagen del login un poco más abajo": se le mostraron tres anclajes
en la app real y eligió **38 %** → paso F2: `FondoFoto` gana `posicion`
(clase de `object-position`), el login pasa `object-[center_38%]`, el inicio
sigue centrado. Suite 786/786; revisión fotos 0/0/4 minor, posición sin
hallazgos. Tres commits en un PR (#76), mergeado con `--admin`. **Trampas:**
Claude Code mató los servidores de fondo por poca memoria y quedaron `node`
huérfanos en 3000/3001 que siguieron sirviendo (el nuevo arranque falla por
puerto ocupado); el `main` local del Backend está 28 commits atrás y no
compila contra el cliente Prisma regenerado (`git pull` antes de tocarlo);
al compilar rutas nuevas, el dev server recarga el top y pisa el iframe de
prueba. Deuda nueva: `priority` de `next/image` deprecado en Next 16
(`fondo-foto.tsx`).

**Etapa 3b — Personas + Administración (Frontend, mismo día, tras el OK
"seguí con los pendientes").** Un ejecutor (Opus/high) hizo los 13 pares de
una vez: novedades y ausencias → área Personas (novedades conserva
"Personas · Las que cargaste vos"; el eyebrow "Higiene y Seguridad" solo
nombraba el rol y se fue), las 10 páginas de admin → Administración, test de
área por página, `categorias-uocra` gana su primer test, y 3b.R1 `flex-wrap`
en las pestañas de aprobaciones. 14 rojos → 132/132; suite 799/800 (timeout
flaky de `resumen-page.test.tsx`, pasa aislado). Revisión con dos revisores
en paralelo + verificador: **0 urgent, 1 high, 2 minor, 6 descartados**. El
high (3b.R2): el test negativo "Supervisor NO ve la aclaración" hacía
`queryByText('Las que cargaste vos')` exacto y, como el encabezado ahora
imprime "Personas · Las que cargaste vos" en un nodo, la aserción quedó
vacía; pasó a regex y se probó que falla con el eyebrow forzado. **Lección:
al cambiar el texto de un encabezado, revisar también los tests negativos
que lo buscan.** El verificador destapó que las pestañas de `/ausencias`
desbordaban más que las de aprobaciones (~420 px sobre 375); el usuario pidió
sumarlo al PR (3b.R3, test rojo → verde). Un solo PR, mergeado con `--admin`.
Deuda preexistente vista: `react-hooks/set-state-in-effect` en
`aprobaciones/page.tsx:60` y `ausencias/page.tsx:212`.

**Etapa 3c — Resultados operativos (Frontend #78, mismo día).** Dos
ejecutores en paralelo sobre archivos disjuntos (A liquidación: 6 páginas +
2 tabs de tarifas + tile de análisis; B certificaciones: 5 páginas + 3
tiles): los eyebrows "Liquidador"/"Liquidación"/"Certificaciones" nombraban
rol o módulo y se reemplazaron por el área; las 4 copias locales de
`StatTile` se fueron (−66 líneas) y el compartido dejó verdes las
aserciones del monto largo de carga sin tocarlas. 15 rojos → 114 + 154
verdes; suite completa **816/816** sin flaky; tsc limpio. Revisión (2 ejes +
verificador): **0 urgent, 0 high, 3 minor, 5 descartados**; en los 5
archivos sensibles (cierres ×2, detalle de quincena, 2 tabs de tarifas) el
diff es solo la línea del `PageHeader`, verificado por archivo. La 2.ª ronda
prevista para cierres/precios no tuvo hunks de arreglo que revisar. Un
revisor afirmó que admin/novedades "seguían sin área": falso, el verificador
lo descartó con `git grep` sobre HEAD (lección: los revisores pueden leer un
ref viejo; el verificador es la compuerta). Cambio visual asentado (3a.2):
los importes largos de análisis, resumen y analytics bajan un escalón de
tipografía y ganan `font-display`. **Rediseño completo en `main` del
Frontend (#74, #75, #76, #77, #78); producción NO lo tiene.**

**PENDIENTE.**
- ~~Deploy del rediseño completo~~ **HECHO el 2026-09-22** junto con el fix
  de horas (§92): front `0009141`, solo Frontend; documento
  `docs/2026-09-22-central-sertec-deploy.md`; rollback = front `0b4babb`.
- Recorrida visual del usuario en producción o en local con Liquidador/Admin:
  los tableros de análisis, resumen y analytics con la tipografía nueva.
- (histórico) **PR 3c**
  (Resultados operativos: liquidación y certificaciones, migración de los 4
  `StatTile` locales; **2 rondas de revisión** porque toca vistas de cierres
  y precios; `colorearSoloSiPositivo` solo con `value` numérico).
- **Deploy**: **NO** hasta que las tres etapas estén mergeadas y el usuario lo
  pida explícitamente; documento `docs/2026-MM-DD-central-sertec-deploy.md`
  en ese momento. Producción sigue en `f73b3da` back / `0b4babb` front.
- Docs del Backend: la rama `docs/redisenio-central-sertec` se mergea por
  PR al cerrar cada etapa (este cierre de 3a incluido).
- Deuda anotada: anillo de foco `brand/40` del botón de login sobre grafito
  ~2,5:1 (preexistente); azul `#3b6fc4` repetido a mano en certificaciones
  existiendo `--color-chart-2`.
