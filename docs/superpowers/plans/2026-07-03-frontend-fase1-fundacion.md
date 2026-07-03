# Frontend Fase 1 (Fundación) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar el frontend Next.js del sistema de Registro de Horas andando con login real, sesión JWT con manejo de expiración, y layout protegido cuya navegación se arma según el rol — sin pantallas de negocio.

**Architecture:** SPA-like sobre Next.js App Router. La sesión (token + perfil) vive en un React Context, con el token persistido en `localStorage`. Un cliente Axios centraliza el `baseURL` y dos interceptores (adjuntar Bearer; ante 401 limpiar sesión y mandar a `/login`). Las rutas privadas cuelgan de un grupo `(protected)` con un guard en su `layout.tsx`. La navegación se deriva del rol del perfil mediante una función pura y testeable.

**Tech Stack:** Next.js 15 (App Router) + TypeScript, Tailwind CSS v4, shadcn/ui, TanStack Query v5, Axios, React Hook Form + Zod, Vitest + React Testing Library.

## Global Constraints

- Directorio del frontend: `Frontend/` (hermano de `Backend/`). Todos los paths de este plan son relativos a `Frontend/` salvo que se indique otra cosa.
- Backend API: `http://localhost:3001` (configurable vía `NEXT_PUBLIC_API_URL`).
- Token JWT guardado en `localStorage` bajo la clave `sth_token`.
- Roles válidos del backend: `Operario`, `JefeContrato`, `Supervisor`, `HyS`, `Admin`. **`JefeCuadrilla` NO existe** (todos los que cargan son `Operario`).
- Paleta de marca (tokens Tailwind): `brand=#ECB332` (cálido, NO alerta), `neutral=#7C8081`, `background=#FFFFFF`, `alert=#E4572E` (para avisos, distinto del dorado).
- Logo: `public/logo.png`.
- `npm` como gestor (npm 10.9, Node 22). `strict-ssl=false` ya está en la config global.
- El backend firma JWT a 8 h hoy; el frontend maneja el 401 igual, sea cual sea el TTL.
- Spec de referencia: `Backend/docs/superpowers/specs/2026-07-03-frontend-fase1-fundacion-design.md`.

---

### Task 1: Scaffold Next.js + Vitest

**Files:**
- Create: todo el árbol base de Next.js dentro de `Frontend/` (via `create-next-app`)
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Modify: `package.json` (script `test`)
- Modify: `.gitignore` (lo genera create-next-app; verificar que ignora `node_modules`, `.next`)

**Interfaces:**
- Produces: proyecto Next.js ejecutable (`npm run dev`), alias de imports `@/*` → `src/*`, y runner de tests Vitest (`npm test`).

- [ ] **Step 1: Preservar el logo y scaffoldear**

`create-next-app` exige un directorio vacío. Movemos el logo, scaffoldeamos y lo restauramos.

```bash
cd "Frontend"
mv public/logo.png ../logo.png.bak
npx --yes create-next-app@latest . --typescript --tailwind --app --eslint --src-dir --import-alias "@/*" --no-turbopack --use-npm
mkdir -p public
mv ../logo.png.bak public/logo.png
```

Si `create-next-app` pregunta algo pese a los flags, aceptar los defaults.

- [ ] **Step 2: Verificar que el dev server levanta**

Run: `npm run dev` (dejarlo unos segundos y cortar con Ctrl+C)
Expected: `Ready` / `Local: http://localhost:3000` sin errores de compilación.

- [ ] **Step 3: Instalar Vitest y librerías de testing**

```bash
npm install --save-dev vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 4: Crear `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
```

- [ ] **Step 5: Crear `vitest.setup.ts`**

```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 6: Agregar script `test` a `package.json`**

En el objeto `"scripts"`, agregar:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 7: Smoke test del runner**

Create: `src/lib/smoke.test.ts`

