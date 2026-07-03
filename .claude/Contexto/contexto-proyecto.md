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

> **DECISIÓN (2026-07-02): el rol "Jefe de Cuadrilla" NO existe.** No hay jefes de
> cuadrilla fijos: un día carga uno, otro día carga otro. Todos son **Operario**.
> Cualquier operario con login puede hacer la carga masiva. Se colapsa
> `JefeCuadrilla` → `Operario` en el backend (roles y `@Roles(...)`).

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
