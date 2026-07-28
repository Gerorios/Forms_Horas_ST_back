
# Contexto del proyecto — App de Registro de Horas

> Documento vivo. Si retomás esta conversación en otra sesión, pegá o subí este
> archivo para arrancar sin repetir preguntas.

---

## 1. Qué es la app

Sistema web (con uso desde celular en campo) para que operarios y jefes de
cuadrilla registren horas trabajadas por tarea/contrato, con flujo de
aprobación por Jefe de Contrato y, en el caso de Ausencias, por Higiene y
Seguridad (HyS). Los datos aprobados son consumidos por un sistema externo de
liquidación que se conecta directamente a esta base de datos.

---

## 2. Volumen y stack

- **Usuarios:** 50–200 totales. Sin modo offline (siempre hay conexión).
- **Base de datos:** MySQL/MariaDB propia, IP pública `191.101.235.7:3306`, base `testing`.
- **Backend:** Node.js + NestJS + Prisma (ORM).
- **Frontend:** Next.js.
- **Auth:** JWT (token en header Authorization).
- **Hosting testing:** Vercel (frontend) + Render (backend).
- **Hosting producción (recomendación):** Vercel (frontend) + Railway (backend).
  Railway es preferible a Render en producción por uptime garantizado, soporte
  a variables de entorno secretas y escala sin cold-starts.

---

## 3. Roles (fijos y excluyentes, una persona = un rol)

| Rol | Qué puede hacer |
|-----|-----------------|
| **Operario** | Carga masiva de horas (propias y/o de un equipo *ad hoc*) + consulta su propio historial. |
| **Jefe de Contrato** (3 personas) | Aprueba/desaprueba registros de su contrato. Puede reabrir y editar registros ya aprobados. También puede cargar. |
| **Supervisor** | Puede cargar novedades. |
| **Higiene y Seguridad (HyS)** | Aprueba específicamente las Ausencias. |
| **Admin (IT)** | Acceso total. Administra catálogos (tareas, contratos, tipos de novedad, móviles, usuarios). **Un solo usuario admin.** |

> ~~**DECISIÓN (2026-07-02): el rol "Jefe de Cuadrilla" NO existe.**~~
> ⚠️ **SUPERSEDED por ADR-001 (2026-07-03)** — ver `docs/adr/2026-07-03-adr-001-modelo-de-roles.md`.
> Ahora **SÍ existe Jefe de Cuadrilla**: es quien carga (persona responsable), y el
> **Operario NO carga** (solo consulta sus propias horas, read-only). Ver §15.

---

## 4. Relación con la tabla externa de Empleados (SOLO LECTURA)

- Tabla: `snuempleados` — PK `cuil` (char 13). Ya existe, **no se toca**.
- Contiene datos fijos: nombre, legajo, sección, categoría, cargo, domicilio, `activo`, `borrado`.
- **No todos los empleados cargan horas.** Solo tienen fila en `usuarios` (con login) los que efectivamente inician sesión.
- El desplegable "elegir operario/equipo" muestra **todos los empleados activos**
  (`activo='S'` y `borrado<>'S'`), tengan o no usuario con login.
- **Login:** email ficticio creado por la empresa (no existe en `snuempleados`) + contraseña. Vive en `usuarios.email`. Formato libre, lo define el Admin al crear el usuario.

---

## 5. Restricción de contratos — a quién le pertenece

- Un **empleado** puede recibir horas de **cualquier** contrato. Sin restricción.
- La restricción M:N `ContratoHabilitado` cuelga del **Usuario** (quien inicia sesión y hace la carga), no del empleado.
- Ejemplo: el usuario X tiene habilitados K5 y K8. Cuando carga un registro,
  **solo puede elegir tareas de K5 o K8**, pero el desplegable de a quién le
  carga (operario/equipo) sigue siendo la lista completa de empleados activos.
- En `RegistroHoras` hay dos referencias distintas:
  - `operarioCuil` → dueño de las horas (cualquier empleado activo).
  - `cargadoPorCuil` → quien hizo la carga (siempre un Usuario con login).
  - La validación "¿puede cargar esta tarea?" se hace contra
    `ContratoHabilitado(cargadoPorCuil)`, **no** contra `operarioCuil`.

---

## 6. Reglas de negocio confirmadas

### 6.1 Modelo del formulario de carga masiva (LA pantalla central)

**Una carga** produce N filas atómicas en `registros_horas`. Estructura:

- **Compartido por toda la carga:** `fecha` (retroactiva, la elige el usuario),
  `provincia` (siempre 1), GPS (automático al abrir el form), `móviles[]`
  (selección múltiple, aplican a TODOS los operarios).
- **Operarios[]:** N empleados activos seleccionados. Todos trabajaron
  exactamente lo mismo.
- **Líneas[]:** cada línea = `{ contrato, tarea, horas }`. Puede haber varias
  (ej. K5·Excavación·5hs + K8·Montaje·5hs). Más de 1 tarea por contrato es
  posible aunque no frecuente.

**Resultado = (N operarios) × (M líneas) filas**, todas idénticas salvo el
`operarioCuil`. Cada fila recibe los mismos móviles y provincia.

> Ejemplo: 4 operarios, K5·Excavación·5hs + K8·Montaje·5hs → **8 filas** (4×2).
> Las horas totales y los móviles son iguales para los 4 operarios.

Este es el motivo del cambio desde AppSheet: la multiselección se guardaba
desnormalizada. Acá cada fila es atómica y la vista de liquidación las suma limpio.

### 6.2 Registro de fecha

- El usuario elige la **fecha de la tarea** (retroactiva).
- La BD guarda además `created_at` = cuándo se cargó realmente (para control).

### 6.3 Corrección de un registro desaprobado

- El que cargó puede **corregir la misma fila** → vuelve a estado `pendiente` y
  el cambio queda en `auditoria` (quién, cuándo, valor anterior/nuevo).
- **NO** se anula ni se crea una fila nueva. Debe re-aprobarse.
- ⚠️ **Gap de backend (2026-07-02):** falta el endpoint `PATCH /registros-horas/:id`
  que edite la fila + resetee a `pendiente` + registre auditoría. Hoy solo existen
  `crear`, `resolver` y `reabrir`.

### 6.4 Historial y quincena

- El operario ve **solo lo suyo** (nunca lo de compañeros): historial de registros
  con estado (pendiente/aprobado/desaprobado) + detalle para controlar la carga.
- Consulta de horas **por quincena** (1–15 / 16–fin de mes), calculada por función
  sobre la fecha. Sin tabla ni estado de cierre.

### 6.5 GPS y sesión

- GPS se captura **al abrir el formulario**. Si el usuario deniega el permiso,
  **igual puede guardar** (queda sin coordenadas, con provincia manual de respaldo).
- **Sesión JWT: 1 hora máximo** (reducida desde las 8h iniciales).

### 6.6 Otras reglas

- Un operario puede cargar varias tareas distintas en el mismo día, cada una con sus horas.
- Catálogo de tareas por contrato: tabla nueva `tareas_catalogo`, administrada por Admin. (**La tabla existente `ma_contrato_tareas` será eliminada — no usar.**)
- Catálogo de móviles (vehículos): tabla nueva `moviles`, selección múltiple por registro.
- Ubicación: GPS automático + selección manual de provincia como respaldo.
- Un Jefe de Contrato puede reabrir/editar un registro ya aprobado → requiere **historial de auditoría completo** (quién, cuándo, valor anterior/nuevo).
- Alerta (no bloqueo duro) si un registro supera 16 horas en un día.
- Sin notificaciones push/email. El estado (pendiente/aprobado/desaprobado) se consulta en el panel.
- Tipos de novedad: administrables por Admin (no fijos en código). Solo **Ausencias** requieren aprobación de HyS. El respaldo de una Ausencia es opcional y puede ser solo texto.
- **Viático y Guardia:** esta app solo registra la marca (que ocurrió). El monto lo calcula el sistema externo de liquidación.
- **Quincenas:** no existe tabla física. El período (1–15 / 16–fin de mes) se calcula con una función sobre la fecha del registro. No hay estado de "cierre" de quincena.
- **El sistema de liquidación externo** consumirá los datos a través de una **vista SQL** (no tabla directa). La vista queda a definir con el equipo de sistemas.

---

## 7. Estado del schema Prisma

Archivo: `prisma/schema.prisma` — **válido y listo para migrar**.

Tablas existentes en la BD (solo lectura para esta app):
- `snuempleados` → modelo `snuempleados` en Prisma.

Tablas nuevas que crea la migración:
- `roles`, `usuarios`, `contratos_habilitados`
- `contratos`, `tareas_catalogo`, `moviles`, `provincias`, `tipos_novedad`
- `registros_horas`, `registro_moviles`, `novedades`, `auditoria`

---

## 8. Pendientes reales