```typescript
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('el runner de tests funciona', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 8: Borrar el smoke test y commitear**

```bash
rm src/lib/smoke.test.ts
git add Frontend/
git commit -m "chore: scaffold Next.js frontend + Vitest"
```

---

### Task 2: Tokens de marca (Tailwind v4)

**Files:**
- Modify: `src/app/globals.css` (agregar tokens `@theme`)
- Modify: `src/app/page.tsx` (reemplazar por un placeholder mínimo que use un token de marca)

**Interfaces:**
- Produces: clases utilitarias de Tailwind `bg-brand`, `text-brand`, `bg-neutral`, `text-neutral`, `bg-alert`, `text-alert` disponibles en toda la app.

- [ ] **Step 1: Definir los tokens en `globals.css`**

Debajo del `@import "tailwindcss";` existente, agregar el bloque `@theme`:

```css
@theme {
  --color-brand: #ecb332;
  --color-neutral: #7c8081;
  --color-alert: #e4572e;
  --color-background: #ffffff;
}
```

- [ ] **Step 2: Placeholder que use la marca en `src/app/page.tsx`**

Reemplazar el contenido completo por:

```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-2xl font-semibold text-brand">Registro de Horas</h1>
    </main>
  );
}
```

- [ ] **Step 3: Verificar visualmente**

Run: `npm run dev` y abrir `http://localhost:3000`
Expected: el título "Registro de Horas" en color dorado (`#ECB332`). Cortar el server.

- [ ] **Step 4: Commit**

```bash
git add Frontend/src/app/globals.css Frontend/src/app/page.tsx
git commit -m "feat: tokens de marca en Tailwind (brand/neutral/alert)"
```

---

### Task 3: Dependencias base, tipos de dominio y cliente Axios

**Files:**
- Create: `src/types/domain.ts`
- Create: `src/lib/api/client.ts`
- Create: `src/lib/api/token.ts`
- Test: `src/lib/api/client.test.ts`
- Create: `.env.local`

**Interfaces:**
- Consumes: nada de tasks previas.
- Produces:
  - `token.ts`: `getToken(): string | null`, `setToken(t: string): void`, `clearToken(): void` (clave `sth_token` en `localStorage`).
  - `client.ts`: `api` (instancia Axios con `baseURL` de `NEXT_PUBLIC_API_URL`), interceptor de request que adjunta `Authorization: Bearer <token>`, interceptor de response que ante 401 llama `clearToken()` y redirige a `/login`.
  - `domain.ts`: tipos `Rol`, `ContratoResumen`, `EmpleadoResumen`, `Perfil`, `LoginResponse`.

- [ ] **Step 1: Instalar dependencias de runtime**

```bash
cd "Frontend"
npm install axios @tanstack/react-query react-hook-form zod @hookform/resolvers
```

- [ ] **Step 2: Crear `.env.local`**

```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

- [ ] **Step 3: Crear `src/types/domain.ts`**

```typescript
export type Rol = 'Operario' | 'JefeContrato' | 'Supervisor' | 'HyS' | 'Admin';

export interface ContratoResumen {
  id: number;
  codigo: string;
  nombre: string;
}

export interface EmpleadoResumen {
  apellido_nombre: string;
  legajo: number;
  cargo: string;
}

export interface Perfil {
  cuil: string;
  email: string;
  activo: boolean;
  rol: { nombre: Rol };
  empleado: EmpleadoResumen;
  contratosHabilitados: { contrato: ContratoResumen }[];
}

export interface LoginResponse {
  access_token: string;
}
```

- [ ] **Step 4: Crear `src/lib/api/token.ts`**

```typescript
const TOKEN_KEY = 'sth_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
}
```

- [ ] **Step 5: Escribir el test del cliente (falla primero)**

Create: `src/lib/api/client.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getToken, setToken, clearToken } from './token';

describe('token storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('setToken y getToken hacen round-trip', () => {
    setToken('abc123');
    expect(getToken()).toBe('abc123');
  });

  it('clearToken borra el token', () => {
    setToken('abc123');
    clearToken();
    expect(getToken()).toBeNull();
  });
});

describe('api client interceptors', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });
  afterEach(() => vi.restoreAllMocks());

  it('el interceptor de request adjunta el Bearer cuando hay token', async () => {
    setToken('tok-999');
    const { api } = await import('./client');
    const config = await (api.interceptors.request as any).handlers[0].fulfilled({
      headers: {},
    });
    expect(config.headers.Authorization).toBe('Bearer tok-999');
  });

  it('sin token, el interceptor no agrega Authorization', async () => {
    const { api } = await import('./client');
    const config = await (api.interceptors.request as any).handlers[0].fulfilled({
      headers: {},
    });
    expect(config.headers.Authorization).toBeUndefined();
  });
});
```

- [ ] **Step 6: Correr el test para verlo fallar**

Run: `npm test -- client`
Expected: FAIL — `Cannot find module './client'`.

- [ ] **Step 7: Implementar `src/lib/api/client.ts`**

```typescript
import axios from 'axios';
import { getToken, clearToken } from './token';

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      clearToken();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  },
);
```

- [ ] **Step 8: Correr los tests**

Run: `npm test -- client`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add Frontend/src/types Frontend/src/lib/api Frontend/.env.local Frontend/package.json Frontend/package-lock.json
git commit -m "feat: tipos de dominio + cliente Axios con interceptores Bearer/401"
```

