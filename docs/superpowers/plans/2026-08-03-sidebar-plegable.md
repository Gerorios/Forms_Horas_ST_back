# Sidebar plegable a riel de íconos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En escritorio, el sidebar de 240px se puede plegar a un riel de íconos de 56px con un toggle persistente en localStorage.

**Architecture:** Los íconos viven en un módulo nuevo `nav-icons.tsx` (mapa href→SVG) para no tocar la lógica de `nav.ts`. `AppShell` agrega un estado `plegado` (inicializado desde localStorage), renderiza labels o íconos según el estado, y ajusta el padding del `main`. Móvil (top bar + drawer) no cambia.

**Tech Stack:** Next.js 16 (app router, client components), Tailwind, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-03-sidebar-plegable-design.md` (repo Backend)

## Global Constraints

- Repo de trabajo: **Frontend** (`C:\Users\Administrador\Desktop\SE Gero\Aplicaciones Web\Formulario_Horas\Frontend`). Este plan vive en Backend/docs.
- Rama: crear `feature/sidebar-plegable` desde `feature/modulo-combustible` (Task 1, Step 0) y trabajar ahí.
- SVGs inline estilo existente: `viewBox="0 0 20 20"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth` 1.6–1.75 (ver `app-shell.tsx:77-80`).
- Textos de UI en español (es-AR, voseo en mensajes si hiciera falta).
- Clave de localStorage: `sidebar-plegado`, valores `"1"` / `"0"`, default desplegado.
- Comandos: `npm run test` (vitest run), `npx tsc --noEmit` para typecheck. Correr desde la raíz del Frontend.

---

### Task 1: Módulo de íconos de navegación (`nav-icons.tsx`)

**Files:**
- Create: `src/components/layout/nav-icons.tsx`
- Test: `src/components/layout/nav-icons.test.tsx`

**Interfaces:**
- Consumes: `NAV_ITEMS` de `./nav` (solo en el test, para validar cobertura).
- Produces: `NAV_ICONS: Record<string, ReactElement>` — mapa de `href` (ej. `'/reporte'`) al SVG del ítem, y `NavIcon({ href }: { href: string }): ReactElement | null` que devuelve el ícono o `null` si no hay. Task 2 importa `NavIcon`.

- [ ] **Step 0: Crear la rama de trabajo**

```bash
cd "C:\Users\Administrador\Desktop\SE Gero\Aplicaciones Web\Formulario_Horas\Frontend"
git checkout -b feature/sidebar-plegable
```

- [ ] **Step 1: Escribir el test que falla**

```tsx
// src/components/layout/nav-icons.test.tsx
import { describe, it, expect } from 'vitest';
import { NAV_ITEMS } from './nav';
import { NAV_ICONS, NavIcon } from './nav-icons';

