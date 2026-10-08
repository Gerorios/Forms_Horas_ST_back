# Hotfix: pastilla "Activo" y bandeja de HyS (2026-10-07)

Carril corto, Frontend, rama `hotfix/pastilla-activo-y-bandeja-hys` desde `main` → PR a `main` → traer a `dev`.
Origen: revisión de diseño del 2026-10-05 (hallazgos A1 y B2); el usuario pidió arreglarlos ya (P8 del plan del
rediseño). Sin DDL, sin cambio de API.

**A — La pastilla "Activo" desactiva con un clic** (`src/features/admin/pill-activo.tsx`, 7 catálogos).
Arreglo: el clic abre una confirmación (sobre `components/ui/dialog.tsx`) que dice qué se va a hacer y el efecto;
recién al confirmar llama a `onToggle`. Activar también confirma (es un cambio de estado). Props opcionales
`nombre` y `efecto`; Usuarios pasa "No va a poder entrar al sistema" (`app/(protected)/admin/usuarios/page.tsx`).
Test rojo primero: un clic en "Activo" no llama a `onToggle` (hoy sí lo llama).

**B — La bandeja de HyS solo muestra la quincena actual** (`app/(protected)/ausencias/page.tsx:212-214`).
Arreglo: la pestaña Pendientes y su contador salen de `useNovedadesPorEstado('pendiente')` (todas las quincenas);
Justificadas, Injustificadas y anuladas siguen por quincena. El detalle busca en las dos listas.
Test rojo primero: con una ausencia pendiente de julio y la quincena actual en octubre, la pestaña Pendientes la
muestra (hoy muestra 0).

**Verificación:** specs de las áreas tocadas, suite completa una vez, `tsc`, build. Revisión: una ronda
(`revision-codigo` + verificador) e `impeccable critique` de las dos pantallas. Mostrar antes del PR.

## Paso R1 (revisión, urgent)

`ausencias/page.tsx`: si `GET /novedades?estadoHys=pendiente` (o la consulta de la quincena) falla, la pestaña
mostraba "Sin ausencias en este estado." y HyS la creía vacía → esas ausencias se liquidarían como injustificadas.
Arreglo: ante error de la consulta que alimenta la pestaña visible, mostrar el error con "Reintentar" en lugar del
estado vacío. Test rojo primero. Minor sin tocar (van al PR): `danger-solid` en catálogos reversibles, filtro de
anuladas en línea, tests de la mezcla de listas, UX de la pendiente vieja resuelta.
