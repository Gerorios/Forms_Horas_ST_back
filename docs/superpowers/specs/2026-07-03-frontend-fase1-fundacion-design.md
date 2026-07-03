# Frontend — Fase 1: Fundación (Design)

**Fecha:** 2026-07-03
**Proyecto:** App de Registro de Horas (ver `Backend/.claude/Contexto/contexto-proyecto.md`)
**Alcance:** Solo Fase 1 (Fundación). Las pantallas de negocio (carga masiva, aprobaciones, novedades, admin) son Fases 2–4.

---

## 1. Objetivo

Dejar el frontend **Next.js (App Router)** andando, con:
- login real contra el backend NestJS (`http://localhost:3001`),
- sesión JWT con expiración de 1 hora manejada con re-login limpio,
- layout protegido cuya navegación se arma según el rol del usuario,
- el sistema de diseño de marca (paleta del logo tucán).

Sin pantallas de negocio: solo el esqueleto verificable end-to-end (login → home placeholder por rol → logout).

## 2. Stack

- **Next.js (App Router) + TypeScript** en `Frontend/`.
- **Tailwind CSS** con tokens de marca.
- **shadcn/ui**: se inicializa en **Fase 2**, cuando se use el primer componente real (multiselect, tabla, dialog). En Fase 1 no se usa ningún componente de shadcn, así que no se inicializa todavía (evita tocar `globals.css` sin uso).
- **TanStack Query** para estado de servidor.
- **Axios** con interceptores (Bearer + 401).
- **React Hook Form + Zod** (instalados; en Fase 1 solo el form de login).

## 3. Sistema de diseño (marca)

Tokens Tailwind (muestreados del logo):

| Token | Hex | Uso |
|-------|-----|-----|
| `brand` | `#ECB332` | Acento primario, botones primarios. **Cálido, NO es alerta.** |
| `neutral` | `#7C8081` | Texto secundario, bordes, superficies. |
| `background` | `#FFFFFF` | Fondo. |
| `alert` | `#E4572E` (naranja/rojo) | Alertas (ej. aviso >16 hs). **Distinto del dorado de marca.** |

- Logo: `Frontend/public/logo.png` (tucán en círculo, 570×726).
- Prioridad: web intuitiva, clara y rápida; buena en móvil (uso en campo desde el browser, sin PWA ni offline).

## 4. Autenticación y sesión

**Flujo de login:**
1. `POST /auth/login` con `{ email, password }` → `{ access_token }`.
2. Guardar `access_token` en **`localStorage`**.
3. `GET /auth/perfil` (con Bearer) → `{ cuil, email, activo, rol.nombre, empleado{...}, contratosHabilitados[] }`.
4. Guardar el perfil en un **Context de sesión** (`SessionProvider`).

**Cliente Axios (`lib/api/client.ts`):**
- `baseURL` desde `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`).
- Interceptor de request: adjunta `Authorization: Bearer <token>` si existe.
- Interceptor de response: ante `401`, limpia `localStorage` + estado de sesión y redirige a `/login` (re-login limpio ante expiración de 1 h).

**Notas de compatibilidad con el backend:**
- El backend firma el JWT a **8 h** hoy; bajarlo a 1 h es un gap de backend (§9 del contexto). El frontend igual maneja el 401 cuando expire, sea cual sea el TTL.
- `LoginDto` del backend valida `@IsEmail()`. El login usa emails ficticios pero con formato de email válido (los crea el Admin). El form de login valida formato email con Zod para reflejar el backend.

## 5. Rutas y protección

Estructura App Router:

```
Frontend/src/
  app/
    login/page.tsx            # público
    (protected)/
      layout.tsx              # guard: sin token → /login
      page.tsx                # home placeholder por rol
    403/page.tsx              # rol sin permiso
    layout.tsx                # root: providers (Query, Session)
  lib/
    api/client.ts             # axios + interceptores
    api/auth.ts               # login(), perfil()
    auth/session.tsx          # SessionProvider + useSession
    auth/guards.ts            # helpers de permiso por rol
  components/
    ui/                       # shadcn
    layout/app-shell.tsx      # header (logo + usuario + logout) + nav por rol
    layout/nav.ts             # definición de items de nav por rol
  types/domain.ts             # Rol, Perfil, etc.
```

**Guard de rutas:**
- `(protected)/layout.tsx`: si no hay token/sesión → redirige a `/login`.
- Navegación y acceso por rol según la matriz de permisos (sección 6). Un rol sin permiso a una ruta → `/403`.
- El backend es la autoridad final; el front solo mejora UX y evita llamadas inútiles.

## 6. Roles y navegación (para armar el menú)

Roles del backend: `Operario`, `JefeContrato`, `Supervisor`, `HyS`, `Admin`.
(**`JefeCuadrilla` no existe** — decisión 2026-07-02; todos los que cargan son `Operario`.)

En Fase 1 la nav apunta a **placeholders**; las pantallas reales llegan en Fases 2–4. Los ítems visibles por rol:

| Rol | Ítems de nav (placeholder en Fase 1) |
|-----|--------------------------------------|
| **Operario** | Carga masiva · Mis registros |
| **JefeContrato** | Carga masiva · Mis registros · Aprobaciones |
| **Supervisor** | Novedades |
| **HyS** | Ausencias (aprobar) |
| **Admin** | Admin (catálogos, usuarios, contratos, tipos de novedad, móviles) |

## 7. Home placeholder por rol

`(protected)/page.tsx` muestra el nombre del empleado, su rol, y tarjetas/accesos a los ítems que le corresponden (que por ahora llevan a páginas placeholder "En construcción"). Sirve para verificar el flujo completo login → sesión → nav por rol → logout.

## 8. Manejo de errores

- Login fallido (401): mensaje "Credenciales inválidas" en el form.
- Error de red / backend caído: toast con mensaje claro y opción de reintentar (TanStack Query maneja el retry).
- 401 en cualquier request autenticada: re-login limpio (ver sección 4).
- Errores de validación de formulario: inline con Zod + React Hook Form.

## 9. Verificación (end-to-end de la Fase 1)

1. `npm run dev` levanta el frontend y conecta al backend en `:3001`.
2. Login con un usuario real de la BD → redirige al home.
3. El home muestra el rol correcto y solo los ítems de nav de ese rol.
4. Refrescar la página mantiene la sesión (token en `localStorage`).
5. Forzar expiración/401 → redirige a `/login` limpio.
6. Logout → limpia token y vuelve a `/login`.

## 10. Fuera de alcance (Fase 1)

- Formulario de carga masiva y su expansión N×M (Fase 2).
- Mis registros / historial / quincena (Fase 2).
- Aprobaciones, novedades, ausencias (Fase 3).
- Panel Admin (Fase 4).
- Gaps de backend (endpoint batch N×M, `PATCH /registros-horas/:id`, colapsar rol, migración/seeds, bajar JWT a 1 h) — se abordan cuando habiliten cada fase.
