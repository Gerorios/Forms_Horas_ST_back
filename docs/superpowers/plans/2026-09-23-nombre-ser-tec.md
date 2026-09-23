# 2026-09-23 — "Sertec" → "SER&TEC" y copy del login "Sistema Interno"

Carril corto (3 archivos de código del Frontend, sin DDL, sin API). Alcance
elegido por el usuario: **toda la app** (login, barra lateral, pestaña).

## Pasos — Frontend, rama `fix/nombre-ser-tec`

1. Tests en rojo primero: `login-page.test.tsx` espera el h1 "Central SER&TEC"
   y el subtítulo "Sistema Interno"; `app-shell.test.tsx` espera "Central
   SER&TEC" (texto y `aria-label` del link con las iniciales "CS").
2. `src/app/login/page.tsx`: h1 "Central SER&TEC"; `<p>` "Sistema Interno".
3. `src/components/layout/app-shell.tsx`: "Central SER&TEC" en el texto, el
   `aria-label` y el `title` (en JSX, `&` va como `&amp;` o dentro de `{'…'}`).
4. `src/app/layout.tsx`: `title: "Central SER&TEC"`; la `description` pasa a
   "Sistema interno de SER&TEC: …".
5. Comentarios con "Central Sertec (ADR-025)" no se tocan (referencian el ADR).

Verificación: tests de login y app-shell, suite completa, tsc, eslint, build.
Deploy solo del Frontend si el usuario lo pide.