| # | Pendiente | Impacto |
|---|-----------|---------|
| 1 | Catálogo real de tareas por contrato (K2–K12) | Seed de `tareas_catalogo` |
| 2 | Catálogo real de móviles (patentes/internos) | Seed de `moviles` |
| 3 | Quiénes son los 3 Jefes de Contrato (cuil o legajo) | Seed de `usuarios` + `contratos` |
| 4 | Qué contratos están activos hoy (cuáles de K2–K12) | Seed de `contratos` |
| 5 | Diseño de la vista SQL para liquidación | A definir con sistemas |

---

## 9. Estado del BACKEND (2026-07-02)

**Ya implementado y verificado** (rama `feature/nestjs-backend`):

- ✅ Proyecto NestJS 11 + Prisma 7 corriendo en `http://localhost:3001`.
- ✅ **Conexión a MySQL vía adapter:** Prisma 7 eliminó `url` del schema. Se usa
  `@prisma/adapter-mariadb` (MySQL-compatible) instanciado en `PrismaService` con
  `DATABASE_URL`. Provider del schema sigue siendo `mysql`.
- ✅ Módulo Auth (login JWT + guards de roles), Empleados, RegistroHoras (crear /
  resolver / reabrir), Novedades (crear / resolver HyS), Admin (ABM completo).
- ✅ Verificado con curl: validación, 401 sin token, conexión real a BD.

**Gaps de backend pendientes:**

1. ⚠️ **Colapsar rol `JefeCuadrilla` → `Operario`** en los `@Roles(...)` de
   `registros-horas.controller.ts` y en el seed de roles.
2. ⚠️ **Endpoint `PATCH /registros-horas/:id`** para editar + resetear a
   `pendiente` + auditoría (flujo de corrección de desaprobados — ver §6.3).
3. Correr la migración `prisma migrate` (o `db push`) para crear las 12 tablas.
4. Seeds reales (ver §8).
5. Vista SQL para liquidación (coordinado con sistemas).

---

## 10. FRONTEND (Next.js) — a construir

**Stack confirmado (2026-07-02):**
- Next.js **App Router** + TypeScript.
- **Tailwind CSS** con tokens de marca (`#ECB332` / `#7C8081`).
- **shadcn/ui** para componentes (multiselect, tablas, dialogs).
- **TanStack Query** para datos/caché de servidor.
- **React Hook Form + Zod** para el formulario de carga masiva.
- Auth: **JWT en header Authorization**, guardado en cliente + Context + protección de rutas.
- Hosting testing: Vercel.

**Plan de construcción por fases** (`docs/superpowers/plans/`):
- **Plan 1 — Fundación:** fixes de backend + BD/seed + scaffold + sistema de diseño + auth/login + layout.
- **Plan 2:** Carga masiva + Mis registros (Operario).
- **Plan 3:** Aprobaciones (Jefe Contrato) + Novedades (Supervisor) + Ausencias (HyS).
- **Plan 4:** Panel Admin.

**Diseño / marca:**
- Logo: `Frontend/public/logo.png` — tucán estilizado en círculo (570×726). *(Renombrado desde `LogoST.png` el 2026-07-02.)*
- **Paleta exacta (muestreada del logo):**
  | Color | Hex | Uso |
  |-------|-----|-----|
  | Amarillo dorado | `#ECB332` | Marca / acento primario / botones primarios. Es **cálido**, NO alerta. |
  | Gris neutro | `#7C8081` | Texto secundario, bordes, superficies. |
  | Blanco | `#FFFFFF` | Fondo. |
- ⚠️ Para **alertas** (ej. aviso >16hs) usar un color distinto (naranja/rojo), NO el
  amarillo de marca, para no confundir.
- Prioridad: **web intuitiva, clara y rápida**, buena en móvil (uso en campo desde
  el browser, sin PWA ni offline).
- Referencia previa: se usaba **AppSheet**; se migra por la mala desnormalización
  de la multiselección. NO se migran datos viejos (estaban en Google Sheets).

**Pantallas por rol:**

| Rol | Pantallas |
|-----|-----------|
| **Operario** | (a) Formulario de **carga masiva** (ver §6.1) · (b) **Mis registros**: historial propio con estado + detalle + consulta por quincena. |
| **Jefe de Contrato** | Bandeja de **aprobación** (registros de todos sus contratos, mezclados*) + reabrir/editar + puede cargar. |
| **Supervisor** | Carga de **novedades**. |
| **HyS** | Bandeja de **ausencias** para aprobar. |
| **Admin (IT)** | ABM de catálogos, usuarios, contratos, tipos de novedad, móviles. |

> *Mezclados a propósito: si un operario cargó un registro con 2 contratos y solo
> 1 pertenece a ese jefe, el jefe igual debe poder verlo.

**Detalles de UX confirmados:**
- Carga masiva: selector múltiple de operarios (lista = empleados activos), selector
  múltiple de móviles, 1 provincia, fecha manual retroactiva, líneas
  `{contrato → tarea → horas}` agregables. Al guardar se expande a N×M filas.
- El selector de tareas se filtra por los contratos **habilitados al usuario que
  carga** (`ContratoHabilitado(cargadoPorCuil)`), no por el operario.
- "Mis registros": solo lo propio, siempre. Filtro por quincena.
- Sesión de 1 hora → manejar expiración de token con re-login limpio.

---

## 11. Estado de la sesión (2026-07-02) — dónde retomar mañana

**Qué se hizo hoy:**
- Se renombró el logo `LogoST.png` → `logo.png` en `Frontend/public/`.
- Se confirmó el stack: **Next.js (App Router)** (se descartó una propuesta inicial
  de Vite; el usuario ratificó Next.js según §2/§10).
- Se recorrió el backend real (controllers, services, DTOs, `schema.prisma`) y se
  alineó el diseño con este contexto.

**Estábamos en:** brainstorming del **frontend, Fase 1 (Fundación)**. Diseño
propuesto y a la espera de aprobación:
- Scaffold Next.js + TS + Tailwind (tokens `#ECB332` / `#7C8081` + color de alerta
  aparte) + shadcn/ui + TanStack Query + Axios (interceptor Bearer/401) +
  React Hook Form + Zod.
- Auth: `POST /auth/login` + `GET /auth/perfil` → Context de sesión; interceptor 401
  → re-login limpio (sesión 1 h).
- Layout protegido con navegación por rol + rutas `/login` y `/403`.
- Estructura de carpetas App Router (ver propuesta en el chat).

**Decisiones PENDIENTES de responder para cerrar Fase 1:**
1. **Token: `localStorage` (recomendado) vs cookie httpOnly.** → SIN DEFINIR.
2. **Alcance de la primera entrega: ¿solo Fase 1, o Fase 1 + Fase 2 (carga masiva +
   mis registros) juntas en el spec/plan?** → SIN DEFINIR.

**Recordatorio de gaps de backend que habilitan las fases siguientes** (detalle en §9):
colapsar `JefeCuadrilla`→`Operario`, `PATCH /registros-horas/:id`, endpoint **batch**
para la carga masiva N×M, migración + seeds, bajar JWT 8 h → 1 h.

---

## 12. Estado de la sesión (2026-07-03) — Fase 1 COMPLETA

**Decisiones cerradas:** token en `localStorage` (clave `sth_token`); alcance de la
entrega = solo Fase 1.

**Spec y plan** (rama `feature/nestjs-backend`):
- Spec: `docs/superpowers/specs/2026-07-03-frontend-fase1-fundacion-design.md`
- Plan: `docs/superpowers/plans/2026-07-03-frontend-fase1-fundacion.md`

**Fase 1 implementada (8 tareas, TDD, commits en `feature/nestjs-backend`):**
Scaffold Next.js 16 + TS + Tailwind v4 (tokens `brand`/`neutral`/`alert`, tema claro
forzado) + Vitest; cliente Axios con interceptores Bearer/401; API auth + `SessionProvider`
(token en `localStorage`); navegación por rol + guard `canAccess`; providers globales
(TanStack Query + Session); página `/login` (RHF + Zod); layout `(protected)` con guard +
`AppShell` + home por rol + `/403`.
- Verificación: `npm test` 16/16, `npm run build` OK, `npm run lint` limpio.
- **E2E backend verificado por curl:** login → token, `GET /auth/perfil` 200 con la forma
  esperada. **Click-through en navegador: lo prueba el usuario** con las credenciales de
  prueba de abajo.

**Seed de PRUEBA cargado en la BD (reversible, borrar cuando no se use):**
- 5 roles (`sth_roles`): Operario, JefeContrato, Supervisor, HyS, Admin.
- 2 usuarios (`sth_usuarios`):
  - `admin@test.local` / `admin1234` → rol Admin, cuil 20116635330 (GUERRERO ALBERTO DAVID).
  - `operario@test.local` / `oper1234` → rol Operario, cuil 20163079845 (TORRES RAMON FERNANDO).
