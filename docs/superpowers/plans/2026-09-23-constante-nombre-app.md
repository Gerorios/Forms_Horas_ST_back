# 2026-09-23 — Constante única para el nombre de la app + test de metadata

Minors del PR Frontend #82, pedidos por el usuario. **Carril corto por excepción**
(4 archivos de código, uno es la constante nueva; elegido por el usuario). Sin
cambio visible, sin DDL, sin API.

## Pasos — Frontend, rama `refactor/constante-nombre-app`

1. Test rojo: `src/app/layout.test.tsx` (mock de `next/font/google`) — `metadata.title`
   === `NOMBRE_APP` y la `description` contiene "Sistema interno de ${MARCA}:"
   (la descripción usa la marca sola, sin "Central"). Falla porque `@/lib/marca` no existe.
2. `src/lib/marca.ts`: `MARCA = 'SER&TEC'` y `NOMBRE_APP = `Central ${MARCA}`` (patrón de `src/lib/fotos.ts`).
3. Usarla en `src/app/login/page.tsx` (h1), `src/components/layout/app-shell.tsx`
   (texto, `aria-label`, `title`) y `src/app/layout.tsx` (`title`, `description`).
4. Los tests de login y app-shell quedan igual (literal "Central SER&TEC") y deben
   seguir verdes: prueban lo que ve el usuario, no la constante.

Verificación: tests tocados, suite completa, tsc, eslint. Deploy opcional (no cambia nada visible).