---

### Task 4: API de auth y Context de sesión

**Files:**
- Create: `src/lib/api/auth.ts`
- Create: `src/lib/auth/session.tsx`
- Test: `src/lib/auth/session.test.tsx`

**Interfaces:**
- Consumes: `api` (client.ts), `setToken/clearToken/getToken` (token.ts), tipos `Perfil`, `LoginResponse` (domain.ts).
- Produces:
  - `auth.ts`: `login(email: string, password: string): Promise<LoginResponse>`, `fetchPerfil(): Promise<Perfil>`.
  - `session.tsx`: `SessionProvider` (componente), `useSession(): { perfil: Perfil | null; loading: boolean; signIn(email, password): Promise<void>; signOut(): void }`.

- [ ] **Step 1: Crear `src/lib/api/auth.ts`**

```typescript
import { api } from './client';
import type { LoginResponse, Perfil } from '@/types/domain';

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
  return data;
}

export async function fetchPerfil(): Promise<Perfil> {
  const { data } = await api.get<Perfil>('/auth/perfil');
  return data;
}
```

- [ ] **Step 2: Escribir el test del SessionProvider (falla primero)**

Create: `src/lib/auth/session.test.tsx`

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionProvider, useSession } from './session';
import * as authApi from '@/lib/api/auth';

const PERFIL_FAKE = {
  cuil: '20123456789',
  email: 'op@empresa.com',
  activo: true,
  rol: { nombre: 'Operario' as const },
  empleado: { apellido_nombre: 'PEREZ JUAN', legajo: 10, cargo: 'Oficial' },
  contratosHabilitados: [],
};

function Probe() {
  const { perfil, signIn, signOut } = useSession();
  return (
    <div>
      <span data-testid="nombre">{perfil?.empleado.apellido_nombre ?? 'sin-sesion'}</span>
      <button onClick={() => signIn('op@empresa.com', 'secret12')}>login</button>
      <button onClick={() => signOut()}>logout</button>
    </div>
  );
}

describe('SessionProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('signIn guarda token y carga el perfil', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({ access_token: 'tok-1' });
    vi.spyOn(authApi, 'fetchPerfil').mockResolvedValue(PERFIL_FAKE);

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    expect(screen.getByTestId('nombre')).toHaveTextContent('sin-sesion');
    await userEvent.click(screen.getByText('login'));

    await waitFor(() => expect(screen.getByTestId('nombre')).toHaveTextContent('PEREZ JUAN'));
    expect(window.localStorage.getItem('sth_token')).toBe('tok-1');
  });

  it('signOut limpia el perfil y el token', async () => {
    vi.spyOn(authApi, 'login').mockResolvedValue({ access_token: 'tok-1' });
    vi.spyOn(authApi, 'fetchPerfil').mockResolvedValue(PERFIL_FAKE);

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await userEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('nombre')).toHaveTextContent('PEREZ JUAN'));

    await userEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByTestId('nombre')).toHaveTextContent('sin-sesion'));
    expect(window.localStorage.getItem('sth_token')).toBeNull();
  });
});
```

- [ ] **Step 3: Correr el test para verlo fallar**

Run: `npm test -- session`
Expected: FAIL — `Cannot find module './session'`.

- [ ] **Step 4: Implementar `src/lib/auth/session.tsx`**

```tsx
'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Perfil } from '@/types/domain';
import { login as apiLogin, fetchPerfil } from '@/lib/api/auth';
import { getToken, setToken, clearToken } from '@/lib/api/token';

interface SessionValue {
  perfil: Perfil | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Al montar: si hay token, intentar recuperar el perfil.
    if (!getToken()) {
      setLoading(false);
      return;
    }
    fetchPerfil()
      .then(setPerfil)
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  async function signIn(email: string, password: string) {
    const { access_token } = await apiLogin(email, password);
    setToken(access_token);
    const p = await fetchPerfil();
    setPerfil(p);
  }

  function signOut() {
    clearToken();
    setPerfil(null);
  }