- Nota: `sth_usuarios`/`sth_roles` estaban vacías; las 12 tablas ya existían en la BD.

**Gaps de backend detectados en esta sesión (además de §9):**
- `npm run start:prod` usa `node dist/main`, pero el build genera `dist/src/main.js`
  (por el `prisma.config.ts` en la raíz que corre el `rootDir`). Ajustar el script o el build.

**Próximo paso al retomar:** cerrar/integrar la rama `feature/nestjs-backend`
(merge/PR) — o, si se sigue con Fase 2 (carga masiva + mis registros), resolver
antes los gaps de backend (endpoint batch N×M, `PATCH /registros-horas/:id`,
colapsar rol, seeds reales, JWT 1 h).

---

## 13. Repositorios y hitos (2026-07-03, sesión 2)

### Repos
- Se **descartó** el repo cajón-de-sastre (`Aplicaciones Web/.git`, borrado). Archivos
  legacy rescatados en `Aplicaciones Web/_rescate_repo_viejo/`.
- **Dos repos separados**, cada uno `git init` con commit inicial limpio en rama `main`:
  - `Formulario_Horas/Backend` → futuro `formulario-horas-backend`.
  - `Formulario_Horas/Frontend` → futuro `formulario-horas-frontend`.
- **Remotos en GitHub pendientes** (no hay `gh` instalado): crear repos vacíos y
  `git remote add origin ... && git push -u origin main` en cada uno.
- `.env` fuera del control de versiones; hay `.env.example` en ambos.

### Integridad de la BD (IMPORTANTE)
- ⚠️ **NUNCA correr `prisma db push` ni `prisma migrate` contra esta BD**: es
  **compartida** con otros sistemas (liquidación, certificaciones, etc.) y el schema
  Prisma solo modela las tablas `sth_` + `snuempleados`, así que `db push` intentaría
  **DROPEAR decenas de tablas ajenas**. Gestionar DDL a mano (SQL puntual).
- Las 12 tablas `sth_` existían **sin foreign keys**. Se agregaron **19 FKs** a mano
  (con `prisma migrate diff` como referencia, aplicando solo los `ADD CONSTRAINT` de
  `sth_`). Integridad referencial completa.
- **Charset:** `snuempleados.cuil` es **utf8mb3**; nuestras columnas `cuil` estaban en
  utf8mb4 → las FKs a empleados fallaban (error 3780). Se convirtieron las columnas
  `cuil` de las tablas `sth_` a **utf8mb3_general_ci** para igualar al legacy. (Prisma
  no representa collation por columna en el schema; no importa porque no usamos migrate.)

### Paso B — gaps de backend RESUELTOS (commits en repo backend)
- `15a3eed`: colapsar `JefeCuadrilla`→`Operario` en `@Roles`, JWT **1 h**, fix `start:prod`
  (`dist/src/main`).
- `2ba40b7`: **`POST /registros-horas/batch`** (expande N×M en transacción, valida
  contratos habilitados, alerta >16 h por operario/día con lecturas fuera de la
  transacción y `timeout: 30000` por latencia de BD remota) y **`PATCH /registros-horas/:id`**
  (corrige la fila → `pendiente` + limpia aprobación + auditoría `editar`; permiso del que
  cargó o JefeContrato/Admin).
- **Verificado en vivo por curl:** batch 2×2 = 4 filas; 403 con contrato no habilitado;
  PATCH resetea a pendiente con auditoría. Registros de prueba borrados (registros_horas
  en 0). Quedó seed de prueba útil: provincia `Córdoba` (id 1), contrato `K5` (id 1) con
  admin habilitado, tareas `Excavación`/`Montaje`.

### Gaps de backend que siguen pendientes
- Seeds reales (contratos K2–K12, tareas, móviles, 3 Jefes de Contrato). Ver §8.
- Vista SQL para el sistema de liquidación (coordinar con sistemas).
- Sin tests automatizados en el backend todavía (verificación fue por curl/integración).

**Próximo paso:** crear los remotos en GitHub y pushear, y/o arrancar la **Fase 2**
del frontend (carga masiva + mis registros), que ya tiene el backend listo.

---

## 14. Fase 2 COMPLETA (2026-07-03, sesión 2)

**Repos remotos** (creados y vinculados por el usuario):
- Backend: `https://github.com/Gerorios/Forms_Horas_ST_back.git`
- Frontend: `https://github.com/Gerorios/Forms_Horas_ST_Frontend.git`

**Nomenclatura:** la pantalla de carga se llama **"Reporte diario"** (ruta `/reporte`);
internamente usa `POST /registros-horas/batch`.

**Spec y plan** (en repo backend):
- Spec: `docs/superpowers/specs/2026-07-03-frontend-fase2-reporte-diario-design.md`
- Plan: `docs/superpowers/plans/2026-07-03-frontend-fase2-reporte-diario.md`

**Implementado (10 tareas, subagentes + TDD):**
- **Backend:** módulo `catalogos` (GET `/catalogos/tareas?contratoId=`, `/catalogos/provincias`,
  `/catalogos/moviles`, solo `JwtAuthGuard`) — verificado por curl.
- **Frontend:** shadcn/ui inicializado (tokens de marca intactos); utils puras de quincena
  (con fix de zona horaria: `enQuincena` parsea fecha local) y conteo N×M; capa de API
  (hooks catálogos/empleados/registros); `useGeolocation`; `OperariosSelect` (búsqueda
  server-side desde 3 caracteres); `LineasField`; página **Reporte diario** (`/reporte`);
  página **Mis registros** (`/mis-registros`, solo `operarioCuil` propio, filtro de quincena
  en cliente); nav renombrada + Toaster global.
- Verificación: **37/37 tests**, `npm run build` OK, `npm run lint` limpio. Catálogos en vivo OK.
- Detalles: la provincia se auto-selecciona a la primera (contexto: "provincia siempre 1");
  se evitó `setState`-en-effect (provincia derivada, geo con init perezoso).

**Pendiente / próximo:**
- Fase 3: bandeja de aprobación (Jefe de Contrato), novedades (Supervisor), ausencias (HyS).
- Sin tests automatizados en backend todavía (verificación por curl).
- UI de corrección desde "Mis registros" vía `PATCH /registros-horas/:id` (endpoint ya existe).
- Seeds reales de catálogos (contratos K2–K12, tareas, móviles, jefes).

---

## 15. ADR-001 — Modelo de roles revisado (2026-07-03)

Ver `docs/adr/2026-07-03-adr-001-modelo-de-roles.md` y `docs/glosario.md`.

**Cambio:** se reintrodujo **Jefe de Cuadrilla** (carga las horas del equipo, para
cualquier empleado activo) y el **Operario pasó a read-only** (solo consulta sus
propias horas). Cargadores = **JefeCuadrilla / JefeContrato / Admin**.

**Implementado (esta etapa):**
- Backend (`e11321b`): `@Roles` de crear/batch/patch → JefeCuadrilla/JefeContrato/Admin
  (sin Operario); `GET /registros-horas` suma filtro `cargadoPorCuil`. Seed: rol
  `JefeCuadrilla` + usuario de prueba `jefecuadrilla@test.local` / `jdc12345`
  (cuil 20169331708, habilitado en K5). Verificado por curl (JdC carga 201, Operario 403).
- Frontend (`8e1eb2a`): `Rol` suma `'JefeCuadrilla'`; nav (Operario → solo Mis registros;
  JdC → Reporte diario + Mis registros); **Mis registros rol-aware**: JdC con 2 pestañas
  (*Mis horas* / *Cargas que hice* vía `cargadoPorCuil`), Operario solo *Mis horas*.
  41/41 tests, lint y build OK.

**Diferido (etapa siguiente):** provisión de usuarios read-only de los operarios
(~121+ altas) y pulido de su vista de consulta.

**Usuarios de prueba vigentes:** `admin@test.local`/`admin1234` (Admin),
`jefecuadrilla@test.local`/`jdc12345` (JefeCuadrilla), `operario@test.local`/`oper1234` (Operario).

---

## 16. Decisión de diseño visual (2026-07-03)

- Las pantallas actuales son **andamiaje funcional en crudo** (HTML + utilidades Tailwind),
  NO el diseño final. shadcn/ui está instalado pero aún sin aplicar en serio.
- **Decisión:** el **rediseño visual se hace AL FINAL, después de la Fase 3** (primero toda la
  funcionalidad en crudo; luego un único pase de diseño global).
- **Dirección estética elegida: "limpio y profesional"** — dashboard sobrio: mucho blanco,
  tarjetas, bordes suaves, tipografía legible, **dorado de marca `#ECB332` como acento**
  (botones/estados activos), gris `#7C8081` para texto/bordes. Mobile-first (uso en campo).
