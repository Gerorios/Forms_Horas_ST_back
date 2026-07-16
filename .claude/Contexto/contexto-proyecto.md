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
