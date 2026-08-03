# Sidebar plegable a riel de íconos (escritorio) — Diseño

**Fecha:** 2026-08-03
**Repo afectado:** Frontend (el spec vive en Backend/docs como el resto)
**Estado:** aprobado por el usuario (conversación 2026-08-03)

## Problema

En escritorio el sidebar es fijo de 240px (`app-shell.tsx`) y el contenido queda centrado con
`max-w-5xl`, lo que en pantallas medianas se percibe "todo colapsado en el medio". El usuario
quiere poder plegar el menú para ganar ancho.

## Decisión (elegida por el usuario entre 2 opciones)

Riel de íconos: el sidebar plegado se reduce a ~56px mostrando solo un ícono por ítem.
(La alternativa "ocultar del todo" fue descartada.)

## Diseño

- **Estado plegado (solo escritorio, `md:`+):** ancho 240px → 56px (`w-60` → `w-14`).
  Cada ítem muestra solo su ícono SVG inline (mismo lenguaje visual que los SVG existentes:
  stroke 1.6–1.75, sin fill), con `title` nativo como tooltip y `aria-label` con el label.
  El ítem activo conserva el resaltado actual (borde izquierdo brand + fondo accent).
- **Íconos por ítem** (se agregan a `NavItem` en `nav.ts` como componente/ReactNode):
  - Reporte diario → reloj
  - Mis registros → lista
  - Combustible → surtidor
  - Aprobaciones → tilde en círculo
  - Novedades → campana
  - Ausencias → calendario
  - Admin → engranaje
  - Liquidación → calculadora
- **Brand plegado:** solo el logo circular, sin textos.
- **Footer plegado:** solo el avatar (iniciales) y debajo el botón de cerrar sesión como
  ícono con `title`/`aria-label`.
- **Toggle:** botón chevron (⟨ / ⟩) al pie del sidebar, visible en ambos estados, con
  `aria-label` "Plegar menú"/"Desplegar menú".
- **Persistencia:** la preferencia se guarda en `localStorage` (clave `sidebar-plegado`,
  valores `"1"`/`"0"`). Se lee al montar; default desplegado. Sin flash: leer en el primer
  render del cliente es aceptable (la app ya es client-side tras login).
- **Contenido:** `main` pasa de `md:pl-60` a `md:pl-14` cuando está plegado, con
  `transition-[padding]`/`transition-[width]` suaves (~200ms).
- **Móvil:** sin cambios — top bar + drawer quedan idénticos (el drawer siempre muestra
  labels completos).

## Alcance

- Archivos tocados: `src/components/layout/nav.ts` (íconos; puede pasar a `.tsx`),
  `src/components/layout/app-shell.tsx` (estado plegado + render + toggle + persistencia).
- Sin dependencias nuevas. Sin cambios de backend.

## Testing

Extender los tests existentes del AppShell (vitest + testing-library):
1. El toggle pliega y despliega (labels visibles ↔ solo íconos con aria-label).
2. La preferencia persiste en `localStorage` y se restaura al montar.
3. Cada ítem plegado expone `aria-label` con su nombre.
4. El drawer móvil no se ve afectado por el estado plegado.

## Fuera de alcance

- Íconos en el drawer móvil o en el sidebar desplegado (los labels siguen solos).
- Submenús, secciones colapsables por grupo, o auto-plegado por ancho de ventana.