- Al hacer el pase: adoptar componentes shadcn (button/input/select/table/tabs/card/dialog/
  toast), estados de carga/vacío, y un shell (header/nav) prolijo. Usar el skill
  `frontend-design`.

---

## 17. Fase 3 COMPLETA (2026-07-03) — Aprobaciones + Novedades + Ausencias

Spec: `docs/superpowers/specs/2026-07-03-fase3-aprobaciones-novedades-ausencias-design.md`
Plan: `docs/superpowers/plans/2026-07-03-fase3-aprobaciones-novedades-ausencias.md`

**Backend** (`formulario-horas-backend`):
- `GET /catalogos/tipos-novedad` (activos).
- `GET /registros-horas/por-aprobar` (JefeContrato/Admin): agrupa por (operario, fecha),
  trae filas pendientes de esos pares incluyendo otros contratos como contexto, con flag
  `accionable` (true si es fila del contrato del jefe). Admin ve todos los contratos.
- `resolver`/`reabrir` ahora exigen ser **jefe del contrato de esa fila** (o Admin) → 403 si no.

**Frontend** (`formulario-horas-frontend`):
- `/aprobaciones` (JefeContrato): tarjeta por operario+fecha; filas accionables con
  Aprobar / Desaprobar (motivo en diálogo); filas de otro contrato en gris (contexto).
- `/novedades` (Supervisor): lista + form Nueva novedad (operario ≥3, tipo, fechas, justificación).
- `/ausencias` (HyS): bandeja por estadoHys (pendiente por defecto) + Aprobar/Desaprobar + filtro.
- Util pura `agruparPorOperarioFecha` (testeada). **49/49 tests, lint y build OK.**

**Para probar E2E en vivo falta seed de prueba** (reversible):
- Al menos 1 **tipo de novedad** en `sth_tipos_novedad` (para el form del Supervisor y que HyS tenga qué aprobar).
- Setear `jefeContratoCuil` de algún contrato (p. ej. K5) a un usuario JefeContrato para probar el scope
  (hoy solo el Admin ve la bandeja porque ningún contrato tiene jefe). Hay registros pendientes de prueba
  (ids ~11/12 en K5) para poblar `/aprobaciones` con el admin.

**Pendiente global:** rediseño visual (§16, tras Fase 3) y provisión de logins read-only de operarios.

---

## 18. Seed de prueba Fase 3 aplicado (2026-07-03)

Usuarios de prueba (todos los roles), password entre paréntesis:
- `admin@test.local` (admin1234) — Admin
- `jefecuadrilla@test.local` (jdc12345) — JefeCuadrilla (cuil 20169331708)
- `operario@test.local` (oper1234) — Operario (cuil 20163079845)
- `jefecontrato@test.local` (jfc12345) — JefeContrato (cuil 20407714076), **jefe de K5**
- `supervisor@test.local` (sup12345) — Supervisor (cuil 20349930618)
- `hys@test.local` (hys12345) — HyS (cuil 20252110470)

Otros: `sth_contratos` K5 (id 1) con `jefeContratoCuil` = jefecontrato. Tipos de novedad:
Ausencia (id 1, requiere HyS), Accidente (id 2, requiere HyS), Franco (id 3, no). Hay 1
novedad Ausencia pendiente y 2 registros de horas pendientes en K5 (para /aprobaciones).
Todo seed de prueba, reversible.

---

## 19. ADR-002 aplicado + rediseño visual (2026-07-03)

**ADR-002 (tareas múltiples por registro):** implementado de punta a punta.
- BD: dropeada `tarea_id` + su FK; creada `sth_registro_tareas` (M:N) con FKs (DDL a mano).
- Prisma: `RegistroTarea`; `RegistroHoras` sin `tarea`, con `tareas[]`.
- Backend: línea `{contratoId, horas, tareaIds[]}`, una línea por contrato (400 si repite),
  `createBatch`/`update`/`INCLUDE` con tareas M:N. Verificado por curl (8hs + [Excavación,Montaje]).
- Frontend: `LineasField` con multiselect de tareas por contrato (chips), contrato no repetible;
  tablas muestran las tareas como lista. Móviles de ejemplo seedeados (INT-101, INT-102, AB123CD).

**Rediseño visual (§16) aplicado — estilo "limpio y profesional":**
- Sistema: tokens de marca (sand/ink/gold/estados) mapeados a shadcn; fuentes Space Grotesk
  (display) + IBM Plex Sans (cuerpo) + IBM Plex Mono (datos); firma "pico" dorado.
- Shell sidebar (desktop) + drawer (mobile); primitivos `PageHeader` y `StatusBadge`.
- Rediseñadas: login, home, 403, reporte, mis-registros, aprobaciones, novedades, ausencias.
- 50/50 tests, lint y build OK. Ambos repos pusheados.

Datos de prueba para ver: hay 1 registro pendiente (K5, 8hs, tareas Excavación/Montaje) del
operario TORRES cargado por el JdC → visible en /aprobaciones (jefecontrato@test.local),
/mis-registros (operario@test.local) y "Cargas que hice" (jefecuadrilla@test.local).

---

## 20. Fase 4 COMPLETA (2026-07-04) — Panel Admin

Spec: `docs/superpowers/specs/2026-07-04-fase4-panel-admin-design.md`
Plan: `docs/superpowers/plans/2026-07-04-fase4-panel-admin.md`

**Backend:** `POST /admin/usuarios/masivo` (alta masiva de operarios): email por legajo
(`<legajo>@st.local`, fallback a cuil), contraseña aleatoria por usuario, saltea existentes,
devuelve credenciales. Verificado por curl.

**Frontend:** árbol `/admin/*` con sub-nav y guard de rol Admin:
- `/admin/usuarios` (lista + toggle activo + alta individual + **alta masiva** con tabla de credenciales),
- `/admin/contratos`, `/admin/tareas` (por contrato), `/admin/moviles`, `/admin/provincias`, `/admin/tipos-novedad`.
- Hooks en `lib/api/admin.ts`; componente `PillActivo`; feedback con toast.promise.
- **54/54 tests, lint y build OK.** Ambos repos pusheados.

**Con esto quedan las 4 fases completas.** Pendientes globales:
- ~~Edición completa de usuario (email/rol/contraseña)~~ ✅ **RESUELTO (2026-07-04)** — ver §21.
- Flujo de cambio de contraseña por el propio usuario (no hay backend).
- Vista SQL de liquidación (externo, a coordinar con sistemas).
- Deploy (Vercel + Railway/Render) y datos reales (contratos K2–K12, tareas, móviles, jefes).

---

## 21. Edición completa de usuario + fix hydration (2026-07-04)

Spec: `docs/superpowers/specs/2026-07-04-edicion-usuario-design.md`
Plan: `docs/superpowers/plans/2026-07-04-edicion-usuario.md`

**Fix hydration mismatch** (`SessionProvider`, frontend `src/lib/auth/session.tsx`):
`loading` se inicializa determinista (`true`, igual en server y cliente) y el `setState`
se resuelve en callbacks async del effect (flag `cancelado`), evitando el mismatch y el
error de lint `react-hooks/set-state-in-effect`.

**Edición completa de usuario** (era solo activar/desactivar):
- Backend (aditivo, sin schema): `GET /admin/usuarios` ahora expone `rolId` y los
  `contratoId` de cada contrato habilitado (para preseleccionar en el form). El endpoint
  `PATCH /admin/usuarios/:cuil` ya soportaba email/password/rolId/activo/contratosIds.
- Frontend: nuevo componente `UsuarioEditRow` (fila expandible inline) con form pre-cargado:
  email, rol, contratos habilitados (chips) y contraseña opcional (vacío = no cambia, ≥8).
  Envía solo los campos que cambiaron; Guardar deshabilitado si es inválido o sin cambios;
  Cancelar descarta. El toggle de activo (`PillActivo`) se mantiene, ahora pasado como prop.
- Verificación: **59/59 tests**, lint limpio, build OK. E2E por curl del PATCH (200 + persiste).
- Ejecutado con subagent-driven-development (3 tareas, review por tarea + review final de rama,
  sin hallazgos Critical/Important).

**Diferido (Minor del review, no bloqueante):** `updateUsuario` no es transaccional
(deleteMany+createMany+update sueltos) — considerar `$transaction` a futuro.

---

## 22. Purga de seed de prueba (2026-07-04)

⚠️ **Los usuarios y datos de prueba de las secciones §12, §15 y §18 YA NO EXISTEN.**
Se borraron (transacción, DML a mano vía Prisma) los 6 usuarios `@test.local`
(`admin`, `operario`, `jefecuadrilla`, `jefecontrato`, `supervisor`, `hys`) y **todos**
los datos transaccionales de prueba: 5 registros_horas (+ registro_moviles/tareas),
3 novedades, 5 auditorías, y los contratos_habilitados de esos usuarios. El contrato
`K5` quedó con `jefeContratoCuil = null`.