describe('NAV_ICONS', () => {
  it('todo ítem de navegación tiene ícono', () => {
    for (const item of NAV_ITEMS) {
      expect(NAV_ICONS[item.href], `falta ícono para ${item.href}`).toBeTruthy();
    }
  });

  it('NavIcon devuelve null para href desconocido', () => {
    expect(NavIcon({ href: '/no-existe' })).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run test -- src/components/layout/nav-icons.test.tsx`
Expected: FAIL — `Cannot find module './nav-icons'` (o equivalente).

- [ ] **Step 3: Implementar `nav-icons.tsx`**

```tsx
// src/components/layout/nav-icons.tsx
import type { ReactElement } from 'react';

const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const svg = (children: ReactElement | ReactElement[]) => (
  <svg width="18" height="18" viewBox="0 0 20 20" {...p} aria-hidden>
    {children}
  </svg>
);

// Un ícono por href de NAV_ITEMS (ver nav.ts). Estilo de trazo igual al resto de la app.
export const NAV_ICONS: Record<string, ReactElement> = {
  // Reporte diario: reloj
  '/reporte': svg(<><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" /></>),
  // Mis registros: lista
  '/mis-registros': svg(<><path d="M7 5h9M7 10h9M7 15h9" /><path d="M4 5h.01M4 10h.01M4 15h.01" strokeWidth="2.2" /></>),
  // Combustible: surtidor
  '/combustible': svg(<><rect x="4" y="3" width="8" height="14" rx="1" /><path d="M4 9h8M12 8l3-2v9a1.5 1.5 0 0 1-3 0" /></>),
  // Aprobaciones: tilde en círculo
  '/aprobaciones': svg(<><circle cx="10" cy="10" r="7" /><path d="m7 10 2 2 4-4" /></>),
  // Novedades: campana
  '/novedades': svg(<><path d="M10 3a5 5 0 0 0-5 5v3l-1.5 2.5h13L15 11V8a5 5 0 0 0-5-5Z" /><path d="M8.5 16a1.5 1.5 0 0 0 3 0" /></>),
  // Ausencias: calendario
  '/ausencias': svg(<><rect x="3" y="4.5" width="14" height="12" rx="1.5" /><path d="M3 8.5h14M7 3v3M13 3v3" /></>),
  // Admin: engranaje
  '/admin': svg(<><circle cx="10" cy="10" r="2.5" /><path d="M10 3v2.2M10 14.8V17M3 10h2.2M14.8 10H17M5.05 5.05l1.56 1.56M13.39 13.39l1.56 1.56M14.95 5.05l-1.56 1.56M6.61 13.39l-1.56 1.56" /></>),
  // Liquidación: calculadora
  '/liquidacion': svg(<><rect x="4.5" y="3" width="11" height="14" rx="1.5" /><path d="M7 6.5h6" /><path d="M7.5 10.5h.01M10 10.5h.01M12.5 10.5h.01M7.5 13.5h.01M10 13.5h.01M12.5 13.5h.01" strokeWidth="2" /></>),
};

export function NavIcon({ href }: { href: string }): ReactElement | null {
  return NAV_ICONS[href] ?? null;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm run test -- src/components/layout/nav-icons.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck y commit**

```bash
npx tsc --noEmit
git add src/components/layout/nav-icons.tsx src/components/layout/nav-icons.test.tsx
git commit -m "feat(sidebar): íconos de navegación por href (nav-icons)"
```

---

### Task 2: Estado plegado en AppShell con toggle y persistencia

**Files:**
- Modify: `src/components/layout/app-shell.tsx`
- Test: `src/components/layout/app-shell.test.tsx` (nuevo)

**Interfaces:**
- Consumes: `NavIcon({ href })` de `./nav-icons` (Task 1).
- Produces: nada consumido por tareas posteriores (última task).

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
// src/components/layout/app-shell.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from './app-shell';

vi.mock('next/navigation', () => ({
  usePathname: () => '/combustible',
  useRouter: () => ({ replace: vi.fn() }),
}));

const PERFIL_ADMIN = {
  cuil: '20123456789',
  email: 'admin@empresa.com',
  activo: true,
  rol: { nombre: 'Admin' as const },
  empleado: { apellido_nombre: 'PEREZ JUAN', legajo: 10, cargo: 'Oficial' },
  contratosHabilitados: [],
  tiposNovedadHabilitados: [],
};

vi.mock('@/lib/auth/session', () => ({
  useSession: () => ({ perfil: PERFIL_ADMIN, signOut: vi.fn() }),
}));

describe('AppShell — sidebar plegable (escritorio)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('desplegado por defecto: muestra los labels en el sidebar', () => {
    render(<AppShell><p>contenido</p></AppShell>);
    // El label aparece en el sidebar desktop (el drawer móvil no está montado)
    expect(screen.getByRole('link', { name: 'Combustible' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plegar menú' })).toBeInTheDocument();
  });

  it('al plegar quedan íconos con aria-label y sin texto visible', async () => {
    render(<AppShell><p>contenido</p></AppShell>);
    await userEvent.click(screen.getByRole('button', { name: 'Plegar menú' }));
    const link = screen.getByRole('link', { name: 'Combustible' });
    expect(link).toHaveAttribute('aria-label', 'Combustible');
    expect(link).not.toHaveTextContent('Combustible');
    expect(screen.getByRole('button', { name: 'Desplegar menú' })).toBeInTheDocument();
  });

  it('persiste la preferencia en localStorage y la restaura al montar', async () => {
    const r1 = render(<AppShell><p>contenido</p></AppShell>);
    await userEvent.click(screen.getByRole('button', { name: 'Plegar menú' }));
    expect(window.localStorage.getItem('sidebar-plegado')).toBe('1');
    r1.unmount();

    render(<AppShell><p>contenido</p></AppShell>);
    expect(screen.getByRole('button', { name: 'Desplegar menú' })).toBeInTheDocument();
  });

  it('al desplegar vuelve a guardar "0"', async () => {
    window.localStorage.setItem('sidebar-plegado', '1');
    render(<AppShell><p>contenido</p></AppShell>);
    await userEvent.click(screen.getByRole('button', { name: 'Desplegar menú' }));
    expect(window.localStorage.getItem('sidebar-plegado')).toBe('0');
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm run test -- src/components/layout/app-shell.test.tsx`
Expected: FAIL — no existe el botón "Plegar menú".

- [ ] **Step 3: Implementar el plegado en `app-shell.tsx`**

Cambios sobre el archivo existente (mantener todo lo demás igual, en particular top bar y drawer móvil):

```tsx
// imports nuevos
import { useEffect, useState, type ReactNode } from 'react';
import { NavIcon } from '@/components/layout/nav-icons';

// NavLinks: nueva prop opcional `plegado`
function NavLinks({ items, pathname, onNavigate, plegado = false }: {
  items: NavItem[]; pathname: string; onNavigate?: () => void; plegado?: boolean;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            aria-label={plegado ? item.label : undefined}
            title={plegado ? item.label : undefined}
            className={`flex items-center rounded-md border-l-[3px] py-2 text-sm transition-colors ${
              plegado ? 'justify-center px-0' : 'px-3'
            } ${
              active
                ? 'border-brand bg-accent font-medium text-ink'
                : 'border-transparent text-slate hover:bg-accent/60 hover:text-ink'
            }`}
          >
            {plegado ? <NavIcon href={item.href} /> : item.label}
          </Link>
        );
      })}
    </nav>
  );
}

// AppShell: estado plegado + persistencia
const [plegado, setPlegado] = useState(false);
useEffect(() => {
  setPlegado(window.localStorage.getItem('sidebar-plegado') === '1');
}, []);
function togglePlegado() {
  setPlegado((v) => {
    window.localStorage.setItem('sidebar-plegado', v ? '0' : '1');
    return !v;
  });
}
```

Render del `aside` desktop (reemplaza el actual):

```tsx
<aside className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface py-4 transition-[width] duration-200 md:flex ${plegado ? 'w-14 px-2' : 'w-60 px-3'}`}>
  <div className={plegado ? 'flex justify-center' : 'px-1'}>
    {plegado ? (
      <Image src="/logo.png" alt="" width={34} height={34} className="rounded-full" />
    ) : (
      <Brand />
    )}
  </div>
  <div className="mt-6 flex-1">
    <NavLinks items={items} pathname={pathname} plegado={plegado} />
  </div>
  {plegado ? (
    <div className="flex flex-col items-center gap-2 border-t border-line pt-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent font-display text-xs font-semibold text-brand-deep">
        {nombre.slice(0, 2).toUpperCase()}
      </span>
      <button
        type="button"
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
        onClick={salir}
        className="rounded-md p-1.5 text-slate hover:bg-danger/5 hover:text-danger"
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M13 7V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2" strokeLinecap="round" />
          <path d="M8 10h9m0 0-3-3m3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  ) : (
    <UserFooter nombre={nombre} onLogout={salir} />
  )}
  <button
    type="button"
    aria-label={plegado ? 'Desplegar menú' : 'Plegar menú'}
    title={plegado ? 'Desplegar menú' : 'Plegar menú'}
    onClick={togglePlegado}
    className={`mt-3 flex items-center justify-center rounded-md border border-line py-1.5 text-slate transition-colors hover:bg-accent/60 hover:text-ink ${plegado ? '' : 'w-full'}`}
  >
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" style={{ transform: plegado ? 'rotate(180deg)' : undefined }}>
      <path d="m12 5-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </button>
</aside>
```

Y el `main` (reemplaza `md:pl-60`):

```tsx
<main className={`transition-[padding] duration-200 ${plegado ? 'md:pl-14' : 'md:pl-60'}`}>
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm run test -- src/components/layout/app-shell.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Suite completa + typecheck**

Run: `npm run test` y `npx tsc --noEmit`
Expected: toda la suite verde (hay 2 flaky conocidos ajenos — re-correr si fallan), tsc limpio.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/app-shell.tsx src/components/layout/app-shell.test.tsx
git commit -m "feat(sidebar): plegable a riel de íconos en escritorio, con persistencia"
```
