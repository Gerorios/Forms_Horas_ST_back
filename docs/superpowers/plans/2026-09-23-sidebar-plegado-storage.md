# 2026-09-23 — Barra lateral: preferencia "plegado" a prueba de localStorage bloqueado

Carril corto (1 archivo de código, sin DDL, sin API). OK del usuario: "Dale".

## Problema

`app-shell.tsx` lee y escribe `localStorage` ('sidebar-plegado') sin protección.
Si el navegador bloquea el almacenamiento, `getItem`/`setItem` tiran y la app
queda sin barra (error en el effect del montaje o al plegar). eslint marca
`react-hooks/set-state-in-effect` sobre esa lectura.

## Pasos — Frontend, rama `fix/sidebar-plegado-storage`

1. Tests rojos en `app-shell.test.tsx`: con `getItem` que tira, la barra se
   renderiza desplegada; con `setItem` que tira, "Plegar menú" pliega igual (sin persistir).
2. `app-shell.tsx`: `leerPlegado()` / `guardarPlegado()` con `try/catch`; el
   effect queda (leer antes rompe la hidratación, mismo criterio que
   `session.tsx`), con comentario y `eslint-disable-next-line
   react-hooks/set-state-in-effect` justificado en el comentario (no hay
   precedente de esta regla desactivada; `foto-ticket.tsx:64` desactiva otra).

Verificación: app-shell, suite completa, tsc, eslint (sin errores). Deploy solo si lo pide.

## Revisión

2 ejes → verificador: 0 urgent / 0 high / 2 minor (el test de setItem detecta
el bug vía "Unhandled Errors" de vitest, no por su aserción; comentarios que se
superponen) / 2 descartados. Caso alcanzable real: `setItem` con cuota llena
(`QuotaExceededError`) con el token ya guardado.

Deuda aparte: `src/lib/api/token.ts` tampoco protege localStorage (el login
falla antes si está bloqueado del todo; `session.tsx` deja una promesa rechazada
sin manejar).