**Usuarios REALES vigentes en la BD (los únicos que quedan):**
- `rcarrazana@serytec.com` — **Admin** (CARRAZANA RODRIGO). Es el admin de referencia.
- `jteran@serytec.com` — Supervisor (AVILA TERAN JOSE).
- `ccazorla@serytec.com` — HyS (CAZORLA CLAUDIA).

No hay contraseñas de estos usuarios en este doc (las gestiona la empresa). Catálogos
(contratos, tareas, móviles, provincias, tipos de novedad) se conservaron.

---

## 23. Estado al cerrar (2026-07-05) — dónde retomar

**Ambos repos pusheados a `origin/main`:**
- Backend `Forms_Horas_ST_back` → `427d571`.
- Frontend `Forms_Horas_ST_Frontend` → `dd654a3`.

**Estado del código:** 4 fases + edición de usuario completas. 59/59 tests, lint y build OK.

**Estado de la BD (compartida `191.101.235.7`, base `testing`):** solo los 3 usuarios reales
`@serytec.com` (ver §22). Sin datos transaccionales (todo purgado). Catálogos intactos.
`K5` sin jefe asignado y los usuarios reales **sin contratos habilitados** todavía.

**Pendientes globales (para retomar):**
1. Datos reales: asignar `jefeContratoCuil` a los contratos (K5 quedó en null), habilitar
   contratos a los usuarios que cargan, y cargar catálogos reales (contratos K2–K12, tareas,
   móviles). Sin esto, los usuarios reales no pueden cargar ni aprobar por scope de contrato.
2. Provisión de logins de operarios (read-only) — alta masiva ya existe (§20).
3. Flujo de cambio de contraseña por el propio usuario (no hay backend).
4. Vista SQL de liquidación (coordinar con sistemas).
5. Deploy (Vercel frontend + Railway/Render backend).
6. Diferido (Minor): hacer transaccional `AdminService.updateUsuario` (§21).

**Nota operativa:** los servidores de dev (backend `npm run start:dev` :3001, frontend
`npm run dev` :3000) NO quedaron corriendo; relevantar al retomar para probar en navegador.

---

## 24. CRUD de maestros admin completado (2026-07-15)

Spec: `docs/superpowers/specs/2026-07-14-completar-crud-maestros-design.md`
Plan: `docs/superpowers/plans/2026-07-14-completar-crud-maestros.md`
Ejecutado con Subagent-Driven Development (10 tareas, implementador y revisor por tarea).
Rama: `feature/completar-crud-maestros` en ambos repos (mergeada a `main`).

**Backend** (4 tareas, todas con review clean): `PATCH /admin/tareas/:id`,
`PATCH /admin/moviles/:id`, `PATCH /admin/provincias/:id`,
`PATCH /admin/tipos-novedad/:id` — mismo patrón que `updateContrato` (DTO
`Update*Dto` con campos opcionales + `prisma.<modelo>.update()`). Los toggles
`.../activo` existentes quedaron intactos, sin tocar.

**Frontend** (5 tareas, todas con review clean): hooks `useEditarTarea`,
`useEditarMovil`, `useEditarProvincia`, `useEditarTipoNovedad` en
`lib/api/admin.ts`; componentes `TareaEditRow`, `MovilEditRow`,
`ProvinciaEditRow`, `TipoNovedadEditRow` (fila expandible inline, mismo
patrón que `UsuarioEditRow`) cableados en sus respectivas páginas
`/admin/*`.

**Con esto, los 6 maestros del panel Admin tienen CRUD completo**
(crear/listar/editar, + activar-desactivar donde aplica):

| Entidad | Crear | Listar | Editar | Activar/Desactivar |
|---|---|---|---|---|
| Contratos | ✅ | ✅ | ✅ | — (vía PATCH) |
| Usuarios | ✅ | ✅ | ✅ | — |
| Tareas | ✅ | ✅ | ✅ | ✅ |
| Móviles | ✅ | ✅ | ✅ | ✅ |
| Tipos de novedad | ✅ | ✅ | ✅ | ✅ |
| Provincias | ✅ | ✅ | ✅ | ❌ (decisión explícita — ver spec §1) |

**Decisión deliberada:** Provincia **no** suma columna `activo` — solo ganó
edición de `nombre`. Ningún maestro tiene hard delete (fuera de alcance en
todo el panel).

**Verificación:** frontend 80/80 tests, lint y build OK. Backend build OK.

---

## 25. Edición de Contratos (nombre + Jefe de Contrato) — bugfix (2026-07-16)

Spec: `docs/superpowers/specs/2026-07-16-edicion-contratos-jefe-design.md`
Plan: `docs/superpowers/plans/2026-07-16-edicion-contratos-jefe.md`
Ejecutado con Subagent-Driven Development (4 tareas, implementador y revisor por tarea, todas
con review clean). Rama: `feature/contratos-jefe` en ambos repos (mergeada a `main`).

**Bug encontrado por el usuario:** un Jefe de Cuadrilla cargó horas en un contrato, pero el Jefe
de Contrato de ese mismo contrato no veía nada pendiente en `/aprobaciones`. Root cause (via
`superpowers:systematic-debugging`, evidencia directa de la BD): **los 8 contratos tenían
`jefeContratoCuil = null`** — `GET /registros-horas/por-aprobar` filtra por
`{ jefeContratoCuil: usuario.cuil }`, así que sin ese dato ningún JefeContrato veía nada. Causa
raíz secundaria: `/admin/contratos` nunca tuvo forma de asignar el jefe desde la UI (el backend ya
lo soportaba desde antes, solo faltaba el frontend).

**Desbloqueo inmediato (manual, antes de esta feature):** se asignó por script directo contra la
BD a `mvega@serytec.com` (CUIL `27398878499`) como jefe de K9 y K10, para destrabar la prueba del
usuario mientras se implementaba la solución permanente.

**Backend** (1 tarea, review clean): `UpdateContratoDto.jefeContratoCuil` ahora acepta
`string | null` explícito (antes solo `string | undefined`) — permite **desasignar** un jefe. Sin
cambios de servicio/controller (Prisma ya acepta `null` para limpiar la FK nullable).

**Frontend** (3 tareas, review clean): `useEditarContrato` ampliado al mismo tipo; nuevo
`ContratoEditRow` (mismo patrón fila-expandible que `TareaEditRow`/`MovilEditRow`) con input de
nombre + `<select>` "Jefe de Contrato" (opción "Sin jefe asignado" → `null`, poblado con usuarios
`rol.nombre === 'JefeContrato'` filtrados client-side en la página); cableado en
`/admin/contratos`, reemplazando la fila plana que solo tenía crear + toggle activo.

**Verificación:** frontend 88/89 tests (1 falla preexistente y no relacionada — ver nota abajo),
lint y build OK. Backend build OK.

**Nota — test preexistente roto por el calendario (no de esta feature):**
`mis-registros-page.test.tsx` usa una fecha fija (`2026-07-05`, quincena 1) en su fixture, pero la
página filtra por la quincena de "hoy" por default. Al cruzar el 16 de julio (quincena 2), el test
empezó a fallar — confirmado que no tiene relación con esta feature (mismo resultado corriendo el
test aislado contra `main`). Queda como deuda preexistente a arreglar en otra sesión (el fixture
debería usar una fecha relativa a "hoy", no hardcodeada).

---

## 26. Filtro de usuarios + reset de contraseña (2026-07-15)

Spec: `docs/superpowers/specs/2026-07-15-filtro-usuarios-y-reset-password-design.md`
Plan: `docs/superpowers/plans/2026-07-15-filtro-usuarios-y-reset-password.md`
ADR: `docs/adr/2026-07-15-adr-003-password-reset-cuil.md`
Ejecutado con Subagent-Driven Development (5 tareas, implementador + revisor por tarea, todas
con review clean). Rama: `feature/admin-usuarios-filtro-reset` en ambos repos (basada en `main`,
**no** en la rama del PR del CRUD de maestros — son dos features independientes, sin mezclar).

**Motivación:** se hizo un alta masiva de usuarios y se perdieron las contraseñas generadas
(se cerró la pestaña antes de copiar la tabla de credenciales). Como las contraseñas se guardan
como hash `bcrypt` (irreversible), no había forma de recuperarlas.

**Backend** (2 tareas, review clean): `POST /admin/usuarios/:cuil/resetear-password` (nuevo,
setea `passwordHash = bcrypt.hash(cuil, 10)`); alta masiva (`createUsuariosMasivo`) ahora usa el
`cuil` como password en vez de un random de 10 caracteres (`generarPassword()` eliminado, sin
usos).

