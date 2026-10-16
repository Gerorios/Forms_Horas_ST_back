# Revisión del PR "punto en el mapa" (Backend #116, Frontend #94)

PR de Rodrigo Carrazana, rama `feat/seguridad-punto-en-mapa` contra `dev`. ADR-027, revisión 2026-10-15.
Worktrees: `.worktrees/rev-mapa-Backend` y `.worktrees/rev-mapa-Frontend`.

Revisión (Standards + Spec + Permisos/privacidad, verificador): 0 urgent, 1 high, 7 minor, 8 descartados.
El usuario pidió que el arreglo lo haga Claude sobre la rama de Rodrigo y probarlo en local antes del merge.

## Paso R1 (high) — orden del DDL en el deploy

- **Hallazgo:** `docs/sql/2026-10-15-seguridad-punto-en-mapa.sql` agregaba la columna `origen_punto` (ENUM NULL, sin
  default) y el CHECK en el mismo script, que el doc de deploy manda correr antes de reiniciar el back.
- **Escenario de falla:** entre el DDL y el `pm2 restart`, el back viejo no conoce la columna y guarda los puntos con
  `origen_punto` NULL; el CHECK los rechaza y crear o corregir un reporte con punto (incluida la paralización con
  GPS) da 500. Si ese insert cae entre el UPDATE y el ADD CONSTRAINT, el script falla y no se puede volver a correr.
- **Arreglo mínimo:** separar el CHECK en `docs/sql/2026-10-15-seguridad-punto-en-mapa-check.sql` y en el doc de
  deploy correrlo después del reinicio, con el conteo previo en 0 (igual que se hizo en `testing`). Rollback en dos
  partes.
- Solo docs/SQL: sin test.

## Minor (no se tocan, van comentados en los PRs)

1. Pantalla completa del mapa (`mapa-reportes-seccion.tsx:118`): diálogo a mano sin trampa de foco.
2. Botones Pines / Mapa de calor en `min-h-10` (40 px).
3. Back: `origenPunto: string|null` en vez de `OrigenPunto`, nombre `mismoPunto`, `num()` duplicado.
4. Front: `fechaCorta`, `normalizar` y el SVG del pin duplicados; `ORIGEN_PUNTO_LABEL` en un archivo `'use client'`;
   IIFE en JSX y switches repetidos.
5. Falta la atribución de Esri en las capas de referencia (`capas-base.tsx`).
6. Nominatim sin límite de 1 pedido por segundo con Enter repetido.
7. ADR: aclarar que el 403 solo frena mover un pin explícito del mapa; el origen GPS lo declara el cliente.

Deuda previa: `errorMetros` sin máximo (500 con valores enormes); el punto de la foto de cámara se guarda como GPS;
sin CSP.