  return (
    <SessionContext.Provider value={{ perfil, loading, signIn, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession debe usarse dentro de <SessionProvider>');
  return ctx;
}
```

- [ ] **Step 5: Correr los tests**

Run: `npm test -- session`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add Frontend/src/lib/api/auth.ts Frontend/src/lib/auth/session.tsx Frontend/src/lib/auth/session.test.tsx
git commit -m "feat: API de auth (login/perfil) + Context de sesion"
```

---

### Task 5: Navegación por rol (función pura) + guards

**Files:**
- Create: `src/components/layout/nav.ts`
- Create: `src/lib/auth/guards.ts`
- Test: `src/components/layout/nav.test.ts`

**Interfaces:**
- Consumes: tipo `Rol` (domain.ts).
- Produces:
  - `nav.ts`: `NavItem = { label: string; href: string; roles: Rol[] }`, `NAV_ITEMS: NavItem[]`, `navForRole(rol: Rol): NavItem[]`.
  - `guards.ts`: `canAccess(rol: Rol, href: string): boolean`.

- [ ] **Step 1: Escribir el test de navegación (falla primero)**

Create: `src/components/layout/nav.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { navForRole } from './nav';
import { canAccess } from '@/lib/auth/guards';

describe('navForRole', () => {
  it('Operario ve Carga masiva y Mis registros, no Admin', () => {
    const hrefs = navForRole('Operario').map((i) => i.href);
    expect(hrefs).toContain('/carga');
    expect(hrefs).toContain('/mis-registros');
    expect(hrefs).not.toContain('/admin');
  });

  it('JefeContrato ve Aprobaciones', () => {
    const hrefs = navForRole('JefeContrato').map((i) => i.href);
    expect(hrefs).toContain('/aprobaciones');
  });

  it('HyS solo ve Ausencias', () => {
    const hrefs = navForRole('HyS').map((i) => i.href);
    expect(hrefs).toEqual(['/ausencias']);
  });

  it('Admin ve el panel Admin', () => {
    const hrefs = navForRole('Admin').map((i) => i.href);
    expect(hrefs).toContain('/admin');
  });
});

describe('canAccess', () => {
  it('Operario no puede entrar a /admin', () => {
    expect(canAccess('Operario', '/admin')).toBe(false);
  });
  it('Admin puede entrar a /admin', () => {
    expect(canAccess('Admin', '/admin')).toBe(true);
  });
  it('rutas fuera del catálogo son accesibles (ej. home)', () => {
    expect(canAccess('Operario', '/')).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npm test -- nav`
Expected: FAIL — `Cannot find module './nav'`.

- [ ] **Step 3: Implementar `src/components/layout/nav.ts`**

```typescript
import type { Rol } from '@/types/domain';

export interface NavItem {
  label: string;
  href: string;
  roles: Rol[];
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Carga masiva', href: '/carga', roles: ['Operario', 'JefeContrato'] },
  { label: 'Mis registros', href: '/mis-registros', roles: ['Operario', 'JefeContrato'] },
  { label: 'Aprobaciones', href: '/aprobaciones', roles: ['JefeContrato'] },
  { label: 'Novedades', href: '/novedades', roles: ['Supervisor'] },
  { label: 'Ausencias', href: '/ausencias', roles: ['HyS'] },
  { label: 'Admin', href: '/admin', roles: ['Admin'] },
];

export function navForRole(rol: Rol): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(rol));
}
```

- [ ] **Step 4: Implementar `src/lib/auth/guards.ts`**

```typescript
import type { Rol } from '@/types/domain';
import { NAV_ITEMS } from '@/components/layout/nav';

export function canAccess(rol: Rol, href: string): boolean {
  const item = NAV_ITEMS.find((i) => i.href === href);
  if (!item) return true; // rutas sin restricción explícita (home, etc.)
  return item.roles.includes(rol);
}
```

- [ ] **Step 5: Correr los tests**

Run: `npm test -- nav`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add Frontend/src/components/layout/nav.ts Frontend/src/lib/auth/guards.ts Frontend/src/components/layout/nav.test.ts
git commit -m "feat: navegacion por rol + guard canAccess"
```

---

### Task 6: Providers globales (Query + Session) en el root layout

**Files:**
- Create: `src/components/providers.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `SessionProvider` (session.tsx).
- Produces: `Providers` — envuelve la app con `QueryClientProvider` + `SessionProvider`.

- [ ] **Step 1: Crear `src/components/providers.tsx`**

```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { SessionProvider } from '@/lib/auth/session';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 2: Envolver el árbol en `src/app/layout.tsx`**

En `src/app/layout.tsx`, importar `Providers` y envolver `{children}` dentro del `<body>`:

```tsx
import { Providers } from '@/components/providers';
```

Y en el JSX, reemplazar `<body className={...}>{children}</body>` por:

```tsx
<body className={/* mantener las clases que generó create-next-app */ ''}>
  <Providers>{children}</Providers>
</body>
```

(Conservar las clases de fuente que create-next-app puso en `<body>`; solo envolver `{children}`.)

- [ ] **Step 3: Verificar que compila y los tests siguen verdes**

Run: `npm run build`
Expected: build exitoso sin errores de tipos.

Run: `npm test`
Expected: PASS (todos los tests previos).

- [ ] **Step 4: Commit**

```bash
git add Frontend/src/components/providers.tsx Frontend/src/app/layout.tsx
git commit -m "feat: providers globales (TanStack Query + Session)"
```

---

### Task 7: Página de login

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/lib/auth/login-schema.ts`
- Test: `src/app/login/login-page.test.tsx`

**Interfaces:**
- Consumes: `useSession().signIn` (session.tsx).
- Produces: ruta `/login` con formulario (email + password) validado con Zod; en éxito redirige a `/`.

- [ ] **Step 1: Crear el schema Zod `src/lib/auth/login-schema.ts`**

```typescript
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
});

export type LoginInput = z.infer<typeof loginSchema>;
```

- [ ] **Step 2: Escribir el test de la página de login (falla primero)**

Create: `src/app/login/login-page.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

const signInMock = vi.fn();
vi.mock('@/lib/auth/session', () => ({ useSession: () => ({ signIn: signInMock }) }));

import LoginPage from './page';

describe('LoginPage', () => {
  beforeEach(() => {
    pushMock.mockReset();
    signInMock.mockReset();
  });

  it('muestra error de validación con email inválido', async () => {
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/email/i), 'no-es-email');
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'secret12');
    await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));
    expect(await screen.findByText(/email inválido/i)).toBeInTheDocument();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it('con datos válidos llama signIn y redirige a /', async () => {
    signInMock.mockResolvedValue(undefined);
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/email/i), 'op@empresa.com');
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'secret12');
    await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));
    await waitFor(() => expect(signInMock).toHaveBeenCalledWith('op@empresa.com', 'secret12'));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/'));
  });

  it('muestra "Credenciales inválidas" si signIn rechaza', async () => {
    signInMock.mockRejectedValue(new Error('401'));
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/email/i), 'op@empresa.com');
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'secret12');
    await userEvent.click(screen.getByRole('button', { name: /ingresar/i }));
    expect(await screen.findByText(/credenciales inválidas/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Correr el test para verlo fallar**

Run: `npm test -- login-page`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 4: Implementar `src/app/login/page.tsx`**

```tsx
'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { loginSchema, type LoginInput } from '@/lib/auth/login-schema';
import { useSession } from '@/lib/auth/session';

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useSession();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginInput) {
    setErrorMsg(null);
    try {
      await signIn(values.email, values.password);
      router.push('/');
    } catch {
      setErrorMsg('Credenciales inválidas');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full max-w-sm space-y-4 rounded-lg border border-neutral/30 p-6"
      >
        <div className="flex justify-center">
          <Image src="/logo.png" alt="Logo" width={96} height={96} priority />
        </div>
        <h1 className="text-center text-xl font-semibold text-neutral">Registro de Horas</h1>

        <div className="space-y-1">
          <label htmlFor="email" className="block text-sm text-neutral">Email</label>
          <input
            id="email"
            type="email"
            className="w-full rounded border border-neutral/40 px-3 py-2"
            {...register('email')}
          />
          {errors.email && <p className="text-sm text-alert">{errors.email.message}</p>}
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="block text-sm text-neutral">Contraseña</label>
          <input
            id="password"
            type="password"
            className="w-full rounded border border-neutral/40 px-3 py-2"
            {...register('password')}
          />
          {errors.password && <p className="text-sm text-alert">{errors.password.message}</p>}
        </div>

        {errorMsg && <p className="text-sm text-alert">{errorMsg}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded bg-brand py-2 font-medium text-white disabled:opacity-60"
        >
          {isSubmitting ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Correr los tests**

Run: `npm test -- login-page`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add Frontend/src/app/login Frontend/src/lib/auth/login-schema.ts
git commit -m "feat: pagina de login con validacion Zod"
```

---

### Task 8: Layout protegido, app shell y home por rol

**Files:**
- Create: `src/app/(protected)/layout.tsx`
- Create: `src/components/layout/app-shell.tsx`
- Create: `src/app/(protected)/page.tsx`
- Create: `src/app/403/page.tsx`
- Delete: `src/app/page.tsx` (el placeholder de Task 2 — la home real vive en `(protected)`)

**Interfaces:**
- Consumes: `useSession` (session.tsx), `navForRole` (nav.ts).
- Produces: grupo de rutas `(protected)` con guard; `AppShell` (header con logo + usuario + logout + nav por rol); home `/` que lista accesos del rol; ruta `/403`.

- [ ] **Step 1: Mover la home al grupo protegido**

Borrar el placeholder de la raíz para que la home protegida tome `/`:

```bash
rm Frontend/src/app/page.tsx
```

- [ ] **Step 2: Crear el guard `src/app/(protected)/layout.tsx`**

```tsx
'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth/session';
import { AppShell } from '@/components/layout/app-shell';

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const { perfil, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !perfil) router.replace('/login');
  }, [loading, perfil, router]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-neutral">Cargando…</div>;
  }
  if (!perfil) return null; // redirigiendo

  return <AppShell>{children}</AppShell>;
}
```

- [ ] **Step 3: Crear `src/components/layout/app-shell.tsx`**

```tsx
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/auth/session';
import { navForRole } from '@/components/layout/nav';

export function AppShell({ children }: { children: ReactNode }) {
  const { perfil, signOut } = useSession();
  const router = useRouter();
  if (!perfil) return null;

  const items = navForRole(perfil.rol.nombre);

  function handleLogout() {
    signOut();
    router.replace('/login');
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-neutral/20 px-4 py-3">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Logo" width={36} height={36} />
          <nav className="hidden gap-4 sm:flex">
            {items.map((item) => (
              <Link key={item.href} href={item.href} className="text-sm text-neutral hover:text-brand">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral">{perfil.empleado.apellido_nombre}</span>
          <button onClick={handleLogout} className="text-sm text-alert hover:underline">
            Salir
          </button>
        </div>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Crear la home `src/app/(protected)/page.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { useSession } from '@/lib/auth/session';
import { navForRole } from '@/components/layout/nav';

export default function HomePage() {
  const { perfil } = useSession();
  if (!perfil) return null;

  const items = navForRole(perfil.rol.nombre);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-neutral">
          Hola, {perfil.empleado.apellido_nombre}
        </h1>
        <p className="text-sm text-neutral/70">Rol: {perfil.rol.nombre}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg border border-neutral/20 p-4 hover:border-brand"
          >
            <span className="font-medium text-neutral">{item.label}</span>
            <p className="text-xs text-neutral/60">En construcción</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Crear la ruta `src/app/403/page.tsx`**

```tsx
import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3">
      <h1 className="text-2xl font-semibold text-alert">Sin acceso</h1>
      <p className="text-neutral">No tenés permiso para ver esta sección.</p>
      <Link href="/" className="text-brand hover:underline">Volver al inicio</Link>
    </main>
  );
}
```

- [ ] **Step 6: Verificar build y tests**

Run: `npm run build`
Expected: build exitoso.

Run: `npm test`
Expected: PASS (todos los tests).

- [ ] **Step 7: Verificación manual end-to-end**

Con el backend corriendo (`http://localhost:3001`) y un usuario real en la BD:

```bash
npm run dev
```

Comprobar en el browser:
1. Ir a `/` sin sesión → redirige a `/login`.
2. Login con credenciales válidas → entra al home con el nombre y rol correctos.
3. La nav del header muestra solo los ítems del rol.
4. Refrescar la página mantiene la sesión.
5. "Salir" limpia la sesión y vuelve a `/login`.

- [ ] **Step 8: Commit**

```bash
git add Frontend/src/app Frontend/src/components/layout/app-shell.tsx
git commit -m "feat: layout protegido + app shell + home por rol + /403"
```

---

## Notas de cierre

- Al terminar la Fase 1, actualizar `Backend/.claude/Contexto/contexto-proyecto.md` §11 marcando la Fase 1 como completa y dejando apuntada la Fase 2 (carga masiva + mis registros) como próximo hito, junto con el recordatorio de gaps de backend (endpoint batch N×M, `PATCH /registros-horas/:id`, colapsar rol, migración/seeds, JWT a 1 h).
- La verificación de expiración de token (401 → `/login`) queda cubierta por el interceptor de Task 3; se validará de punta a punta recién cuando el backend baje el TTL o forzando un token vencido.