**Decisión de seguridad consciente (ADR-003):** la contraseña de un usuario (alta masiva y reset
individual) **es su propio CUIL**. El CUIL no es secreto (DNI, recibos de sueldo, compañeros lo
conocen) — riesgo aceptado explícitamente por el dueño del producto a cambio de simplicidad para
operarios de campo. Autoservicio "olvidé mi contraseña" queda **diferido** (no hay infraestructura
de email; la mayoría de los usuarios de alta masiva reciben `<legajo>@st.local`, no enviable).

**Frontend** (3 tareas, review clean): filtro 100% client-side en `/admin/usuarios` (texto por
nombre, accent/case-insensitive vía `\p{Diacritic}`, + chips de selección múltiple de rol,
combinados con "Y"); hook `useResetearPassword`; botón "Resetear contraseña" dentro del form
expandido de `UsuarioEditRow` con diálogo de confirmación — el diálogo vive a nivel de página
(`UsuariosAdminPage`), no dentro de la fila de tabla (evita HTML inválido), mismo patrón que
`DesaprobarDialog` en `/aprobaciones`.

**Verificación:** frontend 69/69 tests, lint y build OK. Backend build OK (sin suite de tests
automatizada, consistente con el resto del módulo Admin — verificación por curl documentada en
el plan, no ejecutada en esta sesión por falta de credenciales Admin reales).

**Minor findings del review (no bloqueantes, diferidos):**
- `UsuarioEditRow`/`MovilEditRow`/etc. no resincronizan estado local si la prop cambia de
  identidad con la fila abierta (patrón preexistente, ver §23/PR de maestros).
- En `usuarios-page.test.tsx`, la assertion de nombre/cuil en el diálogo usa `getAllByText(...)`
  en vez de discriminar por el diálogo (menos rigurosa) — cobertura real ya cubierta en el test
  unitario de `ResetearPasswordDialog`.

**Pendiente para cerrar esta rama:** review final de rama completa, luego merge/PR a `main` en
ambos repos. Checklist E2E manual del usuario (con Admin real) antes de mergear: filtro por
nombre/rol funciona en vivo; reset de contraseña de un usuario permite loguearse con el CUIL;
alta masiva muestra el CUIL como password en la tabla de credenciales.

---

## 27. Aprobación por carga + mejoras UX (mis registros, móviles, envío) — 2026-07-16

Spec: `docs/superpowers/specs/2026-07-16-carga-aprobacion-y-ux-reporte-design.md`
Plan: `docs/superpowers/plans/2026-07-16-carga-aprobacion-y-ux-reporte.md`
ADR: `docs/adr/2026-07-16-adr-004-aprobacion-por-carga.md`
Sesión de `grilling` + `domain-modeling` para el diseño, luego Subagent-Driven Development
(13 tareas, implementador + revisor por tarea, todas con review clean). Rama:
`feature/carga-aprobacion-ux` en ambos repos (basada en `main`, con todo lo previo ya mergeado).

**1) Aprobación por carga, no por fila individual.** Nueva columna `loteId` (UUID, `CHAR(36)
NOT NULL`) en `sth_registros_horas` — se asigna una sola vez por envío (individual o batch) y
queda igual en todas las filas que ese envío genera (ver ADR-004, que extiende el modelo N×M de
ADR-002). DDL aplicado a mano contra la BD compartida (backfill: cada fila de prueba existente
recibió su propio `loteId`, `total = distintos = 6`, sin nulos). `porAprobar()` agrupa por
`loteId` en vez de (operario, fecha). Nuevo endpoint `PATCH /registros-horas/lote/:loteId/resolver`
(`{ estado, ids?, motivoDesaprobacion? }`) — el conjunto autorizado se recalcula siempre
server-side por `jefeContratoCuil`, los `ids` del cliente solo pueden intersectarlo, nunca
ampliarlo (verificado con 5 escenarios de stress test en el review). Frontend:
`agruparPorLote`/`GrupoLote`, hook `useResolverLote`, componente `LoteCard` (botones grandes
"Aprobar todo"/"Desaprobar todo" que resuelven toda la carga de un click; "Ver detalle" despliega
checkboxes para excluir a alguien puntual antes de confirmar) cableado en `/aprobaciones`.

**2) Mis registros — total grande + tarjetas.** `RegistrosCards` reemplaza la tabla: total de la
quincena bien grande arriba, una tarjeta por **registro** (no por día, decisión explícita para
evitar ambigüedad de estado cuando un día tiene 2 líneas). Motivo de desaprobación visible en la
tarjeta (antes solo en tooltip, no funcional en celular). `RegistrosTabla` borrado (sin
consumidores).

**3) Selector de móviles.** `MovilesSelect` reemplaza los +15 botones tipo chip en `/reporte` por
un desplegable custom con checkbox por móvil (sin buscador de texto, para no requerir tipear en
el celular).

**4) Envío directo sin confirmación previa.** `/reporte`: "Reportar" envía directo y muestra
`CargandoModal` (spinner) mientras `crear.isPending`. Se sacó el modal de confirmación ("se
generarán N filas") y la barra inferior con el mismo dato — información técnica que no le servía
al Jefe de Cuadrilla que carga.

**Bug real encontrado durante la ejecución (no del código de producción, del propio plan):** los
tests de `LoteCard` usaban regex sin anclar (`/aprobar todo/i`), que matcheaba también "Desaprobar
todo" por substring (`"Desaprobar"` contiene `"aprobar"`). Corregido anclando con `^` en las 7
ocurrencias del plan (Tasks 7 y 8) antes de que el implementador siguiera. También se detectó (vía
review) que `agruparPorLote(data ?? [])` sin `useMemo` en `/aprobaciones` resetearía la selección
de checkboxes en cada render — corregido preventivamente en el plan antes de despachar la Task 8.

**Fix de deuda preexistente (Task 10):** `mis-registros-page.test.tsx` dependía de la quincena por
default (`quincenaDeFecha(new Date())`) con fechas de fixture hardcodeadas — ya había roto una vez
al cruzar un límite real de quincena (ver contexto de la sesión de `edición de contratos`). Ahora
selecciona la quincena explícitamente vía los controles de `QuincenaSelect`, determinístico sin
importar el día real. Verificado end-to-end por el reviewer, con grep independiente confirmando
`RegistrosTabla` sin referencias remanentes tras borrarlo.

**Verificación:** frontend 120/120 tests, lint y build OK. Backend build OK.

**Rama cerrada (2026-07-21):** mergeada a `main` (--no-ff) y pusheada en ambos repos
(backend `ec6e691`, frontend `c37b1ba`); rama `feature/carga-aprobacion-ux` eliminada local y
remota. Checklist E2E manual del usuario (post-merge, si no se hizo antes): carga masiva con
operarios en contrato propio + ajeno → una sola tarjeta de lote en `/aprobaciones`, "Aprobar todo"
resuelve solo el contrato propio; expandir y destildar a alguien deja esa fila pendiente; total y
tarjetas en `/mis-registros`; selector de móviles y envío directo en `/reporte`.

---

## 28. Aprobaciones agrupadas por contrato + observación por línea (2026-07-20/21)

PR #5 en ambos repos (`feature/aprobaciones-estado-y-observacion` backend, mergeado en
`5eae47b`; `feature/aprobaciones-resumen-por-contrato` frontend, mergeado en `9a7ca58`).

**Backend:** aprobaciones ahora exponen estado explícito por fila + jefes de contrato se leen
desde `Usuario` (rol `JefeContrato`), no de un campo suelto; observación por línea persistida.

**Frontend (rediseño grande de `/aprobaciones` y `/mis-registros`):** en vez de listado plano por
fila, resumen agrupado: por día → operarios → vehículos → total de horas, con detalle por
contrato debajo (`agrupar.ts`, `GrupoLote`/`GrupoContrato`). Pestañas Pendientes / Aprobados /
Rechazados. "Cargas que hice" (JdC) con el mismo agrupado. **Bug real encontrado y corregido**: el
total de horas por contrato sumaba las horas de cada fila duplicada por operario (una línea de
carga se guarda una vez por operario, ver ADR-002) — se corrigió para tomar el valor de una sola
fila no-desaprobada por (lote, contrato), no la suma de todas. También: el contador del bloque
amarillo de "Mis horas" debía contar **solo `estado === 'aprobado'`** (no pendiente) — corregido
tras aviso del usuario.

---

## 29. Corrección de horas por línea (ADR-006) + buscador de móviles + alta masiva de móviles
(2026-07-22)

PR #6 en ambos repos (`feature/aprobacion-correccion-horas`; backend mergeado en `09549a6`
sobre commit `404abde`, frontend en `2ebe4ca` sobre `2a51896`). Diseñado con `/grill-with-docs`.

**ADR-006** (`docs/adr/2026-07-22-adr-006-correccion-de-horas-por-linea.md`): el Jefe de Contrato,
tras auditar el GPS de una carga, puede corregir la hora declarada de una línea completa (todos
los operarios de ese contrato en ese lote). Decisión explícita: **no** se edita in-place — se
rechazan las filas viejas y se crean filas nuevas ya `aprobado` con la hora corregida, enlazadas
por `RegistroHoras.loteIdOrigen` al lote rechazado. Se evitó así tener que construir una UI que
lea `Auditoria` para mostrar el historial de cambios. Endpoint
`PATCH /registros-horas/lote/:loteId/corregir`.

**Frontend:** al principio se probó una versión "liviana" (texto enlazando la corrección a la
fila rechazada) — el usuario la rechazó ("no me convence, creo que deberíamos probar en 1 sola
tarjeta tener tanto el reporte desaprobado y la corrección") y se rehizo como una sola tarjeta
fusionada (`lib/correccion.ts` con `infoCorreccion()`, tarjetas `TarjetaSimple`/`TarjetaCorregida`
en `mis-registros`).

**Selector de móviles:** rehecho (segunda vez en la sesión — la primera versión se había perdido
en un merge) como buscador con autocompletar (Popover + Command de shadcn/cmdk) en vez de la
lista de chips fija, porque el catálogo real de móviles es grande. Alta masiva de móviles en
`/admin/moviles` (pegar texto/CSV separado por saltos de línea o comas, dedupe y trim para no
crear duplicados por espacios).

---

## 30. Novedades habilitadas por tipo para Jefe de Cuadrilla (ADR-007) (2026-07-23/24)

PR #7 en ambos repos (`feature/novedades-jefe-cuadrilla`; backend mergeado en `b5d7b3a` sobre
`b4c8b94`, frontend en `997e7a3` sobre `ef96f8f`). Diseñado con `/grill-with-docs`.

**ADR-007** (`docs/adr/2026-07-23-adr-007-tipos-de-novedad-habilitados-por-usuario.md`): hasta
ahora JefeCuadrilla no podía cargar novedades. Se le da esa capacidad, pero **acotada por tipo**:
nueva tabla `sth_tipos_novedad_habilitados` (M:N usuario↔tipo de novedad), mismo patrón que
`ContratoHabilitado`. Sin ningún tipo habilitado, no ve la opción de cargar. Supervisor/
JefeContrato/Admin siguen sin restricción (no se tocó su comportamiento).

**Frontend:** en el alta/edición de usuario, si el rol elegido es JefeCuadrilla aparece un
toggle "¿Carga novedades?" + chips para elegir qué tipos. `navForRole` cambió de firma
(`navForRole(rol)` → `navForRole(perfil)`) porque ahora la visibilidad de "Novedades" en el nav
depende de tener ≥1 tipo habilitado, no solo del rol — confirmado explícitamente por el usuario
("en el nav lateral solo aparecerá novedades si está habilitado para ello, sino debe estar
oculto"). El formulario de nueva novedad filtra el catálogo a los tipos habilitados cuando el
usuario es JefeCuadrilla.

**Nota de flujo de git de esta sesión:** en un momento se mezcló sin querer en una sola rama sin
commitear el trabajo de esta feature con el de la anterior (§29) — se resolvió partiendo los
archivos mixtos (`schema.prisma`, `glosario.md`, `domain.ts`, `lib/api/admin.ts`) a mano con Edit,
commiteando primero lo viejo (§29) y recién después esto.

---

## 31. Reporte diario 100% obligatorio + ocultar el rol en la UI (2026-07-24)

PR #8 solo frontend (`feature/reporte-obligatorio-y-ocultar-rol`, mergeado en `ddeffc7` sobre
`1d86178`). Sin cambios de backend. Diseñado con `/grill-with-docs`.

**Todo obligatorio en `/reporte`:** móviles, operarios, y cada línea (contrato/horas/tareas/
observación) pasan a ser requeridos. Antes, una línea incompleta se descartaba **en silencio** al
enviar (sin avisar); ahora el botón "Reportar" siempre está habilitado, pero al clickear con algo
incompleto marca en rojo cada campo faltante y no envía nada — decisión explícita del usuario
("si elijo un contrato y no pongo las horas, observaciones, o tareas, debería marcarme con rojo y
evitar el enviar datos incompletos"). Observación pasa de "(opcional)" a "(descripción de la
tarea)".

**Ocultar el rol en la UI:** el usuario pidió que no se muestre el nombre del rol en ningún lado
("admin, jefe de cuadrilla, jefe de contrato, etc."). Se sacó de 3 lugares dinámicos: pie de la
sidebar/drawer, eyebrow de Inicio, eyebrow de Novedades. **Se dejaron sin tocar**, a pedido
explícito, los eyebrows *fijos* de texto ("Admin" en las páginas de admin, "Jefe de contrato" en
Aprobaciones) — el pedido era sobre el nombre del rol dinámico, no sobre esos textos estáticos.

---

## 32. Limpieza de datos transaccionales de prueba (2026-07-26/27)

Antes de probar en el hosting real, se truncaron (vía script Node/Prisma puntual, luego borrado)
`sth_registros_horas`, `sth_registro_moviles`, `sth_registro_tareas`, `sth_auditoria` (usada
exclusivamente para `sth_registros_horas`, confirmado en código antes de vaciarla) y
`sth_novedades` — a pedido explícito del usuario, confirmando conteos antes de borrar. Los
maestros/permisos (`sth_usuarios`, `sth_roles`, `sth_contratos`, `sth_tareas_catalogo`,
`sth_moviles`, `sth_provincias`, `sth_tipos_novedad`, `sth_contratos_habilitados`,
`sth_tipos_novedad_habilitados`, `snuempleados`) quedaron intactos.

---

## 33. Deploy a producción: primero gratis, después VPS con dominio propio (2026-07-24 a 27)

**Paso 1 — gratis, para probar:** backend en **Render** (free tier, `npm install && npx prisma
generate && npm run build` / `npm run start:prod`), frontend en **Vercel** (import directo del
repo, `NEXT_PUBLIC_API_URL` apuntando a la URL de Render). Nota de troubleshooting real: el
primer login desde el celular fallaba porque el frontend se había buildeado en Vercel **antes**
de cargar `NEXT_PUBLIC_API_URL` (queda "horneada" en el bundle del cliente, no es runtime) — se
detectó bajando y grepeando los chunks JS de producción buscando `localhost:3001`, y se resolvió
con **Redeploy** después de cargar la env var. También: la organización de GitHub del repo
frontend no dejaba autorizar el GitHub App de Vercel por permisos — se resolvió pegando el link
del repo directo en el import de Vercel en vez de buscarlo en la lista.

**Paso 2 — VPS Hostinger propia (2026-07-27), para no depender de free tiers:**
- Plan **KVM 2** (2 vCPU / 8GB RAM), Ubuntu 24.04. IP y accesos: ver
  `docs/infraestructura-produccion.md` (gitignored a propósito, no se sube a GitHub — ahí están
  IP, comando SSH, dominio, rutas de Nginx/certificados, nombres de proceso PM2 y las env vars de
  producción).
- Acceso: par de claves SSH generado localmente (`~/.ssh/id_ed25519_hostinger_vps`), la pública
  cargada en el VPS al crearlo.
- Stack instalado a mano por SSH: Node 22 (NodeSource), git, Nginx, PM2, Certbot, ufw.
- Ambos repos clonados en `/var/www/`, backend y frontend corriendo como procesos PM2
  (`forms-horas-back` puerto 3001, `forms-horas-front` puerto 3000), `pm2 startup systemd` +
  `pm2 save` para que sobrevivan un reinicio.
- Dominio propio del usuario: `serytec.com.ar` (ya tiene una web ahí, administrada en Optimus
  Panel) → se usó el subdominio **`misregistros.serytec.com.ar`** (registro `A` a la IP del VPS)
  para no pisar la web existente.
- Nginx como reverse proxy en el puerto 80: `/` → frontend (3000), `/api/` → backend (3001, con
  rewrite que saca el prefijo `/api`) — así no hace falta mostrar puertos en la URL, sin esperar
  al dominio (funciona igual apuntando directo a la IP).
- SSL con Certbot (Let's Encrypt), redirect automático `http→https`, renovación automática.
  Certificado emitido para `misregistros.serytec.com.ar`, vence 2026-10-25.
- Firewall (ufw): solo 22/80/443 abiertos; 3000/3001 cerrados al exterior una vez que Nginx quedó
  andando.
- **Los deploys gratuitos de Vercel/Render quedaron levantados como posible respaldo** — no se
  dieron de baja, decisión pendiente del usuario.

**Documentación de infra:** se creó `docs/infraestructura-produccion.md` (backend), con **todo**
lo de arriba en detalle (IP, comandos de acceso, rutas de Nginx, env vars) — está en `.gitignore`
a propósito, nunca se sube a GitHub aunque viva en la carpeta del repo.

---

## 34. Usuarios "fuera de nómina" (ADR-008) — rama abierta, PRs sin mergear (2026-07-27)

Diseñado con `/grill-with-docs`. Rama `feature/usuarios-fuera-de-nomina` en ambos repos, **ya
pusheada pero todavía NO mergeada a `main`** (el usuario decidió seguir con la Fase 1 del
Liquidador antes de mergear esto — pendiente).

**Problema:** `Usuario.cuil` tenía una FK física obligatoria a `snuempleados.cuil`
(`sth_usuarios_cuil_fkey`), así que no se podía crear ningún usuario (de ningún rol) si su CUIL no
existía antes como empleado en `snuempleados`. Pero `snuempleados` se sincroniza automáticamente
desde un sistema externo (ERP/liquidador de sueldos) — el dueño o un socio gerente, sin relación
de dependencia, nunca iban a tener fila ahí.

**ADR-008** (`docs/adr/2026-07-27-adr-008-usuarios-fuera-de-nomina.md`): se eliminó la FK física
(DDL a mano: `ALTER TABLE sth_usuarios DROP FOREIGN KEY sth_usuarios_cuil_fkey`).
`Usuario.cuil` se mantiene como identidad (un CUIL es un dato personal, lo tiene cualquiera sea o
no empleado — no hace falta un esquema de IDs paralelo). Se agregó `Usuario.nombreFueraNomina`
(nullable), usado como nombre para mostrar cuando no hay `snuempleados` real vinculado. El join
`Usuario`↔`snuempleados` dejó de ser una relación Prisma con FK y pasa a resolverse a mano en el
código (`auth.service.ts#perfil`, `admin.service.ts#getUsuarios`), con fallback a
`nombreFueraNomina`.

**Frontend:** en "Nuevo usuario" (panel Admin), toggle "En nómina" / "Fuera de nómina" — con
nómina se mantiene el buscador de empleados de siempre; fuera de nómina se cargan a mano Nombre,
Apellido y CUIL. Disponible para **cualquier rol**, no solo Admin (el usuario lo aclaró
explícitamente: quiere poder cargar cualquier combinación de nombre/apellido/cuil/rol/email/
contraseña). `EmpleadoResumen.legajo`/`cargo` pasan a nullable en el tipo (siguen sin mostrarse en
ningún lado, así que no hay impacto visual).

**Verificado en navegador por el usuario:** alta de usuario fuera de nómina + login con ese
usuario, funcionando.

---

## 35. Rol Liquidador (ADR-009) — Fase 1 en curso, rama abierta (2026-07-28)

Diseñado con `/grill-with-docs` (interview larga, muchas decisiones de dominio reales). Rama
`feature/rol-liquidador` en ambos repos, creada desde `main` **sin** el ADR-008 (§34) todavía
adentro — son dos features independientes en ramas separadas, ninguna mergeada a `main` todavía.
Plan en 3 fases; **Fase 1 (catálogos, sin cálculo) ya implementada y verificada en local**,
Fases 2 (motor de cálculo) y 3 (por tantos/km) quedan para después.

**Por qué hace falta un catálogo propio:** se investigó si `snuempleados.jornal`/`categoria`
alcanzaban para modelar régimen/tarifa y **no alcanzan** — `jornal` es binario (`S`/`N`, no
distingue los 3 regímenes) e `importe_categoria` está en `0` para la mayoría de las categorías
(dato externo incompleto, fuera de nuestro control).

**Modelo (ADR-009,** `docs/adr/2026-07-28-adr-009-rol-liquidador-y-motor-de-liquidacion.md`**):**
- **`PerfilLiquidacion`** — 1:1 con `snuempleados.cuil` (no con `Usuario`: la mayoría de los
  empleados no tiene login), no `snuempleados` mismos: régimen (`jornalizado` / `fijo` /
  `por_tantos`) + categoría UOCRA (nullable) + modalidad de hora extra (nullable). Un empleado
  **sin** perfil asignado (ej. administrativos) no aparece en el panel — exclusión **por
  omisión**, no por un campo "es administrativo" derivado de texto externo.
- Patrón recurrente **"tarifa vigente por mes"**: `TarifaCategoriaUocra`, `MontoNovedadPlus`,
  `RangoKmPorTantos` — cada una versionada por `vigenteDesde`, se toma la fila más reciente ≤ la
  fecha de la quincena liquidada.
- **Horas extras:** umbral 88hs/quincena (jornalizado), multiplicador **fijo en 1.5** (no
  versionado — se había armado por error una tabla `IndiceHoraExtra` versionada y se sacó
  cuando el usuario aclaró que el multiplicador nunca cambia).
- **Modalidad de hora extra** (`en_b` / `con_descuentos`): dato fijo por empleado, independiente
  del régimen — algunos cobran las extras en B (sin descuentos), otros como parte del sueldo
  formal (con descuentos).
- **Sueldo básico:** `tarifaCategoria × min(horasQuincena, 88)` (jornalizado) o
  `tarifaCategoria × 88` fijo (régimen fijo, que usualmente ni declara horas).
- **Presentismo:** 20% del sueldo básico. Se pierde con una Ausencia **desaprobada** por HyS
  (certificado inválido/inasistencia injustificada — una Ausencia **aprobada** no lo afecta) o
  con una **Suspensión** (tipo de novedad nuevo, disciplinario, sin requerir aprobación de HyS a
  diferencia de Ausencia).
- **"Por tantos"** (hoy solo relevamiento de fugas, por km): la cantidad de km **la carga el
  Liquidador a mano** al momento de liquidar (se mide en otra app externa, no en esta, no se
  deriva de `sth_registro_tareas`). Se paga **todo** el total al precio del rango en que cae (3
  rangos, no progresivo).

**Implementado en Fase 1:**
- Rol **Liquidador** + `TipoNovedad` **Suspensión** (seed).
- Tablas nuevas: `sth_perfiles_liquidacion`, `sth_categorias_uocra`,
  `sth_tarifas_categoria_uocra`, `sth_montos_novedad_plus`, `sth_rangos_km_por_tantos` (DDL a
  mano, mismas convenciones de charset que el resto — `sth_perfiles_liquidacion.cuil` en
  `utf8mb3_general_ci` para poder tener FK a `snuempleados.cuil`).
- Backend: módulo `src/liquidacion/` completo (`@Roles('Admin', 'Liquidador')`); se amplió
  también `GET /admin/tipos-novedad` a `@Roles('Admin', 'Liquidador')` a nivel de método (el
  Liquidador necesita leer el catálogo para asignar montos a los tipos con `generaPlus`).
- Frontend: nav "Liquidación" (visible a Liquidador y Admin); layout con sub-nav propio
  (`liquidacion-nav.ts`, mismo patrón que `admin-nav.ts`); páginas `/liquidacion/categorias`
  (categorías UOCRA + su tarifa vigente), `/liquidacion/perfiles` (asignar régimen + categoría +
  modalidad de hora extra por empleado, reusa `OperariosSelect`), `/liquidacion/novedades-plus`
  (montos por tipo de novedad con `generaPlus`), `/liquidacion/por-tantos` (rangos de km).
- **Bug de entorno detectado y corregido durante la verificación:** el backend local (`nest start
  --watch`) no levantaba las rutas nuevas porque un proceso **viejo** (`node dist/src/main`,
  quedado de cuando se probó el deploy a la VPS) estaba ocupando el puerto 3001 y bloqueando al
  proceso de desarrollo real — se mató el proceso viejo y se reinició `npm run start:dev` limpio.

**Verificación:** backend `tsc --noEmit` limpio, todas las rutas de `/liquidacion/*` confirmadas
por log de arranque de Nest; frontend 185/185 tests (incluye test nuevo de
`perfiles-page.test.tsx`), `tsc --noEmit` limpio.

**Pendiente para retomar:**
1. Probar en el navegador (asignarse el rol Liquidador desde Admin → Usuarios, entrar y probar las
   4 pantallas) — el usuario todavía no confirmó el checklist E2E manual de esta fase.
2. Mergear (en orden a decidir con el usuario) `feature/usuarios-fuera-de-nomina` (§34) y
   `feature/rol-liquidador` (esta sección) a `main` en ambos repos — ninguna de las dos está
   mergeada todavía.
3. Fase 2 del Liquidador: motor de cálculo real (sueldo básico + extras + presentismo + plus de
   novedades) y el panel que muestre el total por empleado/quincena (hoy Fase 1 solo tiene los
   catálogos, sin ningún cálculo).
4. Fase 3 del Liquidador: régimen "por tantos" — pantalla para que el Liquidador cargue los km de
   cada relevador por quincena y vea el cálculo por rango.
5. Decidir si se dan de baja los deploys gratuitos de Vercel/Render (§33) ahora que la VPS con
   dominio propio está funcionando, o se dejan como respaldo.
